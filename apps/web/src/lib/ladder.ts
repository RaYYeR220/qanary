// ECDSA on the five canary curves, in the browser.
//
// The three ladder curves (secp160r1, P-192, P-224) are defined from their SEC 2 /
// FIPS 186 parameters. Signing reproduces python-ecdsa's
// `sign_digest_deterministic(..., hashfunc=sha256, allow_truncate=True)` exactly:
// RFC 6979 nonces over SHA-256, the 32-byte digest truncated to the leftmost
// bitlen(n) bits (SEC 1), and no low-s normalisation. The registry's K1 check goes
// through OpenZeppelin ECDSA and its R1 check through OpenZeppelin P256, both of
// which require low-s, so those two sign with low-s.

import { ecdsa, weierstrass } from '@noble/curves/abstract/weierstrass.js';
import { p256 } from '@noble/curves/nist.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak256, encodeAbiParameters, type Address, type Hex } from 'viem';

export type LadderCurve = 'secp160r1' | 'p192' | 'p224';
export type TargetCurve = LadderCurve | 'secp256k1' | 'p256';

/** Canary targets in registry order: L1, L2, L3, K1, R1. */
export const TARGET_CURVES: readonly TargetCurve[] = ['secp160r1', 'p192', 'p224', 'secp256k1', 'p256'];

/** Curve ids the ladder verifier takes: 1 secp160r1, 2 P-192, 3 P-224. */
export const LADDER_CURVE_ID: Record<LadderCurve, 1 | 2 | 3> = { secp160r1: 1, p192: 2, p224: 3 };

const PARAMS: Record<LadderCurve, { p: bigint; a: bigint; b: bigint; n: bigint; Gx: bigint; Gy: bigint }> = {
  secp160r1: {
    p: 0xffffffffffffffffffffffffffffffff7fffffffn,
    a: 0xffffffffffffffffffffffffffffffff7ffffffcn,
    b: 0x1c97befc54bd7a8b65acf89f81d4d4adc565fa45n,
    n: 0x100000000000000000001f4c8f927aed3ca752257n,
    Gx: 0x4a96b5688ef573284664698968c38bb913cbfc82n,
    Gy: 0x23a628553168947d59dcc912042351377ac5fb32n,
  },
  p192: {
    p: 0xfffffffffffffffffffffffffffffffeffffffffffffffffn,
    a: 0xfffffffffffffffffffffffffffffffefffffffffffffffcn,
    b: 0x64210519e59c80e70fa7e9ab72243049feb8deecc146b9b1n,
    n: 0xffffffffffffffffffffffff99def836146bc9b1b4d22831n,
    Gx: 0x188da80eb03090f67cbf20eb43a18800f4ff0afd82ff1012n,
    Gy: 0x07192b95ffc8da78631011ed6b24cdd573f977a11e794811n,
  },
  p224: {
    p: 0xffffffffffffffffffffffffffffffff000000000000000000000001n,
    a: 0xfffffffffffffffffffffffffffffffefffffffffffffffffffffffen,
    b: 0xb4050a850c04b3abf54132565044b0b7d7bfd8ba270b39432355ffb4n,
    n: 0xffffffffffffffffffffffffffff16a2e0b8f03e13dd29455c5c2a3dn,
    Gx: 0xb70e0cbd6bb4bf7f321390b94a03c1d356c21122343280d6115c1d21n,
    Gy: 0xbd376388b5f723fb4c22dfe6cd4375a05a07476444d5819985007e34n,
  },
};

const LADDER = Object.fromEntries(
  (Object.keys(PARAMS) as LadderCurve[]).map((c) => [c, ecdsa(weierstrass({ ...PARAMS[c], h: 1n }), sha256, { lowS: false })]),
) as Record<LadderCurve, ReturnType<typeof ecdsa>>;

const hexToBytes = (h: string): Uint8Array => {
  const s = h.startsWith('0x') ? h.slice(2) : h;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const toWord = (v: bigint): Hex => `0x${v.toString(16).padStart(64, '0')}`;
const scalarBytes = (d: bigint, n: bigint): Uint8Array => {
  const len = Math.ceil(n.toString(2).length / 8);
  return hexToBytes(d.toString(16).padStart(len * 2, '0'));
};

/** Splits a compact r ‖ s signature of `len`-byte halves into two 32-byte words. */
function splitCompact(sig: Uint8Array): { r: Hex; s: Hex } {
  const half = sig.length / 2;
  const word = (b: Uint8Array) => toWord(BigInt(`0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('') || '0'}`));
  return { r: word(sig.slice(0, half)), s: word(sig.slice(half)) };
}

/** ECDSA over a 32-byte digest on a ladder curve, as python-ecdsa signs it. */
export function signLadder(curve: LadderCurve, privateKey: Hex, digest: Hex): { r: Hex; s: Hex } {
  const n = PARAMS[curve].n;
  const sig = LADDER[curve].sign(hexToBytes(digest), scalarBytes(BigInt(privateKey), n), { prehash: false, lowS: false });
  return splitCompact(sig);
}

/** Off-chain check of a ladder signature; false for anything malformed. */
export function verifyLadder(curve: LadderCurve, qx: Hex, qy: Hex, digest: Hex, r: Hex, s: Hex): boolean {
  try {
    const c = PARAMS[curve];
    const len = Math.ceil(c.n.toString(2).length / 8);
    const pLen = Math.ceil(c.p.toString(2).length / 8);
    const x = BigInt(qx), y = BigInt(qy), R = BigInt(r), S = BigInt(s);
    if (x >= c.p || y >= c.p || R <= 0n || S <= 0n || R >= c.n || S >= c.n) return false;
    const pub = new Uint8Array(1 + 2 * pLen);
    pub[0] = 4;
    pub.set(hexToBytes(x.toString(16).padStart(pLen * 2, '0')), 1);
    pub.set(hexToBytes(y.toString(16).padStart(pLen * 2, '0')), 1 + pLen);
    const sig = new Uint8Array(2 * len);
    sig.set(hexToBytes(R.toString(16).padStart(len * 2, '0')), 0);
    sig.set(hexToBytes(S.toString(16).padStart(len * 2, '0')), len);
    return LADDER[curve].verify(sig, hexToBytes(digest), pub, { prehash: false, lowS: false });
  } catch {
    return false;
  }
}

/** The public key of a private key on a target curve, as 32-byte words. */
export function publicKeyOf(curve: TargetCurve, privateKey: Hex): { x: Hex; y: Hex } {
  const d = BigInt(privateKey);
  const point =
    curve === 'secp256k1'
      ? secp256k1.Point.BASE.multiply(d)
      : curve === 'p256'
        ? p256.Point.BASE.multiply(d)
        : LADDER[curve].Point.BASE.multiply(d);
  const a = point.toAffine();
  return { x: toWord(a.x), y: toWord(a.y) };
}

/** keccak256("QANARY_CLAIM_V1"), the registry's claim domain. */
export const CLAIM_DOMAIN: Hex = keccak256(new TextEncoder().encode('QANARY_CLAIM_V1'));

/** The digest a claimant signs: keccak256(abi.encode(domain, chainId, registry, target, claimant)). */
export function claimMessage(chainId: number, registry: Address, target: number, claimant: Address): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint8' }, { type: 'address' }],
      [CLAIM_DOMAIN, BigInt(chainId), registry, target, claimant],
    ),
  );
}

export interface TargetSignature {
  r: Hex;
  s: Hex;
  /** K1 only: 27 or 28. */
  v?: number;
}

/** Signs `digest` with a target's private key the way the registry checks it. */
export function signTarget(target: number, privateKey: Hex, digest: Hex): TargetSignature {
  const curve = TARGET_CURVES[target];
  if (!curve) throw new Error(`invalid canary target ${target}`);
  if (curve === 'secp256k1') {
    const sig = secp256k1.sign(hexToBytes(digest), hexToBytes(privateKey), { prehash: false, lowS: true, format: 'recovered' });
    // recovered format: recovery byte first, then r and s
    const { r, s } = splitCompact(sig.slice(1));
    return { r, s, v: 27 + sig[0]! };
  }
  if (curve === 'p256') {
    const sig = p256.sign(hexToBytes(digest), hexToBytes(privateKey), { prehash: false, lowS: true });
    return splitCompact(sig);
  }
  return signLadder(curve, privateKey, digest);
}

/** Off-chain check of a target signature against its public key (K1: x, y of the key). */
export function verifyTarget(target: number, pub: { x: Hex; y: Hex }, digest: Hex, sig: TargetSignature): boolean {
  const curve = TARGET_CURVES[target];
  if (!curve) return false;
  if (curve === 'secp256k1' || curve === 'p256') {
    try {
      const impl = curve === 'secp256k1' ? secp256k1 : p256;
      const raw = new Uint8Array(64);
      raw.set(hexToBytes(sig.r.slice(2).padStart(64, '0')), 0);
      raw.set(hexToBytes(sig.s.slice(2).padStart(64, '0')), 32);
      const key = new Uint8Array(65);
      key[0] = 4;
      key.set(hexToBytes(pub.x.slice(2).padStart(64, '0')), 1);
      key.set(hexToBytes(pub.y.slice(2).padStart(64, '0')), 33);
      return impl.verify(raw, hexToBytes(digest), key, { prehash: false, lowS: true });
    } catch {
      return false;
    }
  }
  return verifyLadder(curve, pub.x, pub.y, digest, sig.r, sig.s);
}

/**
 * Flips one bit of a 32-byte word: the "tamper" toggle. For a digest flip the
 * high bit: the ladder curves keep only the leftmost bitlen(n) bits of the
 * digest, so a low bit is truncated away and the signature still verifies.
 */
export function tamperWord(word: Hex, bit: 'high' | 'low' = 'high'): Hex {
  return toWord(BigInt(word) ^ (bit === 'high' ? 1n << 255n : 1n));
}
