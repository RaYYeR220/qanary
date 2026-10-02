import { ml_dsa44, ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { falcon512padded } from '@noble/post-quantum/falcon.js';
import { shake256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from 'viem';
import { assertScheme, messageBytes, type PqSigner, type Scheme } from '../schemes.js';

type Alg = {
  keygen(seed: Uint8Array): { publicKey: Uint8Array; secretKey: Uint8Array };
  sign(msg: Uint8Array, secretKey: Uint8Array): Uint8Array;
};

// Falcon-512 maps to noble's round-3 *padded* encoding (fixed 666-byte signatures), which is
// what the on-chain Falcon verifier accepts.
const ALGS: Record<Scheme, Alg> = {
  mldsa44: ml_dsa44,
  mldsa65: ml_dsa65,
  falcon512: falcon512padded,
};

/**
 * Expands a 32-byte seed into the seed the scheme's keygen expects: ML-DSA takes the 32 bytes
 * as-is, Falcon keygen needs 48 bytes and gets SHAKE256(seed32, 48). Same as `scripts/devsign`.
 */
function keygenSeed(scheme: Scheme, seed32: Uint8Array): Uint8Array {
  return scheme === 'falcon512' ? shake256(seed32, { dkLen: 48 }) : seed32;
}

/**
 * Deterministic key generation from a 32-byte seed; signatures are hedged (randomized, noble's
 * default). Messages are the raw 32-byte hash signed in pure mode with an empty context, exactly
 * what the ERC-7913 verifiers check.
 */
export function pqSignerFromSeed(scheme: Scheme, seed32: Uint8Array): PqSigner {
  assertScheme(scheme);
  if (!(seed32 instanceof Uint8Array) || seed32.length !== 32) {
    throw new Error('seed must be 32 bytes');
  }
  const alg = ALGS[scheme];
  const { publicKey, secretKey } = alg.keygen(keygenSeed(scheme, seed32));
  return {
    scheme,
    publicKey,
    async sign(message32) {
      return bytesToHex(alg.sign(messageBytes(message32), secretKey));
    },
  };
}
