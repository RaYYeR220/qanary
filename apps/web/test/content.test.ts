import { describe, expect, it } from 'vitest';
import { GAS, RUNGS, VALIDATION_BUDGET } from '@/content/facts';
import { FALCON_Q, GAUZE_BASIS, GAUZE_H } from '@/engraving/lattice';

describe('printed figures', () => {
  it('states each speed-up as the measured ratio, rounded', () => {
    for (const row of GAS) {
      const ratio = row.solidity[0]!.gas / row.stylus;
      expect(Math.round(ratio)).toBe(Number(row.ratio));
    }
  });

  it('keeps every Stylus verifier inside the validation budget and every Solidity one outside it', () => {
    for (const row of GAS) {
      expect(row.stylus).toBeLessThan(VALIDATION_BUDGET);
      for (const s of row.solidity) expect(s.gas).toBeGreaterThan(VALIDATION_BUDGET);
    }
  });

  it('has the ladder in order: none, three short curves, then the two families', () => {
    expect(RUNGS.map((r) => r.curve)).toEqual([null, 'secp160r1', 'P-192', 'P-224', 'secp256k1', 'P-256']);
    expect(RUNGS.map((r) => r.at)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('gauze lattice', () => {
  it('is a reduced basis of y = h x (mod q) with Falcon’s modulus', () => {
    const [b1, b2] = GAUZE_BASIS;
    expect(GAUZE_BASIS).toEqual([
      [109, 3],
      [-27, 112],
    ]);
    for (const [x, y] of [b1, b2]) {
      expect((((y - GAUZE_H * x) % FALCON_Q) + FALCON_Q) % FALCON_Q).toBe(0);
    }
    expect(Math.abs(b1[0] * b2[1] - b1[1] * b2[0])).toBe(FALCON_Q);
  });
});
