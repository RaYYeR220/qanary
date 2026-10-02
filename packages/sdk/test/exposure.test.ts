import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createPublicClient,
  decodeFunctionData,
  encodeAbiParameters,
  erc20Abi,
  formatTransaction,
  getAddress,
  hexToBigInt,
  http,
  keccak256,
  parseTransaction,
  zeroAddress,
  type Address,
  type Chain,
  type Hex,
  type Transaction,
  type TransactionSerializable,
  type TransactionSerialized,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { apeChain, arbitrum, arbitrumSepolia, curtis } from 'viem/chains';
import {
  ARBITRUM_ONE_TOKENS,
  defaultExposureTokens,
  findExposingTransaction,
  parseDelegation,
  publicKeyFromTransaction,
  recoverAuthorizationPublicKey,
  recoverTransactionPublicKey,
  scanExposure,
  transactionSigningHash,
} from '../src/index.js';
import { mockTransport, type RpcHandler } from './rpc.js';

type RpcTx = Record<string, string>;
const pinned = JSON.parse(readFileSync(new URL('./fixtures/arb-one-txs.json', import.meta.url), 'utf8')) as {
  eip1559: RpcTx;
  legacyEip155: RpcTx;
};

/** An Arbitrum internal (ArbOS) transaction: type 0x6a, no signature. */
const ARBOS_TX: RpcTx = {
  blockHash: `0x${'bb'.repeat(32)}`,
  blockNumber: '0x0',
  from: '0x00000000000000000000000000000000000a4b05',
  gas: '0x0',
  gasPrice: '0x0',
  hash: '0xeb8200ca7728ceb2937edb4097083518025fb718d87a82cc27c122eff6ef8a05',
  input: '0x6bf6a42d',
  nonce: '0x0',
  to: '0x00000000000000000000000000000000000a4b05',
  transactionIndex: '0x0',
  value: '0x0',
  type: '0x6a',
  chainId: '0xa4b1',
  v: '0x0',
  r: '0x0',
  s: '0x0',
};

const asTx = (rpc: RpcTx) => formatTransaction(rpc as never) as Transaction;

// Hardhat/anvil account #0: a well-known test key.
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const local = privateKeyToAccount(KEY);
const sponsor = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

/** A signed transaction as an RPC node would return it (fields viem's formatter expects). */
async function minedLocal(tx: TransactionSerializable, signer = local): Promise<Transaction> {
  const raw = (await signer.signTransaction(tx)) as TransactionSerialized;
  const p = parseTransaction(raw);
  return {
    ...p,
    from: signer.address,
    hash: keccak256(raw),
    input: p.data ?? '0x',
    to: p.to ?? null,
    type: p.type,
    nonce: p.nonce ?? 0,
    value: p.value ?? 0n,
    gas: p.gas!,
    blockHash: null,
    blockNumber: null,
    transactionIndex: null,
  } as unknown as Transaction;
}

describe('parseDelegation (EIP-7702)', () => {
  const delegate = '0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B';
  it('reads the delegate from 0xef0100 ‖ address', () => {
    expect(parseDelegation(`0xef0100${delegate.slice(2).toLowerCase()}`)).toBe(delegate);
  });
  it.each([['0x'], [undefined], ['0x6080604052'], [`0xef0100${'11'.repeat(19)}`], [`0xef0101${'11'.repeat(20)}`]])(
    'is undefined for %s',
    (code) => {
      expect(parseDelegation(code as Hex | undefined)).toBeUndefined();
    },
  );
});

describe('public key recovery', () => {
  it.each([
    ['EIP-1559', pinned.eip1559],
    ['legacy EIP-155', pinned.legacyEip155],
  ])('recovers the sender key of a real Arbitrum One %s transaction', async (_name, rpc) => {
    const tx = asTx(rpc);
    const publicKey = await recoverTransactionPublicKey(tx);
    expect(publicKey).toMatch(/^0x04[0-9a-f]{128}$/);
    expect(await publicKeyFromTransaction(tx, getAddress(rpc.from!))).toBe(publicKey);
  });

  it('signing hash of the pinned legacy tx commits to chain id 42161 (EIP-155)', () => {
    const tx = asTx(pinned.legacyEip155);
    const tampered = { ...tx, v: 27n } as Transaction; // same tx, pre-EIP-155 signature encoding
    expect(transactionSigningHash(tx)).not.toBe(transactionSigningHash(tampered));
  });

  const base = { nonce: 3, gas: 21_000n, to: sponsor.address, value: 1n };
  it.each([
    ['legacy pre-EIP-155', { ...base, type: 'legacy', gasPrice: 10n }],
    ['legacy EIP-155', { ...base, type: 'legacy', gasPrice: 10n, chainId: 421614 }],
    ['EIP-2930', { ...base, type: 'eip2930', gasPrice: 10n, chainId: 42161, accessList: [{ address: sponsor.address, storageKeys: [`0x${'01'.repeat(32)}`] }] }],
    ['EIP-1559', { ...base, type: 'eip1559', maxFeePerGas: 10n, maxPriorityFeePerGas: 1n, chainId: 42161 }],
  ] as [string, TransactionSerializable][])('recovers %s', async (_name, tx) => {
    expect(await recoverTransactionPublicKey(await minedLocal(tx))).toBe(local.publicKey);
  });

  it('recovers both the EIP-7702 sender and the authority that signed an authorization', async () => {
    const auth = await local.signAuthorization({ address: '0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B', chainId: 42161, nonce: 0 });
    expect(await recoverAuthorizationPublicKey(auth)).toEqual({ authority: local.address, publicKey: local.publicKey });
    const tx = await minedLocal(
      { type: 'eip7702', chainId: 42161, nonce: 0, gas: 100_000n, to: local.address, maxFeePerGas: 10n, maxPriorityFeePerGas: 1n, authorizationList: [auth] },
      sponsor,
    );
    expect(await recoverTransactionPublicKey(tx)).toBe(sponsor.publicKey);
    expect(await publicKeyFromTransaction(tx, local.address)).toBe(local.publicKey);
    expect(await publicKeyFromTransaction(tx, '0x0000000000000000000000000000000000000001')).toBeUndefined();
  });

  it('skips an unrecoverable authorization instead of failing the scan', async () => {
    const good = await local.signAuthorization({ address: '0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B', chainId: 42161, nonce: 0 });
    const tx = await minedLocal(
      { type: 'eip7702', chainId: 42161, nonce: 0, gas: 100_000n, to: local.address, maxFeePerGas: 10n, maxPriorityFeePerGas: 1n, authorizationList: [good] },
      sponsor,
    );
    const broken = { ...good, r: '0x0' as Hex, s: '0x0' as Hex };
    const withBroken = { ...tx, authorizationList: [broken, good] } as Transaction;
    await expect(recoverAuthorizationPublicKey(broken)).rejects.toThrow();
    expect(await publicKeyFromTransaction(withBroken, local.address)).toBe(local.publicKey);
  });

  it('rejects a transaction whose signature does not match its sender', async () => {
    const tx = { ...(await minedLocal({ ...base, type: 'eip1559', maxFeePerGas: 10n, maxPriorityFeePerGas: 1n, chainId: 1 })), from: sponsor.address };
    await expect(recoverTransactionPublicKey(tx as Transaction)).rejects.toThrow(/does not match/);
  });

  it('Arbitrum system transactions expose nothing', async () => {
    expect(await publicKeyFromTransaction(asTx(ARBOS_TX), getAddress(ARBOS_TX.from!))).toBeUndefined();
  });
});

const hex = (n: bigint | number) => `0x${BigInt(n).toString(16)}`;
const word = (n: bigint) => encodeAbiParameters([{ type: 'uint256' }], [n]);

/**
 * A chain where `address`'s nonce changes at given blocks (block → nonce from then on). Blocks below
 * `prunedBelow` answer like a non-archive node.
 */
function chainState(opts: {
  chain?: Chain;
  address: Address;
  latest: bigint;
  nonceChanges: [bigint, number][];
  code?: Hex;
  blocks?: Record<string, RpcTx[]>;
  prunedBelow?: bigint;
  extra?: Record<string, RpcHandler>;
}) {
  const nonceAt = (b: bigint) => opts.nonceChanges.reduce((n, [at, v]) => (b >= at ? v : n), 0);
  const rpc = mockTransport({
    eth_chainId: () => hex((opts.chain ?? arbitrum).id),
    eth_blockNumber: () => hex(opts.latest),
    eth_getCode: () => opts.code ?? '0x',
    eth_getBalance: () => '0x2a',
    eth_getTransactionCount: (params) => {
      const block = hexToBigInt(params[1] as Hex);
      if (opts.prunedBelow !== undefined && block < opts.prunedBelow) {
        throw new Error('missing trie node 7972 (path ) state 0x7972 is not available, not found');
      }
      return hex(nonceAt(block));
    },
    eth_getBlockByNumber: (params) => {
      const n = params[0] as string;
      const txs = (opts.blocks?.[n] ?? []).map((t) => ({ ...t, blockNumber: n }));
      return {
        number: n,
        hash: `0x${'cc'.repeat(32)}`,
        parentHash: `0x${'00'.repeat(32)}`,
        timestamp: '0x1',
        baseFeePerGas: '0x1',
        gasLimit: '0x4000000000000',
        gasUsed: '0x0',
        transactions: txs,
      };
    },
    eth_call: (params) => {
      const { to, data } = params[0] as { to: Address; data: Hex };
      const { functionName } = decodeFunctionData({ abi: erc20Abi, data });
      if (functionName !== 'balanceOf') throw new Error('unexpected call');
      return word(BigInt(Number.parseInt(to.slice(-2), 16)));
    },
    ...opts.extra,
  });
  return {
    client: createPublicClient({ chain: opts.chain ?? arbitrum, transport: rpc.transport }),
    calls: rpc.calls,
    count: (m: string) => rpc.calls.filter((c) => c.method === m).length,
  };
}

describe('scanExposure', () => {
  const sender = getAddress(pinned.eip1559.from!);

  it('exposed EOA: finds the latest nonce change, recovers the key and reads balances', async () => {
    const s = chainState({
      address: sender,
      latest: 1_000_000n,
      nonceChanges: [
        [10n, 1],
        [998_765n, 7],
      ],
      blocks: { [hex(998_765n)]: [ARBOS_TX, pinned.eip1559] },
    });
    const report = await scanExposure(s.client, sender);
    expect(report).toMatchObject({ address: sender, isContract: false, nonce: 7, exposed: true });
    expect(report.exposingTx).toBe(pinned.eip1559.hash);
    expect(report.publicKey).toBe(await recoverTransactionPublicKey(asTx(pinned.eip1559)));
    expect(report.balances).toEqual([
      { token: zeroAddress, amount: 42n },
      ...Object.values(ARBITRUM_ONE_TOKENS).map((token) => ({ token, amount: BigInt(Number.parseInt(token.slice(-2), 16)) })),
    ]);
    // exponential search over 1235 blocks + binary search: ~2·log2(1235) reads, one block fetch
    expect(s.count('eth_getTransactionCount')).toBeLessThanOrEqual(2 + 2 * 11);
    expect(s.count('eth_getBlockByNumber')).toBe(1);
  });

  it("search: 'first' locates the block where the nonce left 0", async () => {
    const s = chainState({
      address: sender,
      latest: 1_000_000n,
      nonceChanges: [
        [4_242n, 1],
        [998_765n, 7],
      ],
      blocks: { [hex(4_242n)]: [pinned.eip1559] },
    });
    const found = await findExposingTransaction(s.client, sender, { search: 'first' });
    expect(found?.hash).toBe(pinned.eip1559.hash);
    expect(s.count('eth_getTransactionCount')).toBeLessThanOrEqual(2 + 2 * 20);
  });

  it('treats pruned state as "before the change" (non-archive RPC)', async () => {
    const s = chainState({
      address: sender,
      latest: 1_000_000n,
      prunedBelow: 900_000n,
      nonceChanges: [
        [10n, 1],
        [998_765n, 7],
      ],
      blocks: { [hex(998_765n)]: [pinned.eip1559] },
    });
    expect((await findExposingTransaction(s.client, sender))?.publicKey).toBeDefined();
    // the first transaction lies before the node's state window: nothing to find there
    expect(await findExposingTransaction(s.client, sender, { search: 'first' })).toBeUndefined();
  });

  it('uses hintTx instead of searching', async () => {
    const legacySender = getAddress(pinned.legacyEip155.from!);
    const s = chainState({
      address: legacySender,
      latest: 100n,
      nonceChanges: [[1n, 3]],
      extra: { eth_getTransactionByHash: () => pinned.legacyEip155 },
    });
    const report = await scanExposure(s.client, legacySender, { hintTx: pinned.legacyEip155.hash as Hex, tokens: [] });
    expect(report.exposingTx).toBe(pinned.legacyEip155.hash);
    expect(report.publicKey).toBe(await recoverTransactionPublicKey(asTx(pinned.legacyEip155)));
    expect(s.count('eth_getBlockByNumber')).toBe(0);
    await expect(scanExposure(s.client, sender, { hintTx: pinned.legacyEip155.hash as Hex, tokens: [] })).rejects.toThrow(
      /not signed by/,
    );
  });

  it('fresh EOA: not exposed, no search', async () => {
    const s = chainState({ chain: arbitrumSepolia, address: sender, latest: 50n, nonceChanges: [] });
    const report = await scanExposure(s.client, sender);
    expect(report).toEqual({
      address: sender,
      isContract: false,
      nonce: 0,
      exposed: false,
      nativeSymbol: 'ETH',
      balances: [{ token: zeroAddress, amount: 42n }],
    });
    expect(s.count('eth_getTransactionCount')).toBe(1);
  });

  it('contract: not exposed, no search', async () => {
    const s = chainState({ address: sender, latest: 50n, nonceChanges: [[1n, 1]], code: '0x6080604052' });
    const report = await scanExposure(s.client, sender, { tokens: [] });
    expect(report).toMatchObject({ isContract: true, exposed: false, nonce: 1 });
    expect(report.publicKey).toBeUndefined();
    expect(s.count('eth_getBlockByNumber')).toBe(0);
  });

  it('EIP-7702 delegated EOA: reported as an exposed EOA with its delegate', async () => {
    const delegate = '0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B';
    const s = chainState({ address: sender, latest: 50n, nonceChanges: [[1n, 1]], code: `0xef0100${delegate.slice(2)}` });
    const report = await scanExposure(s.client, sender, { tokens: [], findPublicKey: false });
    expect(report).toMatchObject({ isContract: false, exposed: true, delegatedTo: delegate });
  });

  it('ApeChain: APE as the native currency, no default tokens', async () => {
    const s = chainState({ chain: curtis, address: sender, latest: 50n, nonceChanges: [] });
    const report = await scanExposure(s.client, sender);
    expect(report.nativeSymbol).toBe('APE');
    expect(report.balances).toEqual([{ token: zeroAddress, amount: 42n }]);
    expect(s.count('eth_call')).toBe(0);
  });

  it('default token list per network (empty where unknown)', () => {
    expect(defaultExposureTokens(arbitrum.id)).toEqual(Object.values(ARBITRUM_ONE_TOKENS));
    expect(defaultExposureTokens(apeChain.id)).toEqual([]);
    expect(defaultExposureTokens(curtis.id)).toEqual([]);
    expect(defaultExposureTokens(arbitrumSepolia.id)).toEqual([]);
    expect(defaultExposureTokens(1)).toEqual([]);
  });
});

describe.runIf(process.env.QANARY_LIVE === '1')('scanExposure on Arbitrum One (live)', () => {
  const client = createPublicClient({ chain: arbitrum, transport: http(process.env.ARB_ONE_RPC ?? 'https://arb1.arbitrum.io/rpc') });

  it('recovers the key of a pinned transaction sender via hintTx', async () => {
    const sender = getAddress(pinned.eip1559.from!);
    const report = await scanExposure(client, sender, { hintTx: pinned.eip1559.hash as Hex });
    expect(report.exposed).toBe(true);
    expect(report.publicKey).toBe(await recoverTransactionPublicKey(asTx(pinned.eip1559)));
    expect(report.balances).toHaveLength(5);
  });

  it('finds an exposing transaction of an active address without a hint', async () => {
    // the most active sender of the pinned block: its latest transaction is always recent
    const sender = getAddress(pinned.eip1559.from!);
    const found = await findExposingTransaction(client, sender);
    expect(found?.publicKey).toBe(await recoverTransactionPublicKey(asTx(pinned.eip1559)));
  }, 120_000);
});
