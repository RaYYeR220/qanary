import { createKernelAccount, type CreateKernelAccountReturnType } from '@zerodev/sdk';
import { KERNEL_V3_3 } from '@zerodev/sdk/constants';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { entryPoint07Address } from 'viem/account-abstraction';
import { getChainId } from 'viem/actions';
import { kernelModuleAbi } from './abis/kernel.js';
import { getDeployment, requireContract, requireVerifier, type Deployment } from './deployments.js';
import { hotTierInitData, MODULE_TYPE_EXECUTOR, type HotSetup } from './hotTier.js';
import type { PqSigner } from './schemes.js';
import { toQuantumValidator } from './validator.js';

/** Client accepted by `createQanaryAccount` (a public client, or a wallet client with a local account). */
export type KernelAccountClientBase = Parameters<typeof createKernelAccount>[0];

/** A Kernel v3.3 smart account on EntryPoint v0.7, as returned by `createQanaryAccount`. */
export type KernelSmartAccount = CreateKernelAccountReturnType<'0.7'>;

/** EntryPoint v0.7, the entry point Qanary Kernel accounts use. */
export const QANARY_ENTRY_POINT = { address: entryPoint07Address, version: '0.7' } as const;

/** Kernel version of Qanary accounts. */
export const QANARY_KERNEL_VERSION = KERNEL_V3_3;

export type CreateQanaryAccountOptions = {
  /** Post-quantum root key. Its blob must be in the KeyStore (`storeKey`) before the account is deployed. */
  signer: PqSigner;
  /** Optional hot tier (classical key with capped, canary-throttled spending). */
  hot?: HotSetup;
  /** Canary registry the hot tier follows. */
  registry: Address;
  /** Kernel account index (salt); different indexes give different accounts for the same key. */
  index?: bigint;
  /**
   * Where the hot tier is installed:
   * - `'userOp'` (default): `installModule(2, executor, …)` is appended to the account's first user
   *   operation (execution phase). Required with ERC-7562 bundlers: the executor's `onInstall`
   *   reads `block.timestamp` and writes storage not associated with the account, both forbidden
   *   while `initCode` runs.
   * - `'initCode'`: installed by `Kernel.initialize` through `initConfig`, so the account is born
   *   with it. Only for self-bundled `handleOps`; the hot setup then also changes the address.
   */
  hotInstall?: 'userOp' | 'initCode';
  /** Contract addresses; default: the deployment for the client's chain. */
  deployment?: Deployment;
  /** Known account address; skips the EntryPoint `getSenderAddress` lookup. */
  address?: Address;
};

/**
 * Creates (counterfactually) a Kernel v3.3 account whose root (sudo) validator is the
 * QuantumValidator with `signer` as its post-quantum key, optionally with a HotTierExecutor.
 *
 * The account is deployed by its first user operation (`initCode` through Kernel's meta-factory).
 * The validator is installed without guardians, as ERC-7562 requires during `initCode`; add them
 * later with `setGuardiansCall`.
 */
export async function createQanaryAccount(
  client: KernelAccountClientBase,
  opts: CreateQanaryAccountOptions,
): Promise<KernelSmartAccount> {
  const chainId = client.chain?.id ?? (await getChainId(client));
  const d = opts.deployment ?? getDeployment(chainId);
  const validator = await toQuantumValidator(client, {
    signer: opts.signer,
    entryPoint: QANARY_ENTRY_POINT,
    kernelVersion: QANARY_KERNEL_VERSION,
    validatorAddress: requireContract(d, 'quantumValidator'),
    verifier: requireVerifier(d, opts.signer.scheme),
    keyStore: requireContract(d, 'keyStore'),
  });

  let pluginMigrations: { type: number; address: Address; data: Hex }[] | undefined;
  let initConfig: Hex[] | undefined;
  if (opts.hot) {
    const executor = requireContract(d, 'hotTierExecutor');
    const data = hotTierInitData({ ...opts.hot, registry: opts.registry });
    if (opts.hotInstall === 'initCode') {
      initConfig = [
        encodeFunctionData({
          abi: kernelModuleAbi,
          functionName: 'installModule',
          args: [BigInt(MODULE_TYPE_EXECUTOR), executor, data],
        }),
      ];
    } else {
      pluginMigrations = [{ type: MODULE_TYPE_EXECUTOR, address: executor, data }];
    }
  }

  return createKernelAccount(client, {
    plugins: { sudo: validator },
    entryPoint: QANARY_ENTRY_POINT,
    kernelVersion: QANARY_KERNEL_VERSION,
    accountImplementationAddress: d.kernel.implementation,
    factoryAddress: d.kernel.factory,
    metaFactoryAddress: d.kernel.metaFactory,
    index: opts.index ?? 0n,
    address: opts.address,
    initConfig,
    pluginMigrations,
  });
}
