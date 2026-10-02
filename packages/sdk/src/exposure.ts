import {
  erc20Abi,
  getAddress,
  isAddressEqual,
  keccak256,
  recoverPublicKey,
  serializeTransaction,
  size,
  sliceHex,
  zeroAddress,
  type Address,
  type Client,
  type Hash,
  type Hex,
  type SignedAuthorization,
  type Transaction,
  type TransactionSerializable,
} from 'viem';
import {
  getBalance,
  getBlock,
  getBlockNumber,
  getChainId,
  getCode,
  getTransaction,
  getTransactionCount,
  readContract,
} from 'viem/actions';
import { hashAuthorization, publicKeyToAddress } from 'viem/utils';
import { nativeSymbol, networkByChainId } from './networks.js';

/** EIP-7702 delegation designator prefix: an EOA's code is `0xef0100 ‖ delegate`. */
export const DELEGATION_PREFIX: Hex = '0xef0100';

/** The delegate of an EIP-7702 delegated EOA, or `undefined` if `code` is not a delegation designator. */
export function parseDelegation(code: Hex | undefined): Address | undefined {
  if (!code || size(code) !== 23 || !code.toLowerCase().startsWith(DELEGATION_PREFIX)) return undefined;
  return getAddress(sliceHex(code, 3));
}

/**
 * Default token list for `scanExposure`: the network's `tokens` (USDC, USDG, WETH and ARB on
 * Arbitrum One); empty for networks without a list and for unknown chains.
 */
export function defaultExposureTokens(chainId: number): Address[] {
  return Object.values(networkByChainId(chainId)?.tokens ?? {});
}

/** Recovery id of a transaction signature (legacy `v` 27/28 or EIP-155, else `yParity`). */
function yParityOf(tx: Transaction): number {
  if (tx.type === 'legacy') {
    const v = tx.v;
    if (v === 27n || v === 28n) return Number(v - 27n);
    if (v >= 35n) return Number((v - 35n) % 2n);
    if (v === 0n || v === 1n) return Number(v);
    throw new Error(`transaction ${tx.hash}: unsupported legacy v ${v}`);
  }
  return tx.yParity;
}

/** The unsigned transaction (as serialized for signing) for a mined transaction. */
function unsignedTransaction(tx: Transaction): TransactionSerializable {
  const base = { nonce: tx.nonce, gas: tx.gas, to: tx.to ?? undefined, value: tx.value, data: tx.input };
  switch (tx.type) {
    case 'legacy': {
      // EIP-155: v = chainId * 2 + 35 + yParity; v = 27/28 means a pre-EIP-155 (chain-less) signature.
      const chainId = tx.v >= 35n ? Number((tx.v - 35n) / 2n) : undefined;
      return { ...base, type: 'legacy', gasPrice: tx.gasPrice, chainId };
    }
    case 'eip2930':
      return { ...base, type: 'eip2930', chainId: tx.chainId, gasPrice: tx.gasPrice, accessList: tx.accessList };
    case 'eip1559':
      return {
        ...base,
        type: 'eip1559',
        chainId: tx.chainId,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        accessList: tx.accessList,
      };
    case 'eip7702':
      return {
        ...base,
        type: 'eip7702',
        chainId: tx.chainId,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        accessList: tx.accessList,
        authorizationList: tx.authorizationList,
      };
    default:
      throw new Error(`transaction ${tx.hash}: type ${String(tx.type)} carries no recoverable signature`);
  }
}

/** The hash an EOA signed to authorize `tx`: keccak256 of its unsigned serialization (per type). */
export function transactionSigningHash(tx: Transaction): Hash {
  return keccak256(serializeTransaction(unsignedTransaction(tx)));
}

/**
 * The uncompressed secp256k1 public key (`0x04 ‖ x ‖ y`) that signed `tx`, recovered from its
 * signature and checked against `tx.from`. Supports legacy (with and without EIP-155), EIP-2930,
 * EIP-1559 and EIP-7702 transactions.
 */
export async function recoverTransactionPublicKey(tx: Transaction): Promise<Hex> {
  const publicKey = await recoverPublicKey({
    hash: transactionSigningHash(tx),
    signature: { r: tx.r, s: tx.s, yParity: yParityOf(tx) },
  });
  if (!isAddressEqual(publicKeyToAddress(publicKey), tx.from)) {
    throw new Error(`transaction ${tx.hash}: recovered key does not match sender ${tx.from}`);
  }
  return publicKey;
}

/** The public key behind an EIP-7702 authorization and the authority (EOA) it belongs to. */
export async function recoverAuthorizationPublicKey(
  auth: SignedAuthorization,
): Promise<{ authority: Address; publicKey: Hex }> {
  const hash = hashAuthorization({ address: auth.address, chainId: auth.chainId, nonce: auth.nonce });
  const yParity = auth.yParity ?? (auth.v !== undefined ? Number(auth.v) - 27 : undefined);
  if (yParity === undefined) throw new Error('authorization without yParity');
  const publicKey = await recoverPublicKey({ hash, signature: { r: auth.r, s: auth.s, yParity } });
  return { authority: publicKeyToAddress(publicKey), publicKey };
}

/** A transaction exposing `address`'s public key: its hash and the recovered key, if any. */
export type ExposingTransaction = { hash: Hash; publicKey?: Hex };

/**
 * Extracts `address`'s public key from `tx`: from the signature if `address` sent it, or from an
 * EIP-7702 authorization `address` signed. Returns `undefined` if `tx` exposes nothing about it.
 */
export async function publicKeyFromTransaction(tx: Transaction, address: Address): Promise<Hex | undefined> {
  if (isAddressEqual(tx.from, address)) {
    // Arbitrum system / L1-to-L2 transaction types carry no L2 signature.
    if (!['legacy', 'eip2930', 'eip1559', 'eip7702'].includes(tx.type)) return undefined;
    return recoverTransactionPublicKey(tx);
  }
  if (tx.type === 'eip7702') {
    for (const auth of tx.authorizationList) {
      // An invalid authorization is skipped by the chain too; it exposes nobody.
      const recovered = await recoverAuthorizationPublicKey(auth).catch(() => undefined);
      if (recovered && isAddressEqual(recovered.authority, address)) return recovered.publicKey;
    }
  }
  return undefined;
}

/** Which nonce change `findExposingTransaction` locates without a hint. */
export type ExposureSearch = 'latest' | 'first';

export type FindExposingTransactionOptions = {
  /** A transaction sent by `address` (or carrying an EIP-7702 authorization it signed); skips the search. */
  hintTx?: Hash;
  /**
   * `'latest'` (default): the block of the address's most recent transaction (nonce N-1 → N);
   * `'first'`: the block where its nonce left 0. Any transaction it signed reveals the same key;
   * the latest one is usually recent enough for RPCs that keep only recent state.
   */
  search?: ExposureSearch;
  /** Lower bound of the search (default 0). */
  fromBlock?: bigint;
  /** Block the search starts from (default: latest). */
  atBlock?: bigint;
};

/** Errors meaning "this node has no state for that block" (pruned, non-archive), not a network failure. */
const STATE_UNAVAILABLE = /missing trie node|state .*not available|historical state|pruned/i;

/**
 * Finds a transaction that exposes `address`'s public key, without an indexer.
 *
 * With `hintTx`, only that transaction is fetched. Otherwise the block where the address's nonce
 * reached its target (see `search`) is located with `eth_getTransactionCount(address, block)`:
 * an exponential search back from `atBlock`, then a binary search, and that block's transactions
 * are scanned for one sent by `address` (or an EIP-7702 authorization it signed).
 *
 * Cost: about 2·log2(blocks back to the nonce change) nonce reads (≈40 for a change a few days ago
 * on Arbitrum One, ≈60 for one years ago) plus one full-block fetch. Blocks whose state the node
 * has pruned count as "before the change", so on a non-archive RPC the search succeeds when the
 * change is inside the node's state window and otherwise returns `undefined` (pass `hintTx`, or
 * use an archive RPC).
 */
export async function findExposingTransaction(
  client: Client,
  address: Address,
  opts: FindExposingTransactionOptions = {},
): Promise<ExposingTransaction | undefined> {
  if (opts.hintTx) {
    const tx = await getTransaction(client, { hash: opts.hintTx });
    const publicKey = await publicKeyFromTransaction(tx, address);
    if (!publicKey && !isAddressEqual(tx.from, address)) {
      throw new Error(`hint transaction ${opts.hintTx} was not signed by ${address}`);
    }
    return { hash: tx.hash, publicKey };
  }

  /** Nonce at `blockNumber`, or undefined when the node has no state for it. */
  const nonceAt = async (blockNumber: bigint): Promise<number | undefined> => {
    try {
      return await getTransactionCount(client, { address, blockNumber });
    } catch (e) {
      if (STATE_UNAVAILABLE.test(e instanceof Error ? e.message : String(e))) return undefined;
      throw e;
    }
  };
  const floor = opts.fromBlock ?? 0n;
  let hi = opts.atBlock ?? (await getBlockNumber(client));
  const current = await nonceAt(hi);
  if (current === undefined) throw new Error(`no state for block ${hi}`);
  if (current === 0) return undefined;
  const target = opts.search === 'first' ? 1 : current;
  const reached = (n: number | undefined) => n !== undefined && n >= target;

  // Exponential search back: find lo < hi with nonce(lo) < target (or no state) and nonce(hi) >= target.
  let lo: bigint;
  for (let step = 1n; ; step *= 2n) {
    const probe = hi - step > floor ? hi - step : floor;
    if (!reached(await nonceAt(probe))) {
      lo = probe;
      break;
    }
    hi = probe;
    if (probe === floor) return undefined; // the change happened at or before `floor`
  }
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (reached(await nonceAt(mid))) hi = mid;
    else lo = mid;
  }

  const block = await getBlock(client, { blockNumber: hi, includeTransactions: true });
  const sent = block.transactions
    .filter((tx) => isAddressEqual(tx.from, address))
    .sort((a, b) => b.nonce - a.nonce);
  for (const tx of sent) {
    const publicKey = await publicKeyFromTransaction(tx, address);
    if (publicKey) return { hash: tx.hash, publicKey };
  }
  for (const tx of block.transactions) {
    if (tx.type !== 'eip7702') continue;
    const publicKey = await publicKeyFromTransaction(tx, address);
    if (publicKey) return { hash: tx.hash, publicKey };
  }
  // The nonce moved without an L2 signature (e.g. an L1-to-L2 message from this address), or the
  // change lies before the node's state window.
  return sent[0] ? { hash: sent[0].hash } : undefined;
}

export type ExposureReport = {
  address: Address;
  /** True for contract code; false for EOAs, including EIP-7702 delegated EOAs. */
  isContract: boolean;
  /** Delegate of an EIP-7702 delegated EOA. */
  delegatedTo?: Address;
  nonce: number;
  /** An EOA with nonce > 0 has published its public key on-chain. */
  exposed: boolean;
  /** Uncompressed secp256k1 public key (`0x04 ‖ x ‖ y`) recovered from `exposingTx`. */
  publicKey?: Hex;
  exposingTx?: Hash;
  /** Symbol of the native currency (`APE` on ApeChain, `ETH` elsewhere). */
  nativeSymbol: string;
  /** Native currency (`token` = zero address) first, then each requested token. */
  balances: { token: Address; amount: bigint }[];
};

export type ScanExposureOptions = Omit<FindExposingTransactionOptions, 'atBlock'> & {
  /** ERC-20 tokens to read balances of; default `defaultExposureTokens(chainId)`. */
  tokens?: readonly Address[];
  /** Search for the exposing transaction and public key (default true). */
  findPublicKey?: boolean;
};

/**
 * Quantum exposure of `address`: an EOA that has sent a transaction has revealed its secp256k1
 * public key, which a quantum adversary can turn into its private key. Reports code/delegation,
 * nonce, the exposing transaction and recovered public key (see `findExposingTransaction` for the
 * cost of locating it without `hintTx`), and the value at stake (native and token balances).
 * All reads are pinned to the latest block at call time.
 */
export async function scanExposure(
  client: Client,
  address: Address,
  opts: ScanExposureOptions = {},
): Promise<ExposureReport> {
  const [chainId, blockNumber] = await Promise.all([
    client.chain ? Promise.resolve(client.chain.id) : getChainId(client),
    getBlockNumber(client),
  ]);
  const tokens = opts.tokens ?? defaultExposureTokens(chainId);
  const [code, nonce, eth, tokenBalances] = await Promise.all([
    getCode(client, { address, blockNumber }),
    getTransactionCount(client, { address, blockNumber }),
    getBalance(client, { address, blockNumber }),
    Promise.all(
      tokens.map((token) =>
        readContract(client, { address: token, abi: erc20Abi, functionName: 'balanceOf', args: [address], blockNumber }),
      ),
    ),
  ]);

  const delegatedTo = parseDelegation(code);
  const isContract = !!code && code !== '0x' && !delegatedTo;
  const exposed = !isContract && nonce > 0;
  const report: ExposureReport = {
    address,
    isContract,
    nonce,
    exposed,
    nativeSymbol: nativeSymbol(chainId),
    balances: [{ token: zeroAddress, amount: eth }, ...tokens.map((token, i) => ({ token, amount: tokenBalances[i]! }))],
  };
  if (delegatedTo) report.delegatedTo = delegatedTo;

  if (exposed && opts.findPublicKey !== false) {
    const found = await findExposingTransaction(client, address, {
      hintTx: opts.hintTx,
      search: opts.search,
      fromBlock: opts.fromBlock,
      atBlock: blockNumber,
    });
    if (found) {
      report.exposingTx = found.hash;
      if (found.publicKey) report.publicKey = found.publicKey;
    }
  }
  return report;
}
