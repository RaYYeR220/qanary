import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DeploymentError, NETWORKS, parseRecord, readDeployments, shortHex } from '@/lib/deployments';

const ape = NETWORKS.find((n) => n.key === 'apechain')!;
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const tx = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const base = { network: 'apechain', chainId: 33139 };

describe('deployment records', () => {
  it('lists the networks with ApeChain first', () => {
    expect(NETWORKS.map((n) => [n.key, n.chainId, n.explorer])).toEqual([
      ['apechain', 33139, 'https://apescan.io'],
      ['apechain-curtis', 33111, 'https://curtis.apescan.io'],
      ['arbitrum-one', 42161, 'https://arbiscan.io'],
    ]);
  });

  it('reads Stylus programs with explicit labels, explorer links and their transactions', () => {
    const r = parseRecord(ape, {
      ...base,
      stylus: {
        mldsa44Verifier: { address: addr(1), deployTx: tx(1), activationTx: tx(2), sizeBytes: 15933, codehash: tx(9), verifyCallGas: 207646 },
        ladderVerifier: { address: addr(2), deployTx: tx(3), verify: { gasByCurve: { secp160r1: 828518, p224: 1152888 } } },
      },
    });
    const v = r.stylus.mldsa44Verifier!;
    expect(v.label).toBe('ML-DSA-44 verifier');
    expect(v.href).toBe(`https://apescan.io/address/${addr(1)}`);
    expect(v.txs.map((t) => [t.label, t.href])).toEqual([
      ['deployment', `https://apescan.io/tx/${tx(1)}`],
      ['activation', `https://apescan.io/tx/${tx(2)}`],
    ]);
    // codehash is a 32-byte value but not a transaction
    expect(v.txs.some((t) => t.hash === tx(9))).toBe(false);
    expect(v.verifyCallGas).toBe(207646);
    expect(r.stylus.ladderVerifier!.gasByCurve).toEqual({ secp160r1: 828518, p224: 1152888 });
    expect(r.stylus.falcon512Verifier).toBeUndefined();
  });

  it('takes only *Tx fields of e2e as transactions', () => {
    const r = parseRecord(ape, { ...base, e2e: { createTreasuryTx: tx(5), note: 'x', blockNumber: 12 } });
    expect(r.e2e.map((t) => t.label)).toEqual(['create treasury']);
  });

  it('rejects the zero address', () => {
    expect(() => parseRecord(ape, { ...base, stylus: { mldsa44Verifier: { address: addr(0) } } })).toThrow(/zero address/);
  });

  it('rejects malformed records', () => {
    expect(() => parseRecord(ape, [])).toThrow(DeploymentError);
    expect(() => parseRecord(ape, { ...base, chainId: 1 })).toThrow(/chainId/);
    expect(() => parseRecord(ape, { ...base, network: 'arbitrum-one' })).toThrow(/network/);
    expect(() => parseRecord(ape, { ...base, stylus: { someOtherVerifier: { address: addr(1) } } })).toThrow(/unknown Stylus/);
    expect(() => parseRecord(ape, { ...base, stylus: { mldsa44Verifier: { address: '0x1234' } } })).toThrow(/not an address/);
    expect(() => parseRecord(ape, { ...base, stylus: { mldsa44Verifier: { address: addr(1), deployTx: '0xabc' } } })).toThrow(/transaction hash/);
  });

  it('reads a missing file as deploying and fails the build on invalid JSON', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deployments-'));
    fs.writeFileSync(path.join(dir, 'apechain.json'), JSON.stringify({ ...base, stylus: { falcon512Verifier: { address: addr(7) } } }));
    const records = readDeployments(dir);
    expect(records.map((r) => r.present)).toEqual([true, false, false]);
    fs.writeFileSync(path.join(dir, 'arbitrum-one.json'), '{ not json');
    expect(() => readDeployments(dir)).toThrow(/arbitrum-one\.json: invalid JSON/);
  });

  it('accepts the committed records', () => {
    const records = readDeployments();
    const ape = records.find((r) => r.network.key === 'apechain')!;
    expect(ape.present).toBe(true);
    expect(Object.keys(ape.stylus).sort()).toEqual(['falcon512Verifier', 'ladderVerifier', 'mldsa44Verifier', 'mldsa65Verifier']);
  });

  it('shortens hex for display', () => {
    expect(shortHex(addr(255))).toBe('0x0000…00ff');
  });
});
