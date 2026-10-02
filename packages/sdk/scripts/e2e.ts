/**
 * End-to-end run of a Qanary account on one network.
 *
 *   DEPLOYER_PRIVATE_KEY=0x… npx tsx scripts/e2e.ts --network <arbitrum-one|apechain|apechain-curtis|arbitrum-sepolia>
 *                                                  [--bundler pimlico|zerodev|self]
 *
 * 1. ML-DSA-44 key from a BIP-39 mnemonic → KeyStore.
 * 2. Drill canary registry (published drill keys) from the DrillRegistryFactory.
 * 3. Kernel v3.3 account with the QuantumValidator as root, deployed by its first user operation
 *    (initCode), which also installs the hot tier (capped native-currency spending by a classical
 *    hot key). Through a bundler, its ERC-7562 validation accepts the operation.
 * 4. Hot transfer within the cap → succeeds; over the cap → reverts on-chain (CapExceeded).
 * 5. Drill trip: K1 claim with the published drill key marks secp256k1 broken.
 * 6. Hot transfer after the trip → reverts on-chain (ClassicalFamilyBroken).
 * 7. With QANARY_KMS_KEY_ID: the same account flow with an AWS KMS ML-DSA-44 root key.
 *
 * Bundler (default, in order): BUNDLER_URL (Pimlico-compatible) → ZeroDev when ZERODEV_PROJECT_ID
 * is set → Pimlico's public endpoint where it serves the chain (Arbitrum One / Sepolia; not
 * ApeChain) → self-bundled `EntryPoint.handleOps` sent by the deployer. `--bundler` forces one.
 *
 * Transaction hashes are written to deployments/<network>.json under `e2e.sdk`. The mnemonic and
 * hot key come from QANARY_MNEMONIC / HOT_PRIVATE_KEY or `.secrets/e2e-<network>.env`, where new
 * ones are created; they are never printed.
 *
 * Env: DEPLOYER_PRIVATE_KEY (pays gas and funds the accounts), <NETWORK>_RPC (ARB_ONE_RPC,
 * APECHAIN_RPC, APECHAIN_CURTIS_RPC, ARB_SEPOLIA_RPC), QANARY_KMS_KEY_ID + AWS_REGION,
 * E2E_ACCOUNT_FUNDING (native units per account; default 20M gas at the current gas price).
 */
import { createKernelAccountClient } from '@zerodev/sdk';
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEther,
  parseEventLogs,
  parseSignature,
  type Address,
  type Hash,
  type PublicClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  CANARY_TARGET,
  CLASSICAL_FAMILY,
  NATIVE_ASSET,
  canary,
  createQanaryAccount,
  drillK1PrivateKey,
  drillRegistryFactoryAbi,
  explorerTxUrl,
  generateMnemonic,
  hotTier,
  hotTierExecutorAbi,
  keyBlob,
  kmsSigner,
  pimlicoPublicBundler,
  pqSignerFromMnemonic,
  quantumValidatorAbi,
  requireContract,
  requireVerifier,
  selfBundleUserOperation,
  storeKey,
  userOperationOutcome,
  type KernelSmartAccount,
  type PqSigner,
} from '../src/index.js';
import {
  bundlerGasPrice,
  chainFor,
  deploymentPath,
  fail,
  flag,
  readDeploymentFile,
  recordE2E,
  requireEnv,
  resolveNetwork,
  rpcUrl,
  secret,
} from './lib.js';

const net = resolveNetwork(flag('network'));
const chain = chainFor(net);
const symbol = net.nativeSymbol;
const HOT_CAP = parseEther('0.00002');
const HOT_WINDOW = 3600;

const loaded = readDeploymentFile(net);
if (!loaded) fail(`${deploymentPath(net)} not found: deploy the contracts to ${net.label} first (docs/DEPLOYING.md)`);
const d = loaded.deployment;
let keyStore: Address, executor: Address, drillFactory: Address, validatorAddress: Address;
try {
  keyStore = requireContract(d, 'keyStore');
  validatorAddress = requireContract(d, 'quantumValidator');
  executor = requireContract(d, 'hotTierExecutor');
  drillFactory = requireContract(d, 'drillRegistryFactory');
  requireVerifier(d, 'mldsa44');
} catch (e) {
  fail((e as Error).message);
}

type Bundler = { kind: 'pimlico' | 'zerodev'; url: string } | { kind: 'self' };

function chooseBundler(): Bundler {
  const forced = flag('bundler');
  const zerodevUrl = (id: string) => `https://rpc.zerodev.app/api/v3/${id}/chain/${net.chainId}`;
  switch (forced) {
    case 'self':
      return { kind: 'self' };
    case 'zerodev':
      return { kind: 'zerodev', url: zerodevUrl(requireEnv('ZERODEV_PROJECT_ID')) };
    case 'pimlico': {
      const url = process.env.BUNDLER_URL ?? pimlicoPublicBundler(net.chainId);
      return url ? { kind: 'pimlico', url } : fail(`Pimlico's public bundler does not serve ${net.label}; set BUNDLER_URL`);
    }
    case undefined:
      break;
    default:
      fail(`unknown --bundler ${forced} (pimlico | zerodev | self)`);
  }
  if (process.env.BUNDLER_URL) return { kind: 'pimlico', url: process.env.BUNDLER_URL };
  if (process.env.ZERODEV_PROJECT_ID) return { kind: 'zerodev', url: zerodevUrl(process.env.ZERODEV_PROJECT_ID) };
  const pimlico = pimlicoPublicBundler(net.chainId);
  return pimlico ? { kind: 'pimlico', url: pimlico } : { kind: 'self' };
}
const bundler = chooseBundler();

const publicClient = createPublicClient({ chain, transport: http(rpcUrl(net)) }) as PublicClient;
const deployer = createWalletClient({
  account: privateKeyToAccount(requireEnv('DEPLOYER_PRIVATE_KEY') as `0x${string}`),
  chain,
  transport: http(rpcUrl(net)),
});
const secretsFile = `e2e-${net.name}.env`;

const record = (values: Record<string, unknown>) => recordE2E(net, 'sdk', values);
const link = (hash: Hash) => explorerTxUrl(net.chainId, hash) ?? hash;
const amount = (wei: bigint) => `${formatEther(wei)} ${symbol}`;

async function waitOk(hash: Hash, what: string): Promise<Hash> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') fail(`${what} reverted: ${link(hash)}`);
  console.log(`  ${what}: ${link(hash)}`);
  return hash;
}

/** Sends a transaction expected to revert with a fixed gas limit so it lands on-chain as failed. */
async function landRevert(send: () => Promise<Hash>, what: string): Promise<Hash> {
  const hash = await send();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'reverted') fail(`${what} was expected to revert but succeeded: ${link(hash)}`);
  console.log(`  ${what} (reverted as expected): ${link(hash)}`);
  return hash;
}

/** Simulates a hot-tier call and returns the custom error it reverts with (`none` if it succeeds). */
async function expectedHotError(from: Address, account: Address, value: bigint): Promise<string> {
  try {
    await publicClient.simulateContract({
      address: executor,
      abi: hotTierExecutorAbi,
      functionName: 'execute',
      args: [account, [{ target: deployer.account.address, value, data: '0x' }]],
      account: from,
    });
  } catch (e) {
    const revert = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : undefined;
    if (revert instanceof ContractFunctionRevertedError) {
      return `${revert.data?.errorName ?? 'unknown'}(${(revert.data?.args ?? []).join(', ')})`;
    }
    throw e;
  }
  return 'none';
}

async function fund(to: Address, value: bigint, what: string): Promise<void> {
  await waitOk(await deployer.sendTransaction({ to, value }), `fund ${what} with ${amount(value)}`);
}

/** Sends one PQ-signed user operation (bundler or self-bundled) and waits for its transaction. */
async function sendPqUserOp(account: KernelSmartAccount, what: string): Promise<{ userOpHash: Hash; tx: Hash }> {
  const calls = [{ to: deployer.account.address, value: 1n, data: '0x' as const }];
  if (bundler.kind === 'self') {
    const { userOpHash, hash } = await selfBundleUserOperation(deployer, account, { calls });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success' || userOperationOutcome(receipt, userOpHash) !== true) {
      fail(`${what} user operation ${userOpHash} failed: ${link(hash)}`);
    }
    console.log(`  ${what} (self-bundled): userOp ${userOpHash} in ${link(hash)}`);
    return { userOpHash, tx: hash };
  }
  const { kind, url } = bundler;
  const client = createKernelAccountClient({
    account,
    chain,
    bundlerTransport: http(url),
    client: publicClient,
    userOperation: { estimateFeesPerGas: () => bundlerGasPrice(url, kind) },
  });
  const userOpHash = await client.sendUserOperation({ calls });
  const receipt = await client.waitForUserOperationReceipt({ hash: userOpHash, timeout: 180_000 });
  if (!receipt.success) fail(`${what} user operation ${userOpHash} failed: ${link(receipt.receipt.transactionHash)}`);
  console.log(`  ${what} (${kind} bundler): userOp ${userOpHash} in ${link(receipt.receipt.transactionHash)}`);
  return { userOpHash, tx: receipt.receipt.transactionHash };
}

async function prepareRoot(signer: PqSigner, label: string): Promise<void> {
  const pointer = await storeKey(deployer, keyStore, keyBlob(signer));
  console.log(`  ${label} key stored at ${pointer}`);
}

async function main(): Promise<void> {
  console.log(`${net.label} (chain ${net.chainId}), bundler: ${bundler.kind === 'self' ? 'self-bundled handleOps' : bundler.kind}`);
  console.log(`deployer: ${deployer.account.address}`);
  const gasPrice = await publicClient.getGasPrice();
  const funding = process.env.E2E_ACCOUNT_FUNDING
    ? parseEther(process.env.E2E_ACCOUNT_FUNDING)
    : gasPrice * 20_000_000n + 2n * HOT_CAP;

  // 1. post-quantum root key
  const signer = pqSignerFromMnemonic('mldsa44', secret(secretsFile, 'QANARY_MNEMONIC', generateMnemonic));
  await prepareRoot(signer, 'ML-DSA-44');

  // 2. drill registry
  const createHash = await deployer.writeContract({ address: drillFactory, abi: drillRegistryFactoryAbi, functionName: 'create' });
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
  const [created] = parseEventLogs({ abi: drillRegistryFactoryAbi, eventName: 'DrillCreated', logs: createReceipt.logs });
  if (!created) fail(`DrillRegistryFactory.create emitted no DrillCreated: ${link(createHash)}`);
  const drill = created.args.registry;
  const drillReader = canary(publicClient, drill);
  const drillKey = privateKeyToAccount(drillK1PrivateKey());
  if (!(await drillReader.isDrill()) || (await drillReader.targets()).k1 !== drillKey.address) {
    fail(`registry ${drill} is not a drill registry over the published drill keys`);
  }
  console.log(`  drill registry ${drill}: ${link(createHash)}`);
  record({ drillRegistry: drill, drillRegistryTx: createHash, bundler: bundler.kind });

  // 3. account with PQ root + hot tier, deployed by its first user operation
  const hotKey = privateKeyToAccount(secret(secretsFile, 'HOT_PRIVATE_KEY', generatePrivateKey) as `0x${string}`);
  const account = await createQanaryAccount(publicClient, {
    signer,
    registry: drill,
    index: BigInt(Date.now()),
    deployment: d,
    hot: {
      window: HOT_WINDOW,
      levelBps: [10_000, 10_000, 5_000, 0],
      signer: { family: 'secp256k1', eoa: hotKey.address },
      assets: [{ asset: NATIVE_ASSET, cap: HOT_CAP }],
    },
  });
  const accountAddress = account.address;
  console.log(`  Kernel account ${accountAddress} (hot key ${hotKey.address})`);
  record({ kernelAccount: accountAddress, hotKey: hotKey.address, hotTierExecutor: executor });
  await fund(accountAddress, funding, 'account');

  const first = await sendPqUserOp(account, 'PQ user operation with initCode');
  record({ pqUserOpHash: first.userOpHash, pqUserOpTx: first.tx });
  const config = await publicClient.readContract({
    address: validatorAddress,
    abi: quantumValidatorAbi,
    functionName: 'configOf',
    args: [accountAddress],
  });
  const hot = hotTier(publicClient, executor);
  const status = await hot.status(accountAddress);
  if (!status.configured) fail('hot tier was not installed by the first user operation');
  console.log(`  root key: verifier ${config.verifier}, keyPtr ${config.keyPtr}; hot tier at ${status.effectiveBps} bps`);

  // 4. hot transfers
  const hotWallet = createWalletClient({ account: hotKey, chain, transport: http(rpcUrl(net)) });
  await fund(hotKey.address, gasPrice * 3_000_000n, 'hot key (gas)');
  const hotSender = hotTier(hotWallet, executor);
  const within = HOT_CAP / 2n;
  const hotTransferTx = await waitOk(
    await hotSender.execute(accountAddress, [{ target: deployer.account.address, value: within }]),
    `hot transfer ${amount(within)} (cap ${amount(HOT_CAP)})`,
  );
  record({ hotTransferTx });

  const overCapError = await expectedHotError(hotKey.address, accountAddress, HOT_CAP);
  if (!overCapError.startsWith('CapExceeded')) fail(`over-cap hot transfer should fail with CapExceeded, got ${overCapError}`);
  console.log(`  over-cap simulation: ${overCapError}`);
  const hotOverCapRevertTx = await landRevert(
    () => hotSender.execute(accountAddress, [{ target: deployer.account.address, value: HOT_CAP }], { gas: 500_000n }),
    'hot transfer over the cap',
  );
  record({ hotOverCapRevertTx });

  // 5. drill trip
  const message = await drillReader.claimMessage(CANARY_TARGET.K1, deployer.account.address);
  const proof = parseSignature(await drillKey.sign({ hash: message }));
  const drillClaimTx = await waitOk(await canary(deployer, drill).claim(CANARY_TARGET.K1, proof), 'drill K1 claim');
  record({ drillClaimTx });
  if (!(await drillReader.familyBroken(CLASSICAL_FAMILY.secp256k1))) fail('drill claim did not mark secp256k1 broken');
  console.log(`  ladder level ${await drillReader.level()}, secp256k1 broken; hot tier at ${await hot.effectiveBps(accountAddress)} bps`);

  // 6. post-trip refusal
  const postTripError = await expectedHotError(hotKey.address, accountAddress, 1n);
  if (!postTripError.startsWith('ClassicalFamilyBroken')) {
    fail(`post-trip hot transfer should fail with ClassicalFamilyBroken, got ${postTripError}`);
  }
  console.log(`  post-trip simulation: ${postTripError}`);
  const postTripHotRevertTx = await landRevert(
    () => hotSender.execute(accountAddress, [{ target: deployer.account.address, value: 1n }], { gas: 500_000n }),
    'hot transfer after the trip',
  );
  record({ postTripHotRevertTx });

  // 7. same user-operation flow with the AWS KMS root key
  const keyId = process.env.QANARY_KMS_KEY_ID;
  if (!keyId) {
    console.log('QANARY_KMS_KEY_ID not set: skipping the KMS leg');
  } else {
    const kms = await kmsSigner({ keyId, region: process.env.AWS_REGION });
    await prepareRoot(kms, 'AWS KMS ML-DSA-44');
    const kmsAccount = await createQanaryAccount(publicClient, {
      signer: kms,
      registry: drill,
      index: BigInt(Date.now()),
      deployment: d,
    });
    console.log(`  KMS Kernel account ${kmsAccount.address}`);
    await fund(kmsAccount.address, funding, 'KMS account');
    const kmsOp = await sendPqUserOp(kmsAccount, 'KMS-signed user operation with initCode');
    record({ kmsKernelAccount: kmsAccount.address, kmsUserOpHash: kmsOp.userOpHash, kmsUserOpTx: kmsOp.tx });
  }

  record({ ranAt: new Date().toISOString() });
  console.log(`done: hashes recorded in ${deploymentPath(net)} (e2e.sdk)`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
