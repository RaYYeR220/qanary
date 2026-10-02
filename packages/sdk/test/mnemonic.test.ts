import { describe, expect, it } from 'vitest';
import { hkdfSync, pbkdf2Sync } from 'node:crypto';
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { SCHEMES, generateMnemonic, pqSignerFromMnemonic, pqSignerFromSeed } from '../src/index.js';

// BIP-39 test mnemonic (all-zero entropy).
const ABANDON = `${'abandon '.repeat(11)}about`;

// Independent re-implementation of the derivation path with node:crypto:
// BIP-39 seed = PBKDF2-HMAC-SHA512(mnemonic, "mnemonic", 2048, 64)
// signer seed = HKDF-SHA256(ikm = BIP-39 seed, salt = empty, info = "qanary/<scheme>/v1/<index>", 32)
function referenceSeed(mnemonic: string, scheme: string, index: number): Uint8Array {
  const bip39Seed = pbkdf2Sync(mnemonic.normalize('NFKD'), 'mnemonic', 2048, 64, 'sha512');
  return new Uint8Array(hkdfSync('sha256', bip39Seed, new Uint8Array(0), `qanary/${scheme}/v1/${index}`, 32));
}

describe('generateMnemonic', () => {
  it('returns a fresh valid 24-word English BIP-39 mnemonic', () => {
    const a = generateMnemonic();
    const b = generateMnemonic();
    expect(a.split(' ')).toHaveLength(24);
    expect(validateMnemonic(a, wordlist)).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe.each(SCHEMES)('pqSignerFromMnemonic(%s)', (scheme) => {
  it('derives the signer seed as HKDF-SHA256(BIP-39 seed, "qanary/<scheme>/v1/<index>")', () => {
    for (const index of [0, 7]) {
      const expected = pqSignerFromSeed(scheme, referenceSeed(ABANDON, scheme, index));
      const signer = pqSignerFromMnemonic(scheme, ABANDON, index);
      expect(signer.scheme).toBe(scheme);
      expect(signer.publicKey).toEqual(expected.publicKey);
    }
  });

  it('is deterministic, defaults to index 0 and separates indices', () => {
    const mnemonic = generateMnemonic();
    const first = pqSignerFromMnemonic(scheme, mnemonic);
    expect(pqSignerFromMnemonic(scheme, mnemonic, 0).publicKey).toEqual(first.publicKey);
    expect(pqSignerFromMnemonic(scheme, mnemonic, 1).publicKey).not.toEqual(first.publicKey);
    expect(pqSignerFromMnemonic(scheme, generateMnemonic()).publicKey).not.toEqual(first.publicKey);
  });

  it('normalizes surrounding and repeated whitespace', () => {
    const messy = `  ${ABANDON.split(' ').join('   ')}\n`;
    expect(pqSignerFromMnemonic(scheme, messy).publicKey).toEqual(pqSignerFromMnemonic(scheme, ABANDON).publicKey);
  });
});

it('separates schemes: the same mnemonic and index give unrelated seeds', () => {
  expect(referenceSeed(ABANDON, 'mldsa44', 0)).not.toEqual(referenceSeed(ABANDON, 'mldsa65', 0));
  const a = pqSignerFromMnemonic('mldsa44', ABANDON).publicKey;
  const b = pqSignerFromSeed('mldsa44', referenceSeed(ABANDON, 'mldsa65', 0)).publicKey;
  expect(a).not.toEqual(b);
});

it('rejects invalid mnemonics', () => {
  expect(() => pqSignerFromMnemonic('mldsa44', `${'abandon '.repeat(11)}abandon`)).toThrow(/mnemonic/i);
  expect(() => pqSignerFromMnemonic('mldsa44', `${'abandon '.repeat(11)}qanary`)).toThrow(/mnemonic/i);
  expect(() => pqSignerFromMnemonic('mldsa44', '')).toThrow(/mnemonic/i);
});

it('rejects indices that are not non-negative safe integers', () => {
  for (const index of [-1, 1.5, Number.NaN, 2 ** 53]) {
    expect(() => pqSignerFromMnemonic('mldsa44', ABANDON, index)).toThrow(/index/);
  }
});
