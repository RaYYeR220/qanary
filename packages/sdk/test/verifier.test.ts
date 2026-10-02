import { describe, expect, it } from 'vitest';
import {
  createPublicClient,
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  numberToHex,
  type Address,
  type Hex,
} from 'viem';
import { arbitrumSepolia, foundry } from 'viem/chains';
import { ERC7913_MAGIC, pqVerifierAbi, verifyOnChain } from '../src/index.js';
import { mockTransport, type RpcHandler } from './rpc.js';

const VERIFIER: Address = '0x00000000000000000000000000000000000ab1e5';
const NODE_INTERFACE = '0x00000000000000000000000000000000000000c8';
const KEY: Hex = '0xEc5F869a05ec32B812eFEda2D72b85Dbc913084E';
const HASH: Hex = `0x${'42'.repeat(32)}`;
const SIG: Hex = `0x${'aa'.repeat(2420)}`;

const word4 = (sel: Hex): Hex => encodeAbiParameters([{ type: 'bytes4' }], [sel]);

type CallArgs = { to?: string; data?: Hex };

function client(chain: typeof foundry | typeof arbitrumSepolia, handlers: Record<string, RpcHandler>) {
  const rpc = mockTransport({ eth_chainId: () => numberToHex(chain.id), ...handlers });
  return { client: createPublicClient({ chain, transport: rpc.transport }), calls: rpc.calls };
}

describe('verifyOnChain', () => {
  it('reports valid for the ERC-7913 magic value and returns eth_estimateGas off Arbitrum', async () => {
    const { client: c, calls } = client(foundry, {
      eth_call: ([tx]) => {
        const { to, data } = tx as CallArgs;
        if (to?.toLowerCase() === NODE_INTERFACE) return '0x';
        expect(to?.toLowerCase()).toBe(VERIFIER.toLowerCase());
        const decoded = decodeFunctionData({ abi: pqVerifierAbi, data: data as Hex });
        expect(decoded.functionName).toBe('verify');
        expect(decoded.args).toEqual([KEY.toLowerCase(), HASH, SIG]);
        return word4(ERC7913_MAGIC);
      },
      eth_estimateGas: () => numberToHex(1_234_567),
    });
    await expect(verifyOnChain(c, VERIFIER, KEY, HASH, SIG)).resolves.toEqual({ valid: true, gas: 1_234_567n });
    expect(calls.filter((x) => x.method === 'eth_estimateGas')).toHaveLength(1);
  });

  it('reports invalid for the 0xffffffff failure value', async () => {
    const { client: c } = client(foundry, {
      eth_call: ([tx]) => ((tx as CallArgs).to?.toLowerCase() === NODE_INTERFACE ? '0x' : word4('0xffffffff')),
      eth_estimateGas: () => numberToHex(900_000),
    });
    await expect(verifyOnChain(c, VERIFIER, KEY, HASH, SIG)).resolves.toEqual({ valid: false, gas: 900_000n });
  });

  it('on Arbitrum, reports L2 execution gas (NodeInterface estimate minus the L1 data component)', async () => {
    const { client: c, calls } = client(arbitrumSepolia, {
      eth_call: ([tx]) => {
        const { to } = tx as CallArgs;
        if (to?.toLowerCase() === NODE_INTERFACE) {
          return encodeAbiParameters(
            [{ type: 'uint64' }, { type: 'uint64' }, { type: 'uint256' }, { type: 'uint256' }],
            [1_500_000n, 400_000n, 10_000_000n, 30_000_000n],
          );
        }
        return word4(ERC7913_MAGIC);
      },
    });
    await expect(verifyOnChain(c, VERIFIER, KEY, HASH, SIG)).resolves.toEqual({ valid: true, gas: 1_100_000n });
    expect(calls.some((x) => x.method === 'eth_estimateGas')).toBe(false);
  });

  it('surfaces verifier reverts (malformed key or signature) as errors naming the custom error', async () => {
    const revertData = encodeErrorResult({ abi: pqVerifierAbi, errorName: 'InvalidKey' });
    const { client: c } = client(foundry, {
      eth_call: () => {
        throw Object.assign(new Error('execution reverted'), { code: 3, data: revertData });
      },
      eth_estimateGas: () => numberToHex(1),
    });
    await expect(verifyOnChain(c, VERIFIER, KEY, HASH, SIG)).rejects.toThrow(/InvalidKey/);
  });
});
