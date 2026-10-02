import { hexToBytes, isHex, type Hex } from 'viem';

/** Post-quantum signature schemes supported by the Qanary verifiers. */
export type Scheme = 'mldsa44' | 'mldsa65' | 'falcon512';

/** All supported schemes, in on-chain id order. */
export const SCHEMES = ['mldsa44', 'mldsa65', 'falcon512'] as const satisfies readonly Scheme[];

/**
 * On-chain scheme ids: the first byte of a key blob.
 * 2 = ML-DSA-44, 3 = ML-DSA-65, 4 = Falcon-512 (round-3, padded signatures).
 */
export const SCHEME_ID: Record<Scheme, 2 | 3 | 4> = { mldsa44: 2, mldsa65: 3, falcon512: 4 };

/** Raw public key sizes in bytes. */
export const PUBLIC_KEY_BYTES: Record<Scheme, number> = { mldsa44: 1312, mldsa65: 1952, falcon512: 897 };

/** Signature sizes in bytes (Falcon-512 uses the fixed-length round-3 padded encoding). */
export const SIGNATURE_BYTES: Record<Scheme, number> = { mldsa44: 2420, mldsa65: 3309, falcon512: 666 };

/** ERC-7913 `verify` return value for a valid signature. */
export const ERC7913_MAGIC: Hex = '0x024ad318';

/**
 * A post-quantum signer. `sign` takes the raw 32-byte hash that the on-chain verifier receives
 * and signs it directly (pure mode, empty context); the result is the raw signature bytes.
 */
export interface PqSigner {
  scheme: Scheme;
  publicKey: Uint8Array;
  sign(message32: Hex): Promise<Hex>;
}

export function assertScheme(scheme: string): asserts scheme is Scheme {
  if (!(SCHEMES as readonly string[]).includes(scheme)) {
    throw new Error(`unsupported scheme "${scheme}" (expected one of ${SCHEMES.join(', ')})`);
  }
}

/** Decodes the message a signer signs: exactly 32 bytes of 0x-prefixed hex. */
export function messageBytes(message32: Hex): Uint8Array {
  if (typeof message32 !== 'string' || message32.length !== 66 || !isHex(message32, { strict: true })) {
    throw new Error('message must be a 32-byte 0x-prefixed hex hash');
  }
  return hexToBytes(message32);
}
