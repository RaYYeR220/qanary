import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionResult,
  parseTransaction,
  sliceHex,
  zeroAddress,
  type Address,
  type Hex,
  type TransactionSerialized,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';
import {
  NATIVE_ASSET,
  encodeHotTierSetup,
  hotTier,
  hotTierExecutorAbi,
  hotTierInitData,
  installHotTierCall,
  kernelModuleAbi,
  type HotTierConfig,
} from '../src/index.js';
import { mockTransport, type RpcHandler } from './rpc.js';

const vector = JSON.parse(readFileSync(new URL('./fixtures/hot-tier-vector.json', import.meta.url), 'utf8')) as {
  executorInitData: Hex;
};

const USDC: Address = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const EXECUTOR: Address = '0x8888888888888888888888888888888888888888';
const ACCOUNT: Address = '0x2222222222222222222222222222222222222222';

/** Same configuration as the forge vector. */
const CONFIG: HotTierConfig = {
  registry: '0x6666666666666666666666666666666666666666',
  window: 86_400,
  levelBps: [10_000, 5_000, 2_500, 0],
  signer: { family: 'secp256k1', eoa: '0x7777777777777777777777777777777777777777' },
  assets: [
    { asset: NATIVE_ASSET, cap: 10n ** 15n },
    { asset: USDC, cap: 100_000_000n },
  ],
  allow: [{ target: '0x5555555555555555555555555555555555555555', selector: '0xa9059cbb' }],
};

describe('hot tier encodings', () => {
  it('Kernel executor initData matches forge: hook(0) ‖ abi.encode(abi.encode(Setup), "")', () => {
    expect(hotTierInitData(CONFIG)).toBe(vector.executorInitData);
    expect(sliceHex(vector.executorInitData, 0, 20)).toBe(zeroAddress);
    const [executorData, hookData] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes' }],
      sliceHex(vector.executorInitData, 20),
    );
    expect(executorData).toBe(encodeHotTierSetup(CONFIG));
    expect(hookData).toBe('0x');
  });

  it('install call is account.installModule(2, executor, initData)', () => {
    const call = installHotTierCall(ACCOUNT, EXECUTOR, CONFIG);
    expect(call.to).toBe(ACCOUNT);
    expect(call.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: kernelModuleAbi, data: call.data });
    expect(decoded.functionName).toBe('installModule');
    expect(decoded.args).toEqual([2n, EXECUTOR, vector.executorInitData]);
  });

  it('encodes a P-256 hot signer with pubX/pubY and no EOA', () => {
    const p256: HotTierConfig = { ...CONFIG, signer: { family: 'p256', pubX: `0x${'aa'.repeat(32)}`, pubY: `0x${'bb'.repeat(32)}` } };
    const data = hot().configure(p256).data;
    const { args } = decodeFunctionData({ abi: hotTierExecutorAbi, data });
    const setup = (args as unknown as [{ signer: { family: number; eoa: Address; pubX: Hex; pubY: Hex } }])[0];
    expect(setup.signer).toEqual({ family: 1, eoa: zeroAddress, pubX: `0x${'aa'.repeat(32)}`, pubY: `0x${'bb'.repeat(32)}` });
  });

  it.each([
    ['window 0', { window: 0 }, /window/],
    ['increasing levelBps', { levelBps: [5_000, 10_000, 0, 0] as const }, /non-increasing/],
    ['bps above 10000', { levelBps: [10_001, 0, 0, 0] as const }, /0\.\.10000/],
    ['duplicate asset', { assets: [{ asset: USDC, cap: 1n }, { asset: USDC, cap: 2n }] }, /duplicate/],
    ['nine assets', { assets: Array.from({ length: 9 }, (_, i) => ({ asset: `0x${(i + 1).toString(16).padStart(40, '0')}` as Address, cap: 1n })) }, /at most 8/],
    ['cap over uint128', { assets: [{ asset: USDC, cap: 2n ** 128n }] }, /uint128/],
    ['zero registry', { registry: zeroAddress }, /registry/],
    ['zero hot EOA', { signer: { family: 'secp256k1' as const, eoa: zeroAddress } }, /hot signer/],
    ['3-byte selector', { allow: [{ target: USDC, selector: '0xa9059c' as Hex }] }, /4 bytes/],
  ])('rejects %s', (_name, patch, error) => {
    expect(() => hotTierInitData({ ...CONFIG, ...patch } as HotTierConfig)).toThrow(error);
  });
});

function word(n: bigint | number): Hex {
  return encodeAbiParameters([{ type: 'uint256' }], [BigInt(n)]);
}

/** eth_call handler answering HotTierExecutor views by function name. */
function executorViews(answers: Partial<Record<string, (args: readonly unknown[]) => Hex>>): RpcHandler {
  return (params) => {
    const { data } = params[0] as { data: Hex };
    const { functionName, args } = decodeFunctionData({ abi: hotTierExecutorAbi, data });
    const answer = answers[functionName];
    if (!answer) throw new Error(`unexpected view ${functionName}`);
    return answer(args ?? []);
  };
}

function hot(handlers: Record<string, RpcHandler> = {}, withAccount = false) {
  const rpc = mockTransport({ eth_chainId: () => '0x66eee', ...handlers });
  const account = privateKeyToAccount(generatePrivateKey());
  const client = withAccount
    ? createWalletClient({ account, chain: arbitrumSepolia, transport: rpc.transport })
    : createPublicClient({ chain: arbitrumSepolia, transport: rpc.transport });
  return Object.assign(hotTier(client, EXECUTOR), { calls: rpc.calls, signer: account });
}

const sendHandlers = (txHash: Hex): Record<string, RpcHandler> => ({
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
  eth_sendRawTransaction: () => txHash,
});

describe('hotTier client', () => {
  it('reads availability, effective scale and full status', async () => {
    const h = hot({
      eth_call: executorViews({
        isInitialized: () => word(1),
        effectiveBps: () => word(5_000),
        nonceOf: () => word(3),
        trackedAssets: () =>
          encodeFunctionResult({ abi: hotTierExecutorAbi, functionName: 'trackedAssets', result: [NATIVE_ASSET, USDC] }),
        available: (args) => word(args[1] === NATIVE_ASSET ? 7n : 42n),
      }),
    });
    expect(await h.available(ACCOUNT, USDC)).toBe(42n);
    expect(await h.effectiveBps(ACCOUNT)).toBe(5_000);
    expect(await h.status(ACCOUNT)).toEqual({
      configured: true,
      effectiveBps: 5_000,
      frozen: false,
      nonce: 3n,
      assets: [
        { asset: NATIVE_ASSET, available: 7n },
        { asset: USDC, available: 42n },
      ],
    });
  });

  it('reports an unconfigured account and a frozen one', async () => {
    expect(await hot({ eth_call: executorViews({ isInitialized: () => word(0) }) }).status(ACCOUNT)).toEqual({
      configured: false,
    });
    const frozen = await hot({
      eth_call: executorViews({
        isInitialized: () => word(1),
        effectiveBps: () => word(0),
        nonceOf: () => word(0),
        trackedAssets: () => encodeFunctionResult({ abi: hotTierExecutorAbi, functionName: 'trackedAssets', result: [] }),
      }),
    }).status(ACCOUNT);
    expect(frozen).toMatchObject({ configured: true, frozen: true, effectiveBps: 0 });
  });

  it('configure() is a call for the account itself', () => {
    const call = hot().configure(CONFIG);
    expect(call.to).toBe(EXECUTOR);
    const decoded = decodeFunctionData({ abi: hotTierExecutorAbi, data: call.data });
    expect(decoded.functionName).toBe('configure');
  });

  it('execute() sends execute(account, calls) from the hot EOA', async () => {
    const TX = `0x${'ab'.repeat(32)}` as Hex;
    const h = hot(sendHandlers(TX), true);
    await expect(h.execute(ACCOUNT, [{ target: USDC, data: '0xa9059cbb' }, { target: h.signer.address, value: 5n }])).resolves.toBe(TX);
    const raw = h.calls.find((c) => c.method === 'eth_sendRawTransaction')!.params[0] as TransactionSerialized;
    const tx = parseTransaction(raw);
    expect(tx.to?.toLowerCase()).toBe(EXECUTOR);
    const decoded = decodeFunctionData({ abi: hotTierExecutorAbi, data: tx.data! });
    expect(decoded.functionName).toBe('execute');
    expect(decoded.args).toEqual([
      ACCOUNT,
      [
        { target: USDC, value: 0n, data: '0xa9059cbb' },
        { target: h.signer.address, value: 5n, data: '0x' },
      ],
    ]);
  });

  it('execute() with an explicit gas limit skips estimation (lands even if it reverts)', async () => {
    const TX = `0x${'cd'.repeat(32)}` as Hex;
    const h = hot(sendHandlers(TX), true);
    await h.execute(ACCOUNT, [{ target: USDC, data: '0xa9059cbb' }], { gas: 300_000n });
    expect(h.calls.some((c) => c.method === 'eth_estimateGas')).toBe(false);
    const raw = h.calls.find((c) => c.method === 'eth_sendRawTransaction')!.params[0] as TransactionSerialized;
    expect(parseTransaction(raw).gas).toBe(300_000n);
  });

  it('executeWithSig() signs hotOpDigest at the current nonce and relays it', async () => {
    const TX = `0x${'ef'.repeat(32)}` as Hex;
    const DIGEST = `0x${'99'.repeat(32)}` as Hex;
    let digestArgs: readonly unknown[] = [];
    const h = hot(
      {
        ...sendHandlers(TX),
        eth_call: executorViews({
          nonceOf: () => word(4),
          hotOpDigest: (args) => {
            digestArgs = args;
            return DIGEST;
          },
        }),
      },
      true,
    );
    const hotKey = privateKeyToAccount(generatePrivateKey());
    let signed: Hex | undefined;
    await h.executeWithSig(ACCOUNT, [{ target: USDC, data: '0xa9059cbb' }], {
      deadline: 1_000n,
      sign: async (d) => {
        signed = d;
        return hotKey.sign({ hash: d });
      },
    });
    expect(signed).toBe(DIGEST);
    expect(digestArgs[2]).toBe(4n);
    expect(digestArgs[3]).toBe(1_000n);
    const raw = h.calls.find((c) => c.method === 'eth_sendRawTransaction')!.params[0] as TransactionSerialized;
    const decoded = decodeFunctionData({ abi: hotTierExecutorAbi, data: parseTransaction(raw).data! });
    expect(decoded.functionName).toBe('executeWithSig');
    expect(decoded.args?.[2]).toBe(1_000n);
    expect(decoded.args?.[3]).toBe(await hotKey.sign({ hash: DIGEST }));
  });

  it('writes need a client account', async () => {
    await expect(hot().execute(ACCOUNT, [])).rejects.toThrow(/no account/);
  });
});
