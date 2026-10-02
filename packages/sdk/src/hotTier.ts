import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  getAbiItem,
  isAddress,
  isHex,
  maxUint128,
  size,
  zeroAddress,
  type Account,
  type Address,
  type Chain,
  type Client,
  type Hash,
  type Hex,
  type Transport,
} from 'viem';
import { readContract, writeContract } from 'viem/actions';
import { hotTierExecutorAbi } from './abis/hotTierExecutor.js';
import { kernelModuleAbi } from './abis/kernel.js';

/** ERC-7579 module type id of executors. */
export const MODULE_TYPE_EXECUTOR = 2;

/** `address(0)` in a hot-tier asset list tracks native ETH. */
export const NATIVE_ASSET: Address = zeroAddress;

/** Hot-key signature families (`HotTierExecutor.Family`, same ids as the canary registry). */
export const HOT_FAMILY = { secp256k1: 0, p256: 1 } as const;

/** How the executor dispatches into the account (`HotTierExecutor.AccountKind`). */
export const ACCOUNT_KIND = { erc7579: 0, safe: 1 } as const;

/** Upper bound on tracked assets per account (`HotTierExecutor.MAX_ASSETS`). */
export const MAX_HOT_ASSETS = 8;

export type HotSignerConfig = { family: 'secp256k1'; eoa: Address } | { family: 'p256'; pubX: Hex; pubY: Hex };

/**
 * Hot-tier policy of an account, minus the canary registry it follows.
 *
 * - `window`: seconds for an emptied bucket to refill to its (scaled) cap.
 * - `levelBps[l]`: basis points applied to every cap at canary ladder level `l` (non-increasing;
 *   0 freezes the hot tier at that level).
 * - `assets`: tracked assets and their caps (`NATIVE_ASSET` for ETH). An ERC-20 `transfer` on a
 *   tracked token is allowed implicitly; any other call needs an `allow` entry.
 */
export type HotSetup = {
  kind?: keyof typeof ACCOUNT_KIND;
  window: number;
  levelBps: readonly [number, number, number, number];
  signer: HotSignerConfig;
  assets: readonly { asset: Address; cap: bigint }[];
  allow?: readonly { target: Address; selector: Hex }[];
};

/** A full executor configuration: the hot-tier policy plus the canary registry it follows. */
export type HotTierConfig = HotSetup & { registry: Address };

/** One call of a hot operation (`HotTierExecutor.Call`). */
export type HotCall = { target: Address; value?: bigint; data?: Hex };

/** A call for the account itself to execute (e.g. in a user operation). */
export type AccountCall = { to: Address; value: bigint; data: Hex };

function assertConfig(c: HotTierConfig): void {
  if (!isAddress(c.registry) || c.registry === zeroAddress) throw new Error('hot tier: registry must be a non-zero address');
  if (!Number.isInteger(c.window) || c.window <= 0 || c.window > 0xffffffff) {
    throw new Error('hot tier: window must be a positive uint32 (seconds)');
  }
  if (c.levelBps.length !== 4) throw new Error('hot tier: levelBps needs 4 entries');
  c.levelBps.forEach((bps, i) => {
    if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error('hot tier: levelBps entries must be 0..10000');
    if (i > 0 && bps > c.levelBps[i - 1]!) throw new Error('hot tier: levelBps must be non-increasing');
  });
  if (c.assets.length > MAX_HOT_ASSETS) throw new Error(`hot tier: at most ${MAX_HOT_ASSETS} tracked assets`);
  const seen = new Set<string>();
  for (const { asset, cap } of c.assets) {
    if (!isAddress(asset)) throw new Error(`hot tier: invalid asset ${asset}`);
    if (seen.has(asset.toLowerCase())) throw new Error(`hot tier: duplicate asset ${asset}`);
    seen.add(asset.toLowerCase());
    if (cap < 0n || cap > maxUint128) throw new Error('hot tier: caps must fit in uint128');
  }
  for (const { target, selector } of c.allow ?? []) {
    if (!isAddress(target)) throw new Error(`hot tier: invalid allow target ${target}`);
    if (!isHex(selector) || size(selector) !== 4) throw new Error(`hot tier: allow selector must be 4 bytes`);
  }
  const s = c.signer;
  if (s.family === 'secp256k1' ? !isAddress(s.eoa) || s.eoa === zeroAddress : !isHex(s.pubX) || !isHex(s.pubY)) {
    throw new Error('hot tier: invalid hot signer');
  }
}

function hotSignerStruct(s: HotSignerConfig) {
  const zero32: Hex = `0x${'00'.repeat(32)}`;
  return s.family === 'secp256k1'
    ? { family: HOT_FAMILY.secp256k1, eoa: s.eoa, pubX: zero32, pubY: zero32 }
    : { family: HOT_FAMILY.p256, eoa: zeroAddress, pubX: s.pubX, pubY: s.pubY };
}

/** The `HotTierExecutor.Setup` struct for `config`, as viem encodes it. */
export function hotTierSetupStruct(config: HotTierConfig) {
  assertConfig(config);
  return {
    kind: ACCOUNT_KIND[config.kind ?? 'erc7579'],
    registry: config.registry,
    window: config.window,
    levelBps: [...config.levelBps] as [number, number, number, number],
    signer: hotSignerStruct(config.signer),
    assets: config.assets.map((a) => a.asset),
    caps: config.assets.map((a) => a.cap),
    allow: (config.allow ?? []).map((e) => ({ target: e.target, selector: e.selector })),
  };
}

const configureItem = getAbiItem({ abi: hotTierExecutorAbi, name: 'configure' });

/** `abi.encode(Setup)`: the executor's `onInstall` data. */
export function encodeHotTierSetup(config: HotTierConfig): Hex {
  return encodeAbiParameters(configureItem.inputs, [hotTierSetupStruct(config)]);
}

/**
 * Kernel v3 `installModule(2, executor, initData)` payload for the hot tier:
 * `hook (20 bytes, address(0) = no hook) ‖ abi.encode(bytes executorData, bytes hookData)` with
 * `executorData = abi.encode(Setup)` and empty `hookData`.
 */
export function hotTierInitData(config: HotTierConfig): Hex {
  return concat([
    zeroAddress,
    encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes' }], [encodeHotTierSetup(config), '0x']),
  ]);
}

/**
 * The call that installs the hot tier on a Kernel account: `account.installModule(2, executor, …)`.
 * Batch it into a user operation's execution phase (the executor's `onInstall` touches storage and
 * opcodes that ERC-7562 forbids during validation, so it cannot run inside `initCode`).
 */
export function installHotTierCall(account: Address, executor: Address, config: HotTierConfig): AccountCall {
  return {
    to: account,
    value: 0n,
    data: encodeFunctionData({
      abi: kernelModuleAbi,
      functionName: 'installModule',
      args: [BigInt(MODULE_TYPE_EXECUTOR), executor, hotTierInitData(config)],
    }),
  };
}

function toCalls(calls: readonly HotCall[]) {
  return calls.map((c) => ({ target: c.target, value: c.value ?? 0n, data: c.data ?? '0x' }));
}

export type HotTierStatus =
  | { configured: false }
  | {
      configured: true;
      /** Basis points currently applied to every cap; 0 when frozen or the hot key's family is broken. */
      effectiveBps: number;
      frozen: boolean;
      nonce: bigint;
      assets: { asset: Address; available: bigint }[];
    };

type AnyClient = Client<Transport, Chain | undefined, Account | undefined>;

function requireAccount(client: AnyClient, what: string): Account {
  if (!client.account) throw new Error(`hotTier.${what}: the client has no account to send from`);
  return client.account;
}

/**
 * Client for a HotTierExecutor. Reads work with any client; `execute` sends from the client's
 * account (which must be the hot EOA), `executeWithSig` from any account (a relayer).
 * `configure` returns the call the smart account itself must execute (`msg.sender` = account).
 */
export function hotTier(client: AnyClient, executor: Address) {
  const contract = { address: executor, abi: hotTierExecutorAbi } as const;
  const nonceOf = (account: Address) => readContract(client, { ...contract, functionName: 'nonceOf', args: [account] });

  const api = {
    address: executor,

    /** The call reconfiguring the hot tier, to be executed by the account. */
    configure(config: HotTierConfig): AccountCall {
      return {
        to: executor,
        value: 0n,
        data: encodeFunctionData({ abi: hotTierExecutorAbi, functionName: 'configure', args: [hotTierSetupStruct(config)] }),
      };
    },

    /** Sends `execute(account, calls)` from the hot EOA (the client's account). */
    async execute(account: Address, calls: readonly HotCall[], opts: { gas?: bigint } = {}): Promise<Hash> {
      return writeContract(client, {
        address: executor,
        abi: hotTierExecutorAbi,
        functionName: 'execute',
        args: [account, toCalls(calls)],
        account: requireAccount(client, 'execute'),
        chain: client.chain,
        gas: opts.gas,
      });
    },

    /** `hotOpDigest(account, calls, nonce, deadline)`: the EIP-712 digest the hot key signs. */
    async hotOpDigest(account: Address, calls: readonly HotCall[], nonce: bigint, deadline: bigint): Promise<Hex> {
      return readContract(client, {
        ...contract,
        functionName: 'hotOpDigest',
        args: [account, toCalls(calls), nonce, deadline],
      });
    },

    /**
     * Signs a hot operation with `sign` (ECDSA: a 65-byte signature, e.g. `(d) => hotKey.sign({ hash: d })`;
     * P-256: `abi.encode(WebAuthnAuth)`) over the current nonce and sends `executeWithSig` from the
     * client's account. `deadline` defaults to 10 minutes from now.
     */
    async executeWithSig(
      account: Address,
      calls: readonly HotCall[],
      opts: { sign: (digest: Hex) => Promise<Hex>; deadline?: bigint; gas?: bigint },
    ): Promise<Hash> {
      const sender = requireAccount(client, 'executeWithSig');
      const deadline = opts.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 600);
      const nonce = await nonceOf(account);
      const sig = await opts.sign(await api.hotOpDigest(account, calls, nonce, deadline));
      return writeContract(client, {
        address: executor,
        abi: hotTierExecutorAbi,
        functionName: 'executeWithSig',
        args: [account, toCalls(calls), deadline, sig],
        account: sender,
        chain: client.chain,
        gas: opts.gas,
      });
    },

    /** Spendable amount of `asset` right now (after refill, at the current threat level). */
    async available(account: Address, asset: Address): Promise<bigint> {
      return readContract(client, { ...contract, functionName: 'available', args: [account, asset] });
    },

    /** Basis points applied to every cap now; 0 when frozen or the hot key's family is broken. */
    async effectiveBps(account: Address): Promise<number> {
      return readContract(client, { ...contract, functionName: 'effectiveBps', args: [account] });
    },

    /** Configuration state, effective scale, nonce and per-asset availability of `account`. */
    async status(account: Address): Promise<HotTierStatus> {
      const configured = await readContract(client, { ...contract, functionName: 'isInitialized', args: [account] });
      if (!configured) return { configured: false };
      const [effectiveBps, nonce, tracked] = await Promise.all([
        api.effectiveBps(account),
        nonceOf(account),
        readContract(client, { ...contract, functionName: 'trackedAssets', args: [account] }),
      ]);
      const assets = await Promise.all(
        tracked.map(async (asset) => ({ asset, available: await api.available(account, asset) })),
      );
      return { configured: true, effectiveBps, frozen: effectiveBps === 0, nonce, assets };
    },
  };
  return api;
}
