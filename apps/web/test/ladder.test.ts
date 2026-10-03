import fs from 'node:fs';
import path from 'node:path';
import { recoverAddress, type Address, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  TARGET_CURVES,
  claimMessage,
  publicKeyOf,
  signLadder,
  signTarget,
  tamperWord,
  verifyLadder,
  verifyTarget,
  type LadderCurve,
} from '@/lib/ladder';

const ROOT = path.join(import.meta.dirname, '..', '..', '..');
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const targets = read('deployments/canary-targets.json') as {
  drill: Record<string, { privateKey: Hex; x: Hex; y: Hex; address?: Address }>;
  nums: Record<string, { x: Hex; y: Hex; ctr: number }>;
};
const fixtures = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'drill-signatures.json'), 'utf8')) as {
  cases: { curve: LadderCurve; target: number; chainId: number; registry: Address; claimant: Address; message: Hex; r: Hex; s: Hex }[];
};

describe('ladder curves against the repository vectors', () => {
  for (const curve of ['secp160r1', 'p192', 'p224'] as const) {
    const file = read(`vectors/ladder/${curve}.json`) as {
      vectors: { kind: string; qx: Hex; qy: Hex; digest: Hex; r: Hex; s: Hex; valid: boolean }[];
    };
    it(`${curve}: every vector verifies exactly as recorded (${file.vectors.length} vectors)`, () => {
      const wrong = file.vectors.filter((v) => verifyLadder(curve, v.qx, v.qy, v.digest, v.r, v.s) !== v.valid).map((v) => v.kind);
      expect(wrong).toEqual([]);
    });
  }
});

describe('drill signatures reproduce python-ecdsa byte for byte', () => {
  for (const c of fixtures.cases) {
    it(`${c.curve} on chain ${c.chainId}`, () => {
      const m = claimMessage(c.chainId, c.registry, c.target, c.claimant);
      expect(m).toBe(c.message);
      const sig = signLadder(c.curve, targets.drill[c.curve]!.privateKey, m);
      expect(sig).toEqual({ r: c.r, s: c.s });
      const d = targets.drill[c.curve]!;
      expect(verifyLadder(c.curve, d.x, d.y, m, sig.r, sig.s)).toBe(true);
    });
  }
});

describe('drill keys and the production curves', () => {
  it('derives the published drill public keys from the published private keys', () => {
    TARGET_CURVES.forEach((curve) => {
      const d = targets.drill[curve]!;
      expect(publicKeyOf(curve, d.privateKey)).toEqual({ x: d.x, y: d.y });
    });
  });

  it('signs K1 with a recovery id that recovers the drill address, low-s', async () => {
    const d = targets.drill.secp256k1!;
    const m = claimMessage(33139, '0x00000000000000000000000000000000c0ffee01', 3, '0x00000000000000000000000000000000000a11ce');
    const sig = signTarget(3, d.privateKey, m);
    expect(sig.v === 27 || sig.v === 28).toBe(true);
    expect(BigInt(sig.s) <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n).toBe(true);
    const yParity = sig.v! - 27;
    const recovered = await recoverAddress({ hash: m, signature: { r: sig.r, s: sig.s, yParity } });
    expect(recovered).toBe(d.address);
  });

  it('signs R1 low-s and verifies against the drill P-256 key', () => {
    const d = targets.drill.p256!;
    const m = claimMessage(33139, '0x00000000000000000000000000000000c0ffee01', 4, '0x00000000000000000000000000000000000a11ce');
    const sig = signTarget(4, d.privateKey, m);
    expect(BigInt(sig.s) <= 0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8n).toBe(true);
    expect(verifyTarget(4, d, m, sig)).toBe(true);
    expect(verifyTarget(4, d, m, { ...sig, s: tamperWord(sig.s, 'low') })).toBe(false);
  });

  it('rejects a tampered ladder signature', () => {
    const d = targets.drill.p224!;
    const m = claimMessage(1, '0x00000000000000000000000000000000c0ffee01', 2, '0x00000000000000000000000000000000000a11ce');
    const sig = signTarget(2, d.privateKey, m);
    expect(verifyTarget(2, d, m, sig)).toBe(true);
    expect(verifyTarget(2, d, tamperWord(m), sig)).toBe(false);
    // a low digest bit lies past P-224's 224-bit truncation: the signature still holds
    expect(verifyTarget(2, d, tamperWord(m, 'low'), sig)).toBe(true);
  });
});
