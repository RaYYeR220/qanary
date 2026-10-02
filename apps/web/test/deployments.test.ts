import { describe, expect, it } from 'vitest';
import { NETWORKS, REGISTER, collect, recordFrom, shortHex } from '@/lib/deployments';

const one = NETWORKS[0]!;
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const tx = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;

describe('deployment records', () => {
  it('lists every register slot as deploying when there is no record', () => {
    const r = recordFrom(one, {});
    expect(r.contracts).toHaveLength(REGISTER.length);
    expect(r.contracts.every((c) => c.entry === null)).toBe(true);
    expect(r.transactions).toEqual([]);
  });

  it('matches contract keys to register slots and links the explorer', () => {
    const r = recordFrom(one, {
      contracts: {
        MLDSA44Verifier: addr(1),
        Falcon512Verifier: addr(2),
        QuantumCanaryRegistry: addr(3),
        QuantumValidator: addr(4),
        HotTierExecutor: addr(5),
        KeyStore: addr(6),
      },
    });
    const by = Object.fromEntries(r.contracts.map((c) => [c.label, c.entry?.value ?? null]));
    expect(by['ML-DSA-44 verifier']).toBe(addr(1));
    expect(by['ML-DSA-65 verifier']).toBeNull();
    expect(by['Falcon-512 verifier']).toBe(addr(2));
    expect(by['Tripwire registry']).toBe(addr(3));
    expect(by['Quantum validator']).toBe(addr(4));
    expect(by['Hot-tier executor']).toBe(addr(5));
    expect(by['Key store']).toBe(addr(6));
    expect(r.contracts[0]!.entry!.href).toBe(`https://arbiscan.io/address/${addr(1)}`);
  });

  it('does not list third-party contracts as ours', () => {
    const r = recordFrom(one, {
      external: { entryPoint: addr(9), kernelFactory: addr(10), ecdsaValidator: addr(11), usdg: addr(12) },
    });
    expect(r.contracts.every((c) => c.entry === null)).toBe(true);
  });

  it('collects transaction hashes with readable labels', () => {
    const r = recordFrom(one, { e2e: { createTreasury: tx(1), hot_over_cap_revert: tx(2) } });
    expect(r.transactions.map((t) => t.label)).toEqual(['Create treasury', 'Hot over cap revert']);
    expect(r.transactions[0]!.href).toBe(`https://arbiscan.io/tx/${tx(1)}`);
  });

  it('ignores strings that only look like hex', () => {
    const { addresses, txs } = collect({ a: '0x1234', b: 'not an address', c: [addr(1)] });
    expect(addresses).toEqual([['c.0', addr(1)]]);
    expect(txs).toEqual([]);
  });

  it('shortens hex for display', () => {
    expect(shortHex(addr(255))).toBe('0x0000…00ff');
  });
});
