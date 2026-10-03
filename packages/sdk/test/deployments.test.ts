import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import {
  ARBITRUM_ONE_TOKENS,
  ENTRY_POINT_V07,
  KERNEL_V3_3_ADDRESSES,
  NETWORKS,
  deployments,
  explorerTxUrl,
  getDeployment,
  nativeSymbol,
  networkByChainId,
  networkByName,
  parseDeployment,
  pimlicoPublicBundler,
  requireContract,
  requireVerifier,
} from '../src/index.js';

const A = (n: number) => `0x${n.toString(16).padStart(2, '0').repeat(20)}`;

/** The layout written by the deployment scripts (`deployments/<network>.json`). */
const CURTIS_JSON = {
  chainId: 33111,
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
  e2e: { sdk: { kernelAccount: A(12) } },
};

describe('networks', () => {
  it('knows Arbitrum One, ApeChain, ApeChain Curtis and Arbitrum Sepolia', () => {
    expect(Object.values(NETWORKS).map((n) => [n.name, n.chainId, n.nativeSymbol])).toEqual([
      ['arbitrum-one', 42161, 'ETH'],
      ['apechain', 33139, 'APE'],
      ['apechain-curtis', 33111, 'APE'],
      ['arbitrum-sepolia', 421614, 'ETH'],
    ]);
    expect(networkByName('apechain-curtis')?.chainId).toBe(33111);
    expect(networkByName('toString')).toBeUndefined();
    expect(networkByChainId(33139)?.name).toBe('apechain');
    expect(networkByChainId(1)).toBeUndefined();
  });

  it('per-chain native symbol, explorer and public bundler', () => {
    expect(nativeSymbol(33139)).toBe('APE');
    expect(nativeSymbol(33111)).toBe('APE');
    expect(nativeSymbol(42161)).toBe('ETH');
    expect(nativeSymbol(1)).toBe('ETH');
    expect(explorerTxUrl(42161, '0xab')).toBe('https://arbiscan.io/tx/0xab');
    expect(explorerTxUrl(33139, '0xab')).toBe('https://apescan.io/tx/0xab');
    expect(explorerTxUrl(33111, '0xab')).toBe('https://curtis.apescan.io/tx/0xab');
    expect(explorerTxUrl(1, '0xab')).toBeUndefined();
    // Pimlico's public endpoint answers "chain not supported" for ApeChain (checked 2026-10-02)
    expect(pimlicoPublicBundler(42161)).toBe('https://public.pimlico.io/v2/42161/rpc');
    expect(pimlicoPublicBundler(33139)).toBeUndefined();
    expect(pimlicoPublicBundler(33111)).toBeUndefined();
  });
});

describe('deployments', () => {
  it('has every known network with the shared infrastructure even before anything is deployed', () => {
    for (const n of Object.values(NETWORKS)) {
      const d = getDeployment(n.chainId);
      expect(d).toBe(deployments[n.chainId]);
      expect(d.network).toBe(n.name);
      expect(d.nativeSymbol).toBe(n.nativeSymbol);
      expect(d.entryPoint).toBe(ENTRY_POINT_V07);
      expect(d.kernel).toEqual(KERNEL_V3_3_ADDRESSES);
    }
    expect(getDeployment(42161).tokens).toEqual(ARBITRUM_ONE_TOKENS);
    expect(getDeployment(33139).tokens).toEqual({});
    expect(() => getDeployment(1)).toThrow(
      'no Qanary deployment for chain 1 (known: 42161 arbitrum-one, 33139 apechain, 33111 apechain-curtis, 421614 arbitrum-sepolia)',
    );
  });

  it('parses a deployment file (checksummed addresses, Stylus entries, e2e)', () => {
    const d = parseDeployment(33111, CURTIS_JSON);
    expect(d.network).toBe('apechain-curtis');
    expect(d.nativeSymbol).toBe('APE');
    expect(d.verifiers).toEqual({
      mldsa44: '0x0101010101010101010101010101010101010101',
      mldsa65: '0x0202020202020202020202020202020202020202',
      falcon512: '0x0303030303030303030303030303030303030303',
    });
    expect(d.ladderVerifier).toBe('0x0404040404040404040404040404040404040404');
    expect(d.keyStore).toBe('0x0505050505050505050505050505050505050505');
    expect(d.qanaryAccountFactory).toBe(getAddress(A(11)));
    expect(d.e2e).toEqual({ sdk: { kernelAccount: A(12) } });
    expect(requireContract(d, 'hotTierExecutor')).toBe('0x0707070707070707070707070707070707070707');
    expect(requireVerifier(d, 'falcon512')).toBe('0x0303030303030303030303030303030303030303');
  });

  it('takes per-chain EntryPoint / Kernel overrides from the file', () => {
    const d = parseDeployment(33139, { entryPoint: A(20), kernel: { factory: A(21) } });
    expect(d.entryPoint).toBe(getAddress(A(20)));
    expect(d.kernel).toEqual({ ...KERNEL_V3_3_ADDRESSES, factory: getAddress(A(21)) });
    // the shared default is not mutated
    expect(KERNEL_V3_3_ADDRESSES.factory).toBe('0x2577507b78c2008Ff367261CB6285d44ba5eF2E9');
  });

  it('reads contract entries recorded as objects and the Solidity ML-DSA-44 fallback', () => {
    const d = parseDeployment(42161, {
      evm: { keyStore: { address: A(5), deployTx: `0x${'ab'.repeat(32)}` }, mldsa44SolidityVerifier: { address: A(6) } },
    });
    expect(d.keyStore).toBe('0x0505050505050505050505050505050505050505');
    expect(requireVerifier(d, 'mldsa44')).toBe('0x0606060606060606060606060606060606060606');
    const both = parseDeployment(33139, {
      stylus: { mldsa44Verifier: { address: A(1) } },
      evm: { mldsa44SolidityVerifier: { address: A(6) } },
    });
    expect(both.verifiers.mldsa44).toBe('0x0101010101010101010101010101010101010101');
  });

  it('accepts chains without a network entry', () => {
    const d = parseDeployment(8453, { evm: { keyStore: A(5) } });
    expect(d).toMatchObject({ network: 'chain-8453', nativeSymbol: 'ETH', tokens: {} });
    expect(d.keyStore).toBe('0x0505050505050505050505050505050505050505');
  });

  it('tolerates a missing or partial file', () => {
    expect(parseDeployment(42161, null).keyStore).toBeUndefined();
    const partial = parseDeployment(33139, { stylus: { mldsa44Verifier: { address: A(1) } } });
    expect(partial.verifiers).toEqual({ mldsa44: '0x0101010101010101010101010101010101010101' });
    expect(() => requireContract(partial, 'quantumValidator')).toThrow(
      'quantumValidator is not deployed on apechain (deployments/apechain.json)',
    );
    expect(() => requireVerifier(partial, 'mldsa65')).toThrow(/no mldsa65 verifier deployed on apechain/);
  });

  it('rejects malformed files', () => {
    expect(() => parseDeployment(33111, { chainId: 33139 })).toThrow(/chainId 33139, expected 33111/);
    expect(() => parseDeployment(33111, { evm: { keyStore: '0x1234' } })).toThrow(/evm\.keyStore is not an address/);
    expect(() => parseDeployment(33111, { evm: { keyStore: { address: '0x1234' } } })).toThrow(
      /evm\.keyStore\.address is not an address/,
    );
    expect(() => parseDeployment(33111, { kernel: { factory: 'nope' } })).toThrow(/kernel\.factory is not an address/);
    expect(() => parseDeployment(33111, [])).toThrow(/JSON object/);
    expect(() => parseDeployment(0, null)).toThrow(/invalid chain id/);
  });
});
