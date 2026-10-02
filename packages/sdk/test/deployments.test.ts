import { describe, expect, it } from 'vitest';
import {
  ARBITRUM_ONE_TOKENS,
  ENTRY_POINT_V07,
  KERNEL_V3_3_ADDRESSES,
  deployments,
  getDeployment,
  parseDeployment,
  requireContract,
  requireVerifier,
} from '../src/index.js';
import { getAddress } from 'viem';

const A = (n: number) => `0x${n.toString(16).padStart(2, '0').repeat(20)}`;

/** The layout written by the deployment scripts (`deployments/<network>.json`). */
const SEPOLIA_JSON = {
  chainId: 421614,
  stylus: {
    mldsa44Verifier: { address: A(1), deployTx: `0x${'aa'.repeat(32)}`, cached: true },
    mldsa65Verifier: { address: A(2) },
    falcon512Verifier: { address: A(3) },
    ladderVerifier: { address: A(4) },
  },
  evm: {
    keyStore: A(5),
    quantumValidator: A(6),
    hotTierExecutor: A(7),
    canaryRegistry: A(8),
    drillRegistryFactory: A(9),
    pqSafeOwnerFactory: A(10),
    qanaryAccountFactory: A(11),
  },
  e2e: { kernelAccount: A(12) },
};

describe('deployments', () => {
  it('has both networks with the shared infrastructure even before anything is deployed', () => {
    for (const chainId of [42161, 421614] as const) {
      const d = deployments[chainId];
      expect(d.chainId).toBe(chainId);
      expect(d.entryPoint).toBe(ENTRY_POINT_V07);
      expect(d.kernel).toEqual(KERNEL_V3_3_ADDRESSES);
    }
    expect(deployments[42161].tokens).toEqual(ARBITRUM_ONE_TOKENS);
    expect(deployments[421614].tokens).toEqual({});
    expect(getDeployment(421614).network).toBe('arbitrum-sepolia');
    expect(() => getDeployment(1)).toThrow(/no Qanary deployment for chain 1/);
  });

  it('parses a deployment file (checksummed addresses, Stylus entries, e2e)', () => {
    const d = parseDeployment(421614, SEPOLIA_JSON);
    expect(d.verifiers).toEqual({
      mldsa44: '0x0101010101010101010101010101010101010101',
      mldsa65: '0x0202020202020202020202020202020202020202',
      falcon512: '0x0303030303030303030303030303030303030303',
    });
    expect(d.ladderVerifier).toBe('0x0404040404040404040404040404040404040404');
    expect(d.keyStore).toBe('0x0505050505050505050505050505050505050505');
    expect(d.qanaryAccountFactory).toBe(getAddress(A(11)));
    expect(d.e2e).toEqual({ kernelAccount: A(12) });
    expect(requireContract(d, 'hotTierExecutor')).toBe('0x0707070707070707070707070707070707070707');
    expect(requireVerifier(d, 'falcon512')).toBe('0x0303030303030303030303030303030303030303');
  });

  it('tolerates a missing or partial file', () => {
    expect(parseDeployment(42161, null).keyStore).toBeUndefined();
    const partial = parseDeployment(421614, { stylus: { mldsa44Verifier: { address: A(1) } } });
    expect(partial.verifiers).toEqual({ mldsa44: '0x0101010101010101010101010101010101010101' });
    expect(() => requireContract(partial, 'quantumValidator')).toThrow(
      'quantumValidator is not deployed on arbitrum-sepolia (deployments/arbitrum-sepolia.json)',
    );
    expect(() => requireVerifier(partial, 'mldsa65')).toThrow(/no mldsa65 verifier deployed on arbitrum-sepolia/);
  });

  it('rejects malformed files', () => {
    expect(() => parseDeployment(421614, { chainId: 42161 })).toThrow(/chainId 42161, expected 421614/);
    expect(() => parseDeployment(421614, { evm: { keyStore: '0x1234' } })).toThrow(/evm\.keyStore is not an address/);
    expect(() => parseDeployment(421614, [])).toThrow(/JSON object/);
  });
});
