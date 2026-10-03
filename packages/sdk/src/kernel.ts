import { createKernelAccount, KernelV3_3AccountAbi, type CreateKernelAccountReturnType } from '@zerodev/sdk';
import { KERNEL_V3_3 } from '@zerodev/sdk/constants';
import {
  BaseError,
  concat,
  decodeErrorResult,
  encodeFunctionData,
  isAddressEqual,
  parseAbi,
  zeroAddress,
  type Address,
  type Client,
  type Hex,
} from 'viem';
import { entryPoint07Address } from 'viem/account-abstraction';
import { call, getChainId, getCode } from 'viem/actions';
import { getDeployment, requireContract, requireVerifier, type Deployment } from './deployments.js';
import { hotTierInitData, MODULE_TYPE_EXECUTOR, type HotSetup } from './hotTier.js';
import { keyBlob, predictKeyPointer } from './keystore.js';
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

  // The EntryPoint works the address out by running the deployment, whose validator install reads
  // the root key from the KeyStore. Before `storeKey` there is no key to read and the answer is
  // the zero address, so the lookup runs with the key's code in place (see `counterfactualAddress`).
  let address = opts.address;
  if (address === undefined) {
    const blob = keyBlob(opts.signer);
    const keyPtr = predictKeyPointer(requireContract(d, 'keyStore'), blob);
    // the deployment call does not depend on the address: a placeholder skips ZeroDev's own lookup
    const draft = await create(DRAFT_ADDRESS, false);
    const { factory, factoryData } = await draft.getFactoryArgs();
    address =
      factory && factoryData
        ? await counterfactualAddress(client as Client, { entryPoint: d.entryPoint, factory, factoryData, keyPtr, blob })
        : // a node that reports code at the placeholder gives no deployment call: ask the plain way
          (await create(undefined, false)).address;
  }
  if (isAddressEqual(address, zeroAddress)) throw new Error('createQanaryAccount: the account address cannot be the zero address');
  const account = await create(address, false);
  if (!hotInitData || opts.hotInstall === 'initCode' || opts.installHotTier === false) return account;
  let migrate = opts.installHotTier === true;
  if (!migrate) {
    const code = await getCode(client, { address: account.address });
    migrate = !code || code === '0x';
  }
  return migrate ? create(account.address, true) : account;
}

/** Placeholder address for an account object built only to read its deployment call. */
const DRAFT_ADDRESS: Address = '0x0000000000000000000000000000000000000001';

const entryPointSenderAbi = parseAbi(['function getSenderAddress(bytes initCode)', 'error SenderAddressResult(address sender)']);

/** The revert data inside a failed call, wherever viem nested it. */
function revertData(e: unknown): Hex | undefined {
  if (!(e instanceof BaseError)) return undefined;
  const found = e.walk((x) => {
    const d = (x as { data?: unknown }).data;
    return typeof d === 'string' || (typeof d === 'object' && d !== null && typeof (d as { data?: unknown }).data === 'string');
  }) as { data?: Hex | { data: Hex } } | null;
  const d = found?.data;
  return typeof d === 'string' ? d : d?.data;
}

/**
 * The address the EntryPoint deploys `factory`/`factoryData` to, asked with `EntryPoint.getSenderAddress`
 * while the root key's code (`0x00 ‖ blob`, what `KeyStore.store` writes at `keyPtr`) is put in place by a
 * state override of that one call. It works the same before and after `storeKey`. Throws instead of
 * returning the zero address, which is what the EntryPoint reports when the deployment fails.
 */
export async function counterfactualAddress(
  client: Client,
  args: { entryPoint: Address; factory: Address; factoryData: Hex; keyPtr: Address; blob: Hex },
): Promise<Address> {
  let sender: Address | undefined;
  try {
    await call(client, {
      to: args.entryPoint,
      data: encodeFunctionData({ abi: entryPointSenderAbi, functionName: 'getSenderAddress', args: [concat([args.factory, args.factoryData])] }),
      stateOverride: [{ address: args.keyPtr, code: concat(['0x00', args.blob]) }],
    });
  } catch (e) {
    const data = revertData(e);
    if (data) {
      try {
        const r = decodeErrorResult({ abi: entryPointSenderAbi, data });
        if (r.errorName === 'SenderAddressResult') sender = r.args[0];
      } catch {
        // some other revert: reported below
      }
    }
    if (!sender) throw e;
  }
  if (!sender) throw new Error('counterfactualAddress: getSenderAddress returned instead of reverting with the address');
  if (isAddressEqual(sender, zeroAddress)) {
    throw new Error('counterfactualAddress: the account deployment fails (the EntryPoint reports the zero address)');
  }
  return sender;
}
