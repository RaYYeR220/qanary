import { describe, expect, it } from 'vitest';
import {
  createWalletClient,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseTransaction,
  type Address,
  type Hex,
  type TransactionSerialized,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';
import {
  PUBLIC_KEY_BYTES,
  SCHEMES,
  SCHEME_ID,
  keyBlob,
  keyStoreAbi,
  pqSignerFromSeed,
  predictKeyPointer,
  storeKey,
} from '../src/index.js';
import { mockTransport } from './rpc.js';

// Vectors from the Solidity KeyStore (forge): KeyStore runtime code etched at KEY_STORE,
// `pointerOf(blob)` == the address `store(blob)` actually deployed to.
const KEY_STORE: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const SMALL_BLOB: Hex = '0x04deadbeef';
const SMALL_POINTER: Address = '0xDdC814a1AC7bcDf69ff3dC6463738E9f9D0E6f05';
// blob = 0x02 ‖ ML-DSA-44 public key for seed 0x0101…01.
const MLDSA44_BLOB_HASH: Hex = '0xdd627e7a60799febeba043850e6359bb7bb11317601db7bbf406f8083791b3bf';
const MLDSA44_POINTER: Address = '0xEc5F869a05ec32B812eFEda2D72b85Dbc913084E';

const SEED = new Uint8Array(32).fill(1);

describe('keyBlob', () => {
  it.each(SCHEMES)('%s: scheme byte ‖ raw public key', (scheme) => {
    const signer = pqSignerFromSeed(scheme, SEED);
    const blob = keyBlob(signer);
    expect((blob.length - 2) / 2).toBe(1 + PUBLIC_KEY_BYTES[scheme]);
    expect(Number.parseInt(blob.slice(2, 4), 16)).toBe(SCHEME_ID[scheme]);
    expect(blob.slice(4)).toBe(Buffer.from(signer.publicKey).toString('hex'));
  });

  it('rejects a public key of the wrong length for its scheme', () => {
    const signer = pqSignerFromSeed('mldsa44', SEED);
    expect(() => keyBlob({ ...signer, scheme: 'mldsa65' })).toThrow(/1952/);
  });
});

describe('predictKeyPointer', () => {
  it('matches KeyStore.pointerOf for a short blob', () => {
    expect(predictKeyPointer(KEY_STORE, SMALL_BLOB)).toBe(SMALL_POINTER);
  });

  it('matches KeyStore.pointerOf for an ML-DSA-44 key blob', () => {
    const blob = keyBlob(pqSignerFromSeed('mldsa44', SEED));
    expect(keccak256(blob)).toBe(MLDSA44_BLOB_HASH);
    expect(predictKeyPointer(KEY_STORE, blob)).toBe(MLDSA44_POINTER);
  });

  it('accepts a lowercase key store address and returns a checksummed pointer', () => {
    expect(predictKeyPointer(KEY_STORE.toLowerCase() as Address, SMALL_BLOB)).toBe(SMALL_POINTER);
    expect(getAddress(SMALL_POINTER)).toBe(SMALL_POINTER);
  });

  it('rejects an empty blob', () => {
    expect(() => predictKeyPointer(KEY_STORE, '0x')).toThrow(/empty/);
  });
});

describe('storeKey', () => {
  const blob = SMALL_BLOB;
  const TX_HASH = `0x${'ab'.repeat(32)}` as Hex;

  function setup(opts: { code: Hex; status?: '0x1' | '0x0' }) {
    const account = privateKeyToAccount(generatePrivateKey());
    const rpc = mockTransport({
      eth_chainId: () => '0x66eee',
      eth_getCode: () => opts.code,
      eth_getTransactionCount: () => '0x0',
      eth_estimateGas: () => '0x30d40',
      eth_maxPriorityFeePerGas: () => '0x0',
      eth_gasPrice: () => '0x989680',
      eth_getBlockByNumber: () => ({
        number: '0x1',
        hash: `0x${'11'.repeat(32)}`,
        parentHash: `0x${'00'.repeat(32)}`,
        timestamp: '0x1',
        baseFeePerGas: '0x989680',
        gasLimit: '0x4000000000000',
        gasUsed: '0x0',
        transactions: [],
      }),
      eth_sendRawTransaction: () => TX_HASH,
      eth_blockNumber: () => '0x2',
      eth_getTransactionReceipt: () => ({
        transactionHash: TX_HASH,
        transactionIndex: '0x0',
        blockHash: `0x${'22'.repeat(32)}`,
        blockNumber: '0x2',
        from: account.address.toLowerCase(),
        to: KEY_STORE.toLowerCase(),
        cumulativeGasUsed: '0x30d40',
        gasUsed: '0x30d40',
        effectiveGasPrice: '0x989680',
        contractAddress: null,
        logs: [],
        logsBloom: `0x${'00'.repeat(256)}`,
        status: opts.status ?? '0x1',
        type: '0x2',
      }),
    });
    const wallet = createWalletClient({ account, chain: arbitrumSepolia, transport: rpc.transport, pollingInterval: 10 });
    return { wallet, calls: rpc.calls };
  }

  it('deploys the blob through KeyStore.store and returns the predicted pointer', async () => {
    const { wallet, calls } = setup({ code: '0x' });
    await expect(storeKey(wallet, KEY_STORE, blob)).resolves.toBe(SMALL_POINTER);

    const sent = calls.filter((c) => c.method === 'eth_sendRawTransaction');
    expect(sent).toHaveLength(1);
    const tx = parseTransaction(sent[0]?.params[0] as TransactionSerialized);
    expect(tx.to?.toLowerCase()).toBe(KEY_STORE.toLowerCase());
    expect(tx.chainId).toBe(arbitrumSepolia.id);
    expect(tx.data).toBe(encodeFunctionData({ abi: keyStoreAbi, functionName: 'store', args: [blob] }));
    expect(calls.some((c) => c.method === 'eth_getTransactionReceipt')).toBe(true);
  });

  it('skips the transaction when the pointer already holds the key', async () => {
    const { wallet, calls } = setup({ code: '0x0004deadbeef' });
    await expect(storeKey(wallet, KEY_STORE, blob)).resolves.toBe(SMALL_POINTER);
    expect(calls.some((c) => c.method === 'eth_sendRawTransaction')).toBe(false);
  });

  it('throws when the store transaction reverts', async () => {
    const { wallet } = setup({ code: '0x', status: '0x0' });
    await expect(storeKey(wallet, KEY_STORE, blob)).rejects.toThrow(/reverted/);
  });

  it('requires a wallet client with an account', async () => {
    const { transport } = mockTransport({});
    const wallet = createWalletClient({ chain: arbitrumSepolia, transport });
    await expect(storeKey(wallet, KEY_STORE, blob)).rejects.toThrow(/account/);
  });
});
