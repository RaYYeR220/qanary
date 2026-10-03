/**
 * Live end-to-end run of a Qanary treasury account on one network, self-bundled: every user
 * operation goes through `EntryPoint.handleOps` sent by the deployer, so it also runs on chains
 * without a public ERC-4337 bundler (ApeChain) and can land the refusals as failed transactions.
 *
 *   DEPLOYER_PRIVATE_KEY=0x… npx tsx scripts/e2e.ts --network <apechain|arbitrum-one|…>
 *       [--root kms|mnemonic] [--extras mnemonic,falcon] [--max-spend <native units>]
 *
 * Treasury account (root key: the AWS KMS ML-DSA-44 key with `--root kms`, the default when
 * QANARY_KMS_KEY_ID is set; otherwise an ML-DSA-44 key from a BIP-39 mnemonic):
 *  1. root key → KeyStore; on the Solidity fallback verifier, `prepareKey` expands it on-chain once
 *  2. Kernel v3.3 account with the QuantumValidator as root, deployed by its first PQ-signed user op
 *  3. PQ-signed native transfer
 *  4. hot tier installed by a root user operation (execution phase), following the live registry
 *  5. hot-key transfer within the cap; over the cap → failed transaction (`CapExceeded`)
 *  6. tampered PQ signature → failed `handleOps` (`AA24 signature error`)
 *  7. drill registry from the factory; the root re-points the hot tier at it
 *  8. ladder rung L1 (secp160r1) claimed with the published drill key: on the Stylus ladder it
 *     raises the level; where the ladder is unavailable the claim lands as a failed transaction
 *  9. K1 claimed with the published drill key → hot transfer after the trip fails
 *     (`ClassicalFamilyBroken`)
 * 10. ERC-1271 through Kernel (`isValidSignature`, eth_call)
 * Extras: further accounts deployed by one PQ-signed user operation each (ML-DSA-44 from the
 * mnemonic, Falcon-512 from the mnemonic).
 *
 * Every transaction is simulated first; refusals are confirmed by simulation, then sent with a fixed
 * gas limit. The run stops before any step that would take the deployer's spend over `--max-spend`.
 * Steps already recorded in deployments/<network>.json (`e2e.sdk`) are skipped, so a run can resume.
 *
 * Env: DEPLOYER_PRIVATE_KEY, QANARY_KMS_KEY_ID + AWS_REGION (+ AWS_PROFILE), <NETWORK>_RPC,
 * QANARY_SECRETS_DIR (where the mnemonic and hot key live; default `.secrets/`), E2E_MAX_SPEND.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BaseError,
  ContractFunctionRevertedError,
  concat,
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  http,
  keccak256,
  parseEther,
  parseEventLogs,
  parseSignature,
  stringToHex,
  toHex,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
} from 'viem';
import { entryPoint07Abi, getUserOperationHash, toPackedUserOperation, type UserOperation } from 'viem/account-abstraction';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  CANARY_TARGET,
  CLASSICAL_FAMILY,
  NATIVE_ASSET,
  accountDigest,
  canary,
  canaryRegistryAbi,
  createQanaryAccount,
  drillK1PrivateKey,
  drillRegistryFactoryAbi,
  encodeClaimProof,
  explorerTxUrl,
  generateMnemonic,
  hotTier,
  hotTierExecutorAbi,
  installHotTierCall,
  kernelAccountAbi,
  kernelErc1271Signature,
  kernelWrappedHash,
  keyBlob,
  keyStoreAbi,
  kmsSigner,
  pqSignerFromMnemonic,
  predictKeyPointer,
  quantumValidatorAbi,
  requireContract,
  requireVerifier,
  userOperationOutcome,
  type HotSetup,
  type KernelSmartAccount,
  type PqSigner,
} from '../src/index.js';
import { REPO_ROOT, chainFor, deploymentPath, fail, flag, readDeploymentFile, recordE2E, requireEnv, resolveNetwork, rpcUrl, secret } from './lib.js';

const net = resolveNetwork(flag('network'));
const chain = chainFor(net);
const symbol = net.nativeSymbol;
const arbOne = net.chainId === 42161;

/** Native amounts: tiny on purpose. */
const UNIT = arbOne ? parseEther('0.000001') : parseEther('0.001');
const PQ_TRANSFER = UNIT;
const HOT_CAP = 2n * UNIT;
const HOT_WINDOW = 3600;
const LEVEL_BPS = [10_000, 5_000, 2_500, 0] as const;

/** Signed gas limits of the self-bundled user operations (the Solidity verifier needs ~1.25M). */
const OP_GAS = arbOne
  ? { verificationGasLimit: 2_600_000n, callGasLimit: 600_000n, preVerificationGas: 100_000n }
  : { verificationGasLimit: 1_000_000n, callGasLimit: 500_000n, preVerificationGas: 60_000n };

const loaded = readDeploymentFile(net);
if (!loaded) fail(`${deploymentPath(net)} not found: deploy the contracts to ${net.label} first (docs/DEPLOYING.md)`);
const d = loaded.deployment;
const keyStore = requireContract(d, 'keyStore');
const validatorAddress = requireContract(d, 'quantumValidator');
const executor = requireContract(d, 'hotTierExecutor');
const liveRegistry = requireContract(d, 'canaryRegistry');
const drillFactory = requireContract(d, 'drillRegistryFactory');
const mldsa44Verifier = requireVerifier(d, 'mldsa44');
/** No Stylus ML-DSA-44 program recorded: the account runs on the Solidity fallback verifier. */
const solidityVerifier = (loaded.json.stylus as Record<string, unknown> | undefined)?.mldsa44Verifier === undefined;

const publicClient = createPublicClient({ chain, transport: http(rpcUrl(net)) }) as PublicClient;
const deployer = createWalletClient({
  account: privateKeyToAccount(requireEnv('DEPLOYER_PRIVATE_KEY') as Hex),
  chain,
  transport: http(rpcUrl(net)),
});
const me = deployer.account.address;
const secretsFile = `e2e-${net.name}.env`;
const rec = (((loaded.json.e2e as Record<string, unknown> | undefined)?.sdk ?? {}) as Record<string, unknown>);
const record = (values: Record<string, unknown>) => {
  Object.assign(rec, values);
  recordE2E(net, 'sdk', values);
};
const link = (hash: Hash) => explorerTxUrl(net.chainId, hash) ?? hash;
const amount = (wei: bigint) => `${formatEther(wei)} ${symbol}`;

// ------------------------------------------------------------------ budget

const maxSpend = parseEther(flag('max-spend') ?? process.env.E2E_MAX_SPEND ?? fail('--max-spend is required'));
const startBalance = await publicClient.getBalance({ address: me });
let gasPrice = await publicClient.getGasPrice();

/** Stops before a step that could take the deployer's spend over the budget. */
async function guard(what: string, gas: bigint, value = 0n): Promise<void> {
  gasPrice = await publicClient.getGasPrice();
  const spent = startBalance - (await publicClient.getBalance({ address: me }));
  const next = gas * gasPrice + value;
  if (spent + next > maxSpend) {
    fail(`${what}: spent ${amount(spent)} + up to ${amount(next)} would exceed --max-spend ${amount(maxSpend)}`);
  }
}

async function receiptOf(hash: Hash) {
  return publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
}

/** Simulates, budget-checks and sends a transaction from the deployer; fails unless it succeeds. */
async function send(what: string, tx: { to: Address; data?: Hex; value?: bigint }): Promise<Hash> {
  const gas = ((await publicClient.estimateGas({ account: me, ...tx })) * 12n) / 10n;
  await guard(what, gas, tx.value ?? 0n);
  const hash = await deployer.sendTransaction({ ...tx, gas });
  const receipt = await receiptOf(hash);
  if (receipt.status !== 'success') fail(`${what} reverted: ${link(hash)}`);
  console.log(`  ${what}: ${link(hash)} (gas ${receipt.gasUsed})`);
  return hash;
}

/** Sends a transaction expected to revert with a fixed gas limit, so it lands on-chain as failed. */
async function sendRevert(what: string, tx: { to: Address; data: Hex }, gas: bigint): Promise<Hash> {
  await guard(what, gas);
  const hash = await deployer.sendTransaction({ ...tx, gas });
  const receipt = await receiptOf(hash);
  if (receipt.status !== 'reverted') fail(`${what} was expected to revert but succeeded: ${link(hash)}`);
  console.log(`  ${what} (failed as intended): ${link(hash)} (gas ${receipt.gasUsed})`);
  return hash;
}

/** The custom error (`Name(args)`) or revert string a call reverts with, or `none`. */
async function revertOf(tx: { to: Address; data: Hex }, abi: readonly unknown[]): Promise<string> {
  try {
    await publicClient.call({ account: me, ...tx });
  } catch (e) {
    const err = e instanceof BaseError ? e : undefined;
    const raw = (err?.walk((x) => typeof (x as { data?: unknown }).data === 'string') as { data?: Hex } | undefined)?.data;
    if (raw) {
      try {
        const decoded = decodeErrorResult({ abi: abi as never, data: raw });
        return `${decoded.errorName}(${(decoded.args ?? []).map(String).join(', ')})`;
      } catch {
        return `raw ${raw}`;
      }
    }
    const revert = err?.walk((x) => x instanceof ContractFunctionRevertedError);
    return revert instanceof ContractFunctionRevertedError ? (revert.data?.errorName ?? revert.shortMessage) : String(e);
  }
  return 'none';
}

// ------------------------------------------------------------------ user operations

async function buildUserOp(account: KernelSmartAccount, calls: { to: Address; value?: bigint; data?: Hex }[]) {
  gasPrice = await publicClient.getGasPrice();
  const [factoryArgs, nonce, callData] = await Promise.all([
    account.getFactoryArgs(),
    account.getNonce(),
    account.encodeCalls(calls.map((c) => ({ to: c.to, value: c.value ?? 0n, data: c.data ?? '0x' }))),
  ]);
  const op: UserOperation<'0.7'> = {
    sender: account.address,
    nonce,
    ...(factoryArgs.factory ? { factory: factoryArgs.factory, factoryData: factoryArgs.factoryData } : {}),
    callData,
    ...OP_GAS,
    maxFeePerGas: opFee(gasPrice),
    maxPriorityFeePerGas: 0n,
    signature: '0x',
  };
  op.signature = await account.signUserOperation({ ...op, chainId: net.chainId });
  const userOpHash = getUserOperationHash({
    userOperation: op,
    entryPointAddress: d.entryPoint,
    entryPointVersion: '0.7',
    chainId: net.chainId,
  });
  return { op, userOpHash };
}

const handleOpsData = (op: UserOperation<'0.7'>) =>
  encodeFunctionData({ abi: entryPoint07Abi, functionName: 'handleOps', args: [[toPackedUserOperation(op)], me] });

/** `maxFeePerGas` of the user operations: a small margin over the current price. */
const opFee = (price: bigint) => (price * (arbOne ? 13n : 11n)) / 10n;

/** Prefund the EntryPoint takes from the account for one operation. */
const prefund = (fee: bigint) => (OP_GAS.verificationGasLimit + OP_GAS.callGasLimit + OP_GAS.preVerificationGas) * fee;

/** Builds, signs and self-bundles one user operation; fails unless the operation succeeds. */
async function userOp(account: KernelSmartAccount, what: string, calls: { to: Address; value?: bigint; data?: Hex }[]) {
  const { op, userOpHash } = await buildUserOp(account, calls);
  const hash = await send(what, { to: d.entryPoint, data: handleOpsData(op) });
  if (userOperationOutcome(await receiptOf(hash), userOpHash) !== true) fail(`${what}: user operation ${userOpHash} reverted: ${link(hash)}`);
  return { userOpHash, tx: hash };
}

async function storeRoot(signer: PqSigner, label: string): Promise<{ pointer: Address; tx?: Hash }> {
  const blob = keyBlob(signer);
  const pointer = predictKeyPointer(keyStore, blob);
  const code = await publicClient.getCode({ address: pointer });
  if (code && code !== '0x') {
    console.log(`  ${label} key already stored at ${pointer}`);
    return { pointer };
  }
  const tx = await send(`store ${label} key`, {
    to: keyStore,
    data: encodeFunctionData({ abi: keyStoreAbi, functionName: 'store', args: [blob] }),
  });
  return { pointer, tx };
}

const preparerAbi = [
  { type: 'function', name: 'prepareKey', stateMutability: 'nonpayable', inputs: [{ name: 'key', type: 'bytes' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'isPrepared', stateMutability: 'view', inputs: [{ name: 'key', type: 'bytes' }], outputs: [{ type: 'bool' }] },
] as const;

/** Fresh account object (counterfactual or recorded) for `signer` at `index`. */
function accountFor(signer: PqSigner, index: bigint, address?: Address) {
  return createQanaryAccount(publicClient, { signer, registry: liveRegistry, index, deployment: d, address });
}

async function fundTo(to: Address, value: bigint, what: string): Promise<Hash> {
  return send(`fund ${what} with ${amount(value)}`, { to, value });
}

// ------------------------------------------------------------------ hero

async function hero(signer: PqSigner, rootLabel: string): Promise<void> {
  console.log(`\n== treasury account, ${rootLabel} root`);
  record({ rootKey: rootLabel });

  // 1. key
  if (!rec.rootKeyPointer) {
    const { pointer, tx } = await storeRoot(signer, rootLabel);
    record({ rootKeyPointer: pointer, ...(tx ? { storeKeyTx: tx } : {}) });
  }
  const pointer = rec.rootKeyPointer as Address;
  if (solidityVerifier && !rec.prepareKeyTx) {
    const key = pointer as Hex;
    const prepared = await publicClient.readContract({ address: mldsa44Verifier, abi: preparerAbi, functionName: 'isPrepared', args: [key] });
    if (!prepared) {
      const tx = await send('prepare the key on the Solidity verifier (expanded once, on-chain)', {
        to: mldsa44Verifier,
        data: encodeFunctionData({ abi: preparerAbi, functionName: 'prepareKey', args: [key] }),
      });
      record({ prepareKeyTx: tx });
    }
  }

  // 2. account
  if (!rec.kernelIndex) record({ kernelIndex: String(Date.now()) });
  const index = BigInt(rec.kernelIndex as string);
  let account = await accountFor(signer, index, rec.kernelAccount as Address | undefined);
  record({ kernelAccount: account.address });
  console.log(`  Kernel account ${account.address}`);
  if (!rec.fundAccountTx) {
    gasPrice = await publicClient.getGasPrice();
    const fee = opFee(gasPrice);
    // prefund of one operation + the cost of the next ones + the transfers
    const funding = prefund(fee) + 4n * (arbOne ? 2_000_000n : 400_000n) * fee + PQ_TRANSFER + 2n * HOT_CAP;
    record({ fundAccountTx: await fundTo(account.address, funding, 'treasury account') });
  }
  if (!rec.pqUserOpTx) {
    const r = await userOp(account, 'first PQ-signed user operation deploys the account', [{ to: me, value: 0n }]);
    record({ pqUserOpHash: r.userOpHash, pqUserOpTx: r.tx });
  }
  account = await accountFor(signer, index, account.address);
  const config = await publicClient.readContract({
    address: validatorAddress,
    abi: quantumValidatorAbi,
    functionName: 'configOf',
    args: [account.address],
  });
  console.log(`  root: verifier ${config.verifier}, key ${config.keyPtr}`);

  // 3. PQ-signed transfer
  if (!rec.pqTransferTx) {
    const r = await userOp(account, `PQ-signed transfer of ${amount(PQ_TRANSFER)}`, [{ to: me, value: PQ_TRANSFER }]);
    record({ pqTransferUserOpHash: r.userOpHash, pqTransferTx: r.tx });
  }

  // 4. hot tier
  const hotKey = privateKeyToAccount(secret(secretsFile, 'HOT_PRIVATE_KEY', generatePrivateKey) as Hex);
  const setup: HotSetup = {
    window: HOT_WINDOW,
    levelBps: LEVEL_BPS,
    signer: { family: 'secp256k1', eoa: hotKey.address },
    assets: [{ asset: NATIVE_ASSET, cap: HOT_CAP }],
  };
  record({ hotKey: hotKey.address, hotCapWei: HOT_CAP.toString() });
  if (!rec.installHotTierTx) {
    const r = await userOp(account, 'root user operation installs the hot tier', [
      installHotTierCall(account.address, executor, { ...setup, registry: liveRegistry }),
    ]);
    record({ installHotTierUserOpHash: r.userOpHash, installHotTierTx: r.tx });
  }
  const hot = hotTier(deployer, executor);
  const signHot = (digest: Hex) => hotKey.sign({ hash: digest });
  const hotCalldata = async (value: bigint) => {
    const calls = [{ target: me, value, data: '0x' as Hex }];
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const nonce = await publicClient.readContract({ address: executor, abi: hotTierExecutorAbi, functionName: 'nonceOf', args: [account.address] });
    const sig = await signHot(await hot.hotOpDigest(account.address, calls, nonce, deadline));
    return encodeFunctionData({ abi: hotTierExecutorAbi, functionName: 'executeWithSig', args: [account.address, calls, deadline, sig] });
  };

  // 5. hot transfers
  if (!rec.hotTransferTx) {
    const value = HOT_CAP / 2n;
    record({ hotTransferTx: await send(`hot-key transfer of ${amount(value)} (cap ${amount(HOT_CAP)})`, { to: executor, data: await hotCalldata(value) }) });
  }
  if (!rec.hotOverCapRevertTx) {
    const data = await hotCalldata(HOT_CAP + 1n);
    const err = await revertOf({ to: executor, data }, hotTierExecutorAbi);
    if (!err.startsWith('CapExceeded')) fail(`over-cap hot transfer should fail with CapExceeded, got ${err}`);
    console.log(`  over-cap simulation: ${err}`);
    record({ hotOverCapError: err, hotOverCapRevertTx: await sendRevert('hot-key transfer over the cap', { to: executor, data }, 300_000n) });
  }

  // 6. tampered signature
  if (!rec.tamperedSigRevertTx) {
    const { op } = await buildUserOp(account, [{ to: me, value: PQ_TRANSFER }]);
    const sig = op.signature;
    op.signature = concat([toHex(Number.parseInt(sig.slice(2, 4), 16) ^ 0x01, { size: 1 }), `0x${sig.slice(4)}`]);
    const data = handleOpsData(op);
    const err = await revertOf({ to: d.entryPoint, data }, entryPoint07Abi);
    if (!err.includes('AA24')) fail(`tampered user operation should fail with AA24, got ${err}`);
    console.log(`  tampered-signature simulation: ${err}`);
    const gas = arbOne ? 3_000_000n : 1_000_000n;
    record({ tamperedSigError: err, tamperedSigRevertTx: await sendRevert('handleOps with a tampered PQ signature', { to: d.entryPoint, data }, gas) });
  }

  // 7. drill registry, hot tier re-pointed by the root
  if (!rec.drillRegistry) {
    const tx = await send('drill registry from the factory', {
      to: drillFactory,
      data: encodeFunctionData({ abi: drillRegistryFactoryAbi, functionName: 'create' }),
    });
    const [created] = parseEventLogs({ abi: drillRegistryFactoryAbi, eventName: 'DrillCreated', logs: (await receiptOf(tx)).logs });
    if (!created) fail(`DrillRegistryFactory.create emitted no DrillCreated: ${link(tx)}`);
    record({ drillRegistry: created.args.registry, drillRegistryTx: tx });
  }
  const drill = rec.drillRegistry as Address;
  const drillReader = canary(publicClient, drill);
  const drillK1 = privateKeyToAccount(drillK1PrivateKey());
  if (!(await drillReader.isDrill()) || (await drillReader.targets()).k1 !== drillK1.address) fail(`${drill} is not a drill registry`);
  if (!rec.repointHotTierTx) {
    const r = await userOp(account, 'root user operation re-points the hot tier at the drill registry', [
      hot.configure({ ...setup, registry: drill }),
    ]);
    record({ repointHotTierUserOpHash: r.userOpHash, repointHotTierTx: r.tx });
  }
  record({ effectiveBpsBeforeTrip: await hot.effectiveBps(account.address) });

  // 8. ladder rung L1 (secp160r1)
  if (!rec.ladderL1ClaimTx && !rec.ladderL1RevertTx) {
    const targets = JSON.parse(readFileSync(resolve(REPO_ROOT, 'deployments/canary-targets.json'), 'utf8')) as {
      drill: { secp160r1: { privateKey: string } };
    };
    const message = await drillReader.claimMessage(CANARY_TARGET.L1, me);
    const rs = execFileSync('python', [resolve(REPO_ROOT, 'scripts/ladder_sign.py'), 'secp160r1', targets.drill.secp160r1.privateKey, message], {
      encoding: 'utf8',
    }).trim() as Hex;
    const proof = encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [`0x${rs.slice(2, 66)}`, `0x${rs.slice(66, 130)}`]);
    const data = encodeFunctionData({ abi: canaryRegistryAbi, functionName: 'claim', args: [CANARY_TARGET.L1, proof] });
    const err = await revertOf({ to: drill, data }, [...canaryRegistryAbi, { type: 'error', name: 'LadderUnavailable', inputs: [] }]);
    if (err === 'none') {
      record({ ladderL1ClaimTx: await send('drill L1 (secp160r1) claim, checked by the Stylus ladder verifier', { to: drill, data }) });
      record({ ladderLevelAfterL1: await drillReader.level(), effectiveBpsAfterL1: await hot.effectiveBps(account.address) });
    } else {
      if (!err.startsWith('LadderUnavailable')) fail(`L1 claim failed unexpectedly: ${err}`);
      console.log(`  L1 simulation: ${err} (no ladder verifier on ${net.label}: fails closed)`);
      record({ ladderL1Error: err, ladderL1RevertTx: await sendRevert('drill L1 claim without a ladder verifier', { to: drill, data }, 300_000n) });
    }
  }

  // 9. K1 trip and refusal
  if (!rec.drillClaimTx) {
    const message = await drillReader.claimMessage(CANARY_TARGET.K1, me);
    const proof = parseSignature(await drillK1.sign({ hash: message }));
    record({
      drillClaimTx: await send('drill K1 (secp256k1) claim', {
        to: drill,
        data: encodeFunctionData({ abi: canaryRegistryAbi, functionName: 'claim', args: [CANARY_TARGET.K1, encodeClaimProof(CANARY_TARGET.K1, proof)] }),
      }),
    });
  }
  if (!(await drillReader.familyBroken(CLASSICAL_FAMILY.secp256k1))) fail('the drill claim did not mark secp256k1 broken');
  record({ ladderLevelAfterTrip: await drillReader.level(), effectiveBpsAfterTrip: await hot.effectiveBps(account.address) });
  if (!rec.postTripHotRevertTx) {
    const data = await hotCalldata(1n);
    const err = await revertOf({ to: executor, data }, hotTierExecutorAbi);
    if (!err.startsWith('ClassicalFamilyBroken')) fail(`post-trip hot transfer should fail with ClassicalFamilyBroken, got ${err}`);
    console.log(`  post-trip simulation: ${err}`);
    record({ postTripError: err, postTripHotRevertTx: await sendRevert('hot-key transfer after the trip', { to: executor, data }, 300_000n) });
  }

  // 10. ERC-1271 through Kernel
  const hash = keccak256(stringToHex(`qanary erc-1271 ${net.name} ${account.address}`));
  const wrapped = kernelWrappedHash({ account: account.address, chainId: net.chainId, hash });
  const pqSig = await signer.sign(accountDigest({ validator: validatorAddress, chainId: net.chainId, account: account.address, hash: wrapped }));
  const sig = kernelErc1271Signature(validatorAddress, pqSig);
  const isValid = (h: Hex) =>
    publicClient.readContract({ address: account.address, abi: kernelAccountAbi, functionName: 'isValidSignature', args: [h, sig] });
  const result = await isValid(hash);
  const other = await isValid(keccak256(stringToHex('another message')));
  console.log(`  ERC-1271 isValidSignature: ${result} (same signature on another hash: ${other})`);
  if (result !== '0x1626ba7e') fail('ERC-1271 check through Kernel failed');
  record({ erc1271Hash: hash, erc1271Result: result, erc1271OtherHashResult: other });
}

// ------------------------------------------------------------------ extras

async function extra(label: 'mnemonic' | 'falcon', signer: PqSigner): Promise<void> {
  console.log(`\n== ${label} account (${signer.scheme})`);
  const k = (s: string) => `${label}${s}`;
  if (!rec[k('KeyPointer')]) {
    const { pointer, tx } = await storeRoot(signer, `${label} ${signer.scheme}`);
    record({ [k('KeyPointer')]: pointer, ...(tx ? { [k('StoreKeyTx')]: tx } : {}) });
  }
  if (!rec[k('KernelIndex')]) record({ [k('KernelIndex')]: String(Date.now()) });
  const account = await accountFor(signer, BigInt(rec[k('KernelIndex')] as string), rec[k('KernelAccount')] as Address | undefined);
  record({ [k('KernelAccount')]: account.address });
  if (!rec[k('FundTx')]) {
    gasPrice = await publicClient.getGasPrice();
    const fee = opFee(gasPrice);
    record({ [k('FundTx')]: await fundTo(account.address, prefund(fee) + PQ_TRANSFER, `${label} account`) });
  }
  if (!rec[k('UserOpTx')]) {
    const r = await userOp(account, `${label}: first PQ-signed user operation deploys the account and transfers ${amount(PQ_TRANSFER)}`, [
      { to: me, value: PQ_TRANSFER },
    ]);
    record({ [k('UserOpHash')]: r.userOpHash, [k('UserOpTx')]: r.tx });
  }
}

// ------------------------------------------------------------------ main

async function main(): Promise<void> {
  console.log(`${net.label} (chain ${net.chainId}): self-bundled handleOps from ${me}`);
  console.log(`ML-DSA-44 verifier ${mldsa44Verifier}${solidityVerifier ? ' (Solidity)' : ' (Stylus)'}; budget ${amount(maxSpend)}`);
  const mnemonic = () => secret(secretsFile, 'QANARY_MNEMONIC', generateMnemonic);
  const rootKind = flag('root') ?? (process.env.QANARY_KMS_KEY_ID ? 'kms' : 'mnemonic');
  if (rootKind === 'kms') {
    const kms = await kmsSigner({ keyId: requireEnv('QANARY_KMS_KEY_ID'), region: process.env.AWS_REGION });
    await hero(kms, 'aws-kms-ml-dsa-44');
  } else if (rootKind === 'mnemonic') {
    await hero(pqSignerFromMnemonic('mldsa44', mnemonic()), 'mnemonic-ml-dsa-44');
  } else if (rootKind !== 'none') fail(`unknown --root ${rootKind} (kms | mnemonic | none)`);

  for (const x of (flag('extras') ?? '').split(',').filter(Boolean)) {
    if (x === 'mnemonic') await extra('mnemonic', pqSignerFromMnemonic('mldsa44', mnemonic()));
    else if (x === 'falcon') {
      requireVerifier(d, 'falcon512');
      await extra('falcon', pqSignerFromMnemonic('falcon512', mnemonic()));
    } else fail(`unknown extra ${x} (mnemonic | falcon)`);
  }

  const spent = startBalance - (await publicClient.getBalance({ address: me }));
  record({ ranAt: new Date().toISOString() });
  console.log(`\ndone: deployer spent ${amount(spent)}; hashes recorded in ${deploymentPath(net)} (e2e.sdk)`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
