import { describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionResult,
  parseSignature,
  parseTransaction,
  recoverAddress,
  type Address,
  type Hex,
  type TransactionSerialized,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';
import { CANARY_TARGET, canary, canaryRegistryAbi, drillK1PrivateKey, encodeClaimProof } from '../src/index.js';
import { mockTransport, type RpcHandler } from './rpc.js';

const REGISTRY: Address = '0x9999999999999999999999999999999999999999';
const R = `0x${'11'.repeat(32)}` as Hex;
const S = `0x${'22'.repeat(32)}` as Hex;

// Published drill key for secp256k1 (deployments/canary-targets.json, "drill.secp256k1").
const DRILL_K1 = {
  privateKey: '0x14558aab84810af4717cd449817d3687d5ce9cec641599b5dd77f8862102baeb' as Hex,
  address: '0xD56fbAE6f6e1a0f7790d279CE86fC9638EE02184' as Address,
};

describe('encodeClaimProof', () => {
  it('K1: abi.encode(uint8 v, bytes32 r, bytes32 s) with v in {27, 28}', () => {
    const expected = encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes32' }, { type: 'bytes32' }], [28, R, S]);
    expect(encodeClaimProof(CANARY_TARGET.K1, { r: R, s: S, v: 28 })).toBe(expected);
    expect(encodeClaimProof(CANARY_TARGET.K1, { r: R, s: S, v: 1n })).toBe(expected);
    expect(encodeClaimProof(CANARY_TARGET.K1, { r: R, s: S, yParity: 1 })).toBe(expected);
    expect(expected.length).toBe(2 + 3 * 64);
  });

  it.each([CANARY_TARGET.L1, CANARY_TARGET.L2, CANARY_TARGET.L3, CANARY_TARGET.R1])(
    'target %i: abi.encode(bytes32 r, bytes32 s), short scalars left-padded',
    (target) => {
      const proof = encodeClaimProof(target, { r: 5n, s: '0x0a0b' });
      expect(proof).toBe(`0x${'0'.repeat(63)}5${'0'.repeat(60)}0a0b`);
      expect(decodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], proof)[1]).toBe(`0x${'0'.repeat(60)}0a0b`);
    },
  );

  it('rejects bad inputs', () => {
    expect(() => encodeClaimProof(CANARY_TARGET.K1, { r: R, s: S })).toThrow(/v or yParity/);
    expect(() => encodeClaimProof(CANARY_TARGET.K1, { r: R, s: S, v: 29 })).toThrow(/invalid v/);
    expect(() => encodeClaimProof(5, { r: R, s: S })).toThrow(/invalid canary target 5/);
    expect(() => encodeClaimProof(CANARY_TARGET.R1, { r: `0x${'11'.repeat(33)}`, s: S })).toThrow(/32 bytes/);
  });

  it('a drill K1 signature over a claim message recovers to the drill target address', async () => {
    const drill = privateKeyToAccount(drillK1PrivateKey());
    expect(drillK1PrivateKey()).toBe(DRILL_K1.privateKey);
    expect(drill.address).toBe(DRILL_K1.address);
    const message = `0x${'5a'.repeat(32)}` as Hex;
    const sig = parseSignature(await drill.sign({ hash: message }));
    const proof = encodeClaimProof(CANARY_TARGET.K1, sig);
    const [v, r, s] = decodeAbiParameters([{ type: 'uint8' }, { type: 'bytes32' }, { type: 'bytes32' }], proof);
    expect([27, 28]).toContain(v);
    expect(await recoverAddress({ hash: message, signature: { r, s, v: BigInt(v) } })).toBe(DRILL_K1.address);
  });
});

function word(n: bigint | number | boolean): Hex {
  return encodeAbiParameters([{ type: 'uint256' }], [BigInt(n)]);
}

function registryViews(answers: Record<string, (args: readonly unknown[]) => Hex>): RpcHandler {
  return (params) => {
    const { data } = params[0] as { data: Hex };
    const { functionName, args } = decodeFunctionData({ abi: canaryRegistryAbi, data });
    const answer = answers[functionName];
    if (!answer) throw new Error(`unexpected view ${functionName}`);
    return answer(args ?? []);
  };
}

describe('canary client', () => {
  const targets = {
    l1x: `0x${'01'.repeat(32)}`,
    l1y: `0x${'02'.repeat(32)}`,
    l2x: `0x${'03'.repeat(32)}`,
    l2y: `0x${'04'.repeat(32)}`,
    l3x: `0x${'05'.repeat(32)}`,
    l3y: `0x${'06'.repeat(32)}`,
    k1: DRILL_K1.address,
    r1x: `0x${'07'.repeat(32)}`,
    r1y: `0x${'08'.repeat(32)}`,
  } as const;

  function reader() {
    const rpc = mockTransport({
      eth_chainId: () => '0x66eee',
      eth_call: registryViews({
        ladderLevel: () => word(2),
        familyBroken: (args) => word(args[0] === 0),
        claimed: (args) => word(args[0] === 1),
        claimMessage: () => `0x${'5a'.repeat(32)}`,
        bounty: () => encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [7n, 9n]),
        isDrill: () => word(1),
        owedToken: () => word(11n),
        owedEth: () => word(12n),
        targets: () => encodeFunctionResult({ abi: canaryRegistryAbi, functionName: 'targets', result: targets }),
      }),
    });
    return canary(createPublicClient({ chain: arbitrumSepolia, transport: rpc.transport }), REGISTRY);
  }

  it('reads level, family flags, claims, targets and bounties', async () => {
    const c = reader();
    expect(await c.level()).toBe(2);
    expect(await c.familyBroken(0)).toBe(true);
    expect(await c.familyBroken(1)).toBe(false);
    expect(await c.claimed(CANARY_TARGET.L2)).toBe(true);
    expect(await c.claimMessage(CANARY_TARGET.K1, DRILL_K1.address)).toBe(`0x${'5a'.repeat(32)}`);
    expect(await c.targets()).toEqual(targets);
    expect(await c.bounty(CANARY_TARGET.R1)).toEqual({ tokenAmount: 7n, ethAmount: 9n });
    expect(await c.isDrill()).toBe(true);
    expect(await c.owed(DRILL_K1.address)).toEqual({ tokenAmount: 11n, ethAmount: 12n });
  });

  it('claim() encodes a signature proof and fundETH() sends value', async () => {
    const TX = `0x${'ab'.repeat(32)}` as Hex;
    const rpc = mockTransport({
      eth_chainId: () => '0x66eee',
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
      eth_sendRawTransaction: () => TX,
    });
    const wallet = createWalletClient({
      account: privateKeyToAccount(generatePrivateKey()),
      chain: arbitrumSepolia,
      transport: rpc.transport,
    });
    const c = canary(wallet, REGISTRY);
    await expect(c.claim(CANARY_TARGET.K1, { r: R, s: S, yParity: 0 })).resolves.toBe(TX);
    await expect(c.fundETH(CANARY_TARGET.L1, 123n)).resolves.toBe(TX);
    await expect(c.withdrawOwed()).resolves.toBe(TX);

    const sent = rpc.calls
      .filter((x) => x.method === 'eth_sendRawTransaction')
      .map((x) => parseTransaction(x.params[0] as TransactionSerialized));
    const claim = decodeFunctionData({ abi: canaryRegistryAbi, data: sent[0]!.data! });
    expect(claim.functionName).toBe('claim');
    expect(claim.args).toEqual([3, encodeClaimProof(3, { r: R, s: S, v: 27 })]);
    const fund = decodeFunctionData({ abi: canaryRegistryAbi, data: sent[1]!.data! });
    expect(fund.args).toEqual([0]);
    expect(sent[1]!.value).toBe(123n);
    expect(decodeFunctionData({ abi: canaryRegistryAbi, data: sent[2]!.data! }).functionName).toBe('withdrawOwed');
  });

  it('validates targets before reading', async () => {
    // @ts-expect-error out-of-range target
    await expect(reader().claimMessage(7, DRILL_K1.address)).rejects.toThrow(/invalid canary target 7/);
  });
});
