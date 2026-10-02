import { createKernelAccount, KernelV3_3AccountAbi, type CreateKernelAccountReturnType } from '@zerodev/sdk';
import { KERNEL_V3_3 } from '@zerodev/sdk/constants';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { entryPoint07Address } from 'viem/account-abstraction';
import { getChainId, getCode } from 'viem/actions';
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
   * - `'userOp'` (default): `installModule(2, executor, …)` is appended to the next user operation
   *   (execution phase) — see `installHotTier` for when. Required with ERC-7562 bundlers: the
   *   executor's `onInstall` reads `block.timestamp` and writes storage not associated with the
   *   account, both forbidden while `initCode` runs.
   * - `'initCode'`: installed by `Kernel.initialize` through `initConfig`, so the account is born
   *   with it. Only for self-bundled `handleOps`; the hot setup then also changes the address.
   */
  hotInstall?: 'userOp' | 'initCode';
  /**
   * With `hotInstall: 'userOp'`, whether this account object appends the hot-tier install to its
   * user operations (only while the executor is not installed). Default: only if the account is
   * not deployed yet when the object is created, i.e. the install rides on the deploying user
   * operation. For a deployed account the hot setup is ignored unless this is `true`, so an
   * executor the owner uninstalled (e.g. after a hot-key leak) is never silently reinstalled with
   * a stale setup by a later session.
   */
  installHotTier?: boolean;
  /** Contract addresses; default: the deployment for the client's chain. Must match that chain. */
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
  if (d.chainId !== chainId) {
    throw new Error(`deployment is for chain ${d.chainId} (${d.network}) but the client is on chain ${chainId}`);
  }
  const entryPoint = { address: d.entryPoint, version: '0.7' } as const;
  const validator = await toQuantumValidator(client, {
    signer: opts.signer,
    entryPoint,
    kernelVersion: QANARY_KERNEL_VERSION,
    validatorAddress: requireContract(d, 'quantumValidator'),
    verifier: requireVerifier(d, opts.signer.scheme),
    keyStore: requireContract(d, 'keyStore'),
  });

  let hotInitData: Hex | undefined;
  let executor: Address | undefined;
  let initConfig: Hex[] | undefined;
  if (opts.hot) {
    executor = requireContract(d, 'hotTierExecutor');
    hotInitData = hotTierInitData({ ...opts.hot, registry: opts.registry });
    if (opts.hotInstall === 'initCode') {
      initConfig = [
        encodeFunctionData({
          abi: KernelV3_3AccountAbi,
          functionName: 'installModule',
          args: [BigInt(MODULE_TYPE_EXECUTOR), executor, hotInitData],
        }),
      ];
    }
  }

  const create = (address: Address | undefined, migrate: boolean) =>
    createKernelAccount(client, {
      plugins: { sudo: validator },
      entryPoint,
      kernelVersion: QANARY_KERNEL_VERSION,
      accountImplementationAddress: d.kernel.implementation,
      factoryAddress: d.kernel.factory,
      metaFactoryAddress: d.kernel.metaFactory,
      index: opts.index ?? 0n,
      address,
      initConfig,
      // ZeroDev appends `installModule` for pending migrations to every user operation until
      // `isModuleInstalled` reports the module, so it is only armed when installing is intended.
      pluginMigrations:
        migrate && executor && hotInitData ? [{ type: MODULE_TYPE_EXECUTOR, address: executor, data: hotInitData }] : undefined,
    });

  const account = await create(opts.address, false);
  if (!hotInitData || opts.hotInstall === 'initCode' || opts.installHotTier === false) return account;
  let migrate = opts.installHotTier === true;
  if (!migrate) {
    const code = await getCode(client, { address: account.address });
    migrate = !code || code === '0x';
  }
  return migrate ? create(account.address, true) : account;
}
