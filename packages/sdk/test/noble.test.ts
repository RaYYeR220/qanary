import { describe, expect, it } from 'vitest';
import { ml_dsa44, ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { falcon512padded } from '@noble/post-quantum/falcon.js';
import { bytesToHex, hexToBytes, keccak256, type Hex } from 'viem';
import {
  PUBLIC_KEY_BYTES,
  SCHEMES,
  SCHEME_ID,
  SIGNATURE_BYTES,
  pqSignerFromSeed,
  type Scheme,
} from '../src/index.js';

const SEED = new Uint8Array(32).fill(1);

// keccak256 of the public keys produced by scripts/devsign (the forge FFI signer) for the
// seed 0x0101…01, so SDK-derived keys match the ones used by the contract test suites.
const DEVSIGN_PK_HASH: Record<Scheme, Hex> = {
  mldsa44: '0x30a5061cd97b50902a5d41219d8c86d8e1bb518443973199b47d9b36d0da3f2f',
  mldsa65: '0xf040b4e6b3f00456ed9a880cf139948a0978c970458d510cc2353f6293960c21',
  falcon512: '0x2daeabdd0660ab65998ed62bff54905ddfd8fb3aea95098e27a887b195505c1e',
};

const VERIFY: Record<Scheme, (sig: Uint8Array, msg: Uint8Array, pk: Uint8Array) => boolean> = {
  mldsa44: (sig, msg, pk) => ml_dsa44.verify(sig, msg, pk),
  mldsa65: (sig, msg, pk) => ml_dsa65.verify(sig, msg, pk),
  falcon512: (sig, msg, pk) => falcon512padded.verify(sig, msg, pk),
};

const randomHash = (): Hex => bytesToHex(crypto.getRandomValues(new Uint8Array(32)));

describe('scheme constants', () => {
  it('match the on-chain scheme ids and sizes', () => {
    expect(SCHEMES).toEqual(['mldsa44', 'mldsa65', 'falcon512']);
    expect(SCHEME_ID).toEqual({ mldsa44: 2, mldsa65: 3, falcon512: 4 });
    expect(PUBLIC_KEY_BYTES).toEqual({ mldsa44: 1312, mldsa65: 1952, falcon512: 897 });
    expect(SIGNATURE_BYTES).toEqual({ mldsa44: 2420, mldsa65: 3309, falcon512: 666 });
  });
});

describe.each(SCHEMES)('pqSignerFromSeed(%s)', (scheme) => {
  const signer = pqSignerFromSeed(scheme, SEED);

  it('derives the same public key as the dev signer', () => {
    expect(signer.scheme).toBe(scheme);
    expect(signer.publicKey.length).toBe(PUBLIC_KEY_BYTES[scheme]);
    expect(keccak256(signer.publicKey)).toBe(DEVSIGN_PK_HASH[scheme]);
  });

  it('signs the raw 32-byte hash (pure mode, empty context) and noble verifies it', async () => {
    const hash = randomHash();
    const sig = hexToBytes(await signer.sign(hash));
    expect(sig.length).toBe(SIGNATURE_BYTES[scheme]);
    expect(VERIFY[scheme](sig, hexToBytes(hash), signer.publicKey)).toBe(true);
  });

  it('produces signatures that fail for another hash, a tampered signature or another key', async () => {
    const hash = randomHash();
    const sig = hexToBytes(await signer.sign(hash));
    expect(VERIFY[scheme](sig, hexToBytes(randomHash()), signer.publicKey)).toBe(false);

    const tampered = sig.slice();
    tampered[100] = (tampered[100] ?? 0) ^ 0x01;
    expect(VERIFY[scheme](tampered, hexToBytes(hash), signer.publicKey)).toBe(false);

    const other = pqSignerFromSeed(scheme, new Uint8Array(32).fill(2));
    expect(VERIFY[scheme](sig, hexToBytes(hash), other.publicKey)).toBe(false);
  });

  it('is deterministic in the seed', () => {
    expect(pqSignerFromSeed(scheme, SEED.slice()).publicKey).toEqual(signer.publicKey);
    expect(pqSignerFromSeed(scheme, new Uint8Array(32).fill(2)).publicKey).not.toEqual(signer.publicKey);
  });

  it('rejects seeds that are not 32 bytes', () => {
    expect(() => pqSignerFromSeed(scheme, new Uint8Array(31))).toThrow(/32/);
    expect(() => pqSignerFromSeed(scheme, new Uint8Array(48))).toThrow(/32/);
  });

  it('rejects messages that are not exactly 32 bytes', async () => {
    await expect(signer.sign('0x1234')).rejects.toThrow(/32/);
    await expect(signer.sign(bytesToHex(new Uint8Array(33)))).rejects.toThrow(/32/);
  });
});

it('rejects unknown schemes', () => {
  expect(() => pqSignerFromSeed('ecdsa' as Scheme, SEED)).toThrow(/scheme/);
});
