/**
 * End-to-end run on Arbitrum Sepolia through a production ERC-4337 bundler.
 *
 *   DEPLOYER_PRIVATE_KEY=0x… npx tsx scripts/e2e-sepolia.ts
 *
 * 1. ML-DSA-44 key from a BIP-39 mnemonic → KeyStore.
 * 2. Drill canary registry (published drill keys) from the DrillRegistryFactory.
 * 3. Kernel v3.3 account with the QuantumValidator as root, deployed by its first user operation
 *    (initCode) and sent through the bundler: the bundler's ERC-7562 validation accepts it. The
 *    same operation installs the hot tier (capped ETH spending by a classical hot key).
 * 4. Hot transfer within the cap → succeeds; over the cap → reverts on-chain (CapExceeded).
 * 5. Drill trip: K1 claim with the published drill key marks secp256k1 broken.
 * 6. Hot transfer after the trip → reverts on-chain (ClassicalFamilyBroken).
 * 7. With QANARY_KMS_KEY_ID: the same account flow with an AWS KMS ML-DSA-44 root key.
 *
 * Transaction hashes are written to deployments/arbitrum-sepolia.json under `e2e.sdk`.
 *
 * Env: DEPLOYER_PRIVATE_KEY (pays gas and funds the accounts), ARB_SEPOLIA_RPC,
 * QANARY_MNEMONIC (default: a fresh one, printed), HOT_PRIVATE_KEY (default: fresh),
 * ZERODEV_PROJECT_ID (use the ZeroDev bundler instead of Pimlico's public endpoint), BUNDLER_URL,
 * QANARY_KMS_KEY_ID + AWS_REGION, E2E_ACCOUNT_FUNDING (ETH per account, default 0.003).
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
import { arbitrumSepolia } from 'viem/chains';
import {
  CANARY_TARGET,
  CLASSICAL_FAMILY,
  NATIVE_ASSET,
  canary,
  createQanaryAccount,
  drillK1PrivateKey,
  drillRegistryFactoryAbi,
  generateMnemonic,
  hotTier,
  hotTierExecutorAbi,
  keyBlob,
  kmsSigner,
  pqSignerFromMnemonic,
  quantumValidatorAbi,
  requireContract,
  requireVerifier,
  storeKey,
  type KernelSmartAccount,
  type PqSigner,
} from '../src/index.js';
import { bundlerGasPrice, deploymentPath, fail, readDeploymentFile, recordE2E, requireEnv, rpcUrl } from './lib.js';

const NETWORK = 'arbitrum-sepolia';
const HOT_CAP = parseEther('0.00002');
const HOT_WINDOW = 3600;

const loaded = readDeploymentFile(NETWORK);
if (!loaded) {
  fail(`${deploymentPath(NETWORK)} not found: deploy the contracts to Arbitrum Sepolia first (docs/DEPLOYING.md)`);
}
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

const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl(NETWORK)) }) as PublicClient;
const deployer = createWalletClient({
  account: privateKeyToAccount(requireEnv('DEPLOYER_PRIVATE_KEY') as `0x${string}`),
  chain: arbitrumSepolia,
  transport: http(rpcUrl(NETWORK)),
});
const funding = parseEther(process.env.E2E_ACCOUNT_FUNDING ?? '0.003');

const zerodev = process.env.ZERODEV_PROJECT_ID;
const bundlerKind = zerodev ? 'zerodev' : 'pimlico';
const bundlerUrl =
  process.env.BUNDLER_URL ??
  (zerodev
    ? `https://rpc.zerodev.app/api/v3/${zerodev}/chain/${arbitrumSepolia.id}`
    : `https://public.pimlico.io/v2/${arbitrumSepolia.id}/rpc`);

const record = (values: Record<string, unknown>) => recordE2E(NETWORK, 'sdk', values);
const explorer = (hash: Hash) => `https://sepolia.arbiscan.io/tx/${hash}`;

async function waitOk(hash: Hash, what: string): Promise<Hash> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') fail(`${what} reverted: ${explorer(hash)}`);
  console.log(`  ${what}: ${explorer(hash)}`);
  return hash;
}

/** Sends a transaction expected to revert with a fixed gas limit so it lands on-chain as failed. */
async function landRevert(send: () => Promise<Hash>, what: string): Promise<Hash> {
  const hash = await send();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'reverted') fail(`${what} was expected to revert but succeeded: ${explorer(hash)}`);
  console.log(`  ${what} (reverted as expected): ${explorer(hash)}`);
  return hash;
}

/** Simulates a hot-tier call and returns the custom error name it reverts with. */
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
  const hash = await deployer.sendTransaction({ to, value });
  await waitOk(hash, `fund ${what} with ${formatEther(value)} ETH`);
}

function kernelClient(account: KernelSmartAccount) {
  return createKernelAccountClient({
    account,
    chain: arbitrumSepolia,
    bundlerTransport: http(bundlerUrl),
    client: publicClient,
    userOperation: { estimateFeesPerGas: () => bundlerGasPrice(bundlerUrl, bundlerKind) },
  });
}

/** Sends one PQ-signed user operation and waits for its bundle transaction. */
async function sendPqUserOp(account: KernelSmartAccount, what: string): Promise<{ userOpHash: Hash; tx: Hash }> {
  const client = kernelClient(account);
  const userOpHash = await client.sendUserOperation({
    calls: [{ to: deployer.account.address, value: 1n, data: '0x' }],
  });
  const receipt = await client.waitForUserOperationReceipt({ hash: userOpHash, timeout: 180_000 });
  if (!receipt.success) fail(`${what} user operation ${userOpHash} failed: ${explorer(receipt.receipt.transactionHash)}`);
  console.log(`  ${what}: userOp ${userOpHash} in ${explorer(receipt.receipt.transactionHash)}`);
  return { userOpHash, tx: receipt.receipt.transactionHash };
}

async function prepareRoot(signer: PqSigner, label: string): Promise<void> {
  const pointer = await storeKey(deployer, keyStore, keyBlob(signer));
  console.log(`  ${label} key stored at ${pointer}`);
}

async function main(): Promise<void> {
  console.log(`bundler: ${bundlerKind} (${zerodev ? 'ZeroDev project' : bundlerUrl})`);
  console.log(`deployer: ${deployer.account.address}`);

  // 1. post-quantum root key
  let mnemonic = process.env.QANARY_MNEMONIC;
  if (!mnemonic) {
    mnemonic = generateMnemonic();
    console.log(`fresh testnet mnemonic (set QANARY_MNEMONIC to reuse): ${mnemonic}`);
  }
  const signer = pqSignerFromMnemonic('mldsa44', mnemonic);
  await prepareRoot(signer, 'ML-DSA-44');

  // 2. drill registry
  const createHash = await deployer.writeContract({ address: drillFactory, abi: drillRegistryFactoryAbi, functionName: 'create' });
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
  const [created] = parseEventLogs({ abi: drillRegistryFactoryAbi, eventName: 'DrillCreated', logs: createReceipt.logs });
  if (!created) fail(`DrillRegistryFactory.create emitted no DrillCreated: ${explorer(createHash)}`);
  const drill = created.args.registry;
  const drillReader = canary(publicClient, drill);
  const drillKey = privateKeyToAccount(drillK1PrivateKey());
  if (!(await drillReader.isDrill()) || (await drillReader.targets()).k1 !== drillKey.address) {
    fail(`registry ${drill} is not a drill registry over the published drill keys`);
  }
  console.log(`  drill registry ${drill}: ${explorer(createHash)}`);
  record({ drillRegistry: drill, drillRegistryTx: createHash, bundler: bundlerKind });

  // 3. account with PQ root + hot tier, deployed by its first user operation
  const hotKey = privateKeyToAccount((process.env.HOT_PRIVATE_KEY as `0x${string}` | undefined) ?? generatePrivateKey());
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
  const hotWallet = createWalletClient({ account: hotKey, chain: arbitrumSepolia, transport: http(rpcUrl(NETWORK)) });
  await fund(hotKey.address, parseEther('0.0002'), 'hot key (gas)');
  const hotSender = hotTier(hotWallet, executor);
  const within = HOT_CAP / 2n;
  const hotTransferTx = await waitOk(
    await hotSender.execute(accountAddress, [{ target: deployer.account.address, value: within }]),
    `hot transfer ${formatEther(within)} ETH (cap ${formatEther(HOT_CAP)})`,
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
  console.log(`done: hashes recorded in ${deploymentPath(NETWORK)} (e2e.sdk)`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
