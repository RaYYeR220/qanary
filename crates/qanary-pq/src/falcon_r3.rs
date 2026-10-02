//! Falcon-512 as specified for NIST PQC round 3 (falcon-sign.info, v1.2).
//!
//! Only the mod-q NTT arithmetic is borrowed from `fn-dsa-comm` (q = 12289, the same
//! ring Z_q[X]/(X^512+1) FN-DSA uses); the byte codecs and hash-to-point below are
//! round-3 specific, since the FN-DSA draft changed all of them (bit order, hash-to-point
//! bound, B_inf).
//!
//! Signature input format (detached, header 0x30 + logn = 0x39 for Falcon-512):
//!   0x39 || nonce[40] || comp(s2)            (compressed, variable length, no trailing bytes)
//! or the "padded" form of the same signature:
//!   0x39 || nonce[40] || comp(s2) || 0x00*   (exactly 666 bytes)
//! Public key: 0x09 || 512 x 14-bit big-endian packed coefficients (897 bytes).

use crate::{VerifyError, FALCON512_PK_LEN, FALCON512_SIG_MAX_LEN};
use fn_dsa_comm::{mq, shake::SHAKE256};

const LOGN: u32 = 9;
const N: usize = 512;
const Q: u32 = 12289;
const NONCE_LEN: usize = 40;
/// floor(beta^2) for Falcon-512 (round-3 spec, `l2bound[9]`).
const L2BOUND_512: u64 = 34_034_726;
const PADDED_SIG_LEN_512: usize = 666;

/// Decoded round-3 Falcon-512 public key, `h` in `fn-dsa-comm`'s NTT representation.
pub struct PublicKey {
    h_ntt: [u16; N],
}

impl PublicKey {
    pub fn decode(pk: &[u8]) -> Result<Self, VerifyError> {
        if pk.len() != FALCON512_PK_LEN {
            return Err(VerifyError::KeyLength { expected: FALCON512_PK_LEN, got: pk.len() });
        }
        if pk[0] != LOGN as u8 {
            return Err(VerifyError::KeyDecode);
        }
        let mut h = [0u16; N];
        // 14-bit big-endian bit packing, 4 coefficients per 7 bytes.
        let src = &pk[1..];
        let mut i = 0;
        let mut j = 0;
        while i < N {
            let x = ((src[j] as u64) << 48)
                | ((src[j + 1] as u64) << 40)
                | ((src[j + 2] as u64) << 32)
                | ((src[j + 3] as u64) << 24)
                | ((src[j + 4] as u64) << 16)
                | ((src[j + 5] as u64) << 8)
                | (src[j + 6] as u64);
            let c0 = ((x >> 42) & 0x3FFF) as u32;
            let c1 = ((x >> 28) & 0x3FFF) as u32;
            let c2 = ((x >> 14) & 0x3FFF) as u32;
            let c3 = (x & 0x3FFF) as u32;
            if c0 >= Q || c1 >= Q || c2 >= Q || c3 >= Q {
                return Err(VerifyError::KeyDecode);
            }
            h[i] = c0 as u16;
            h[i + 1] = c1 as u16;
            h[i + 2] = c2 as u16;
            h[i + 3] = c3 as u16;
            i += 4;
            j += 7;
        }
        mq::mqpoly_ext_to_int(LOGN, &mut h);
        mq::mqpoly_int_to_NTT(LOGN, &mut h);
        Ok(Self { h_ntt: h })
    }

    /// Returns `false` for any malformed or non-verifying signature.
    pub fn verify(&self, msg: &[u8], sig: &[u8]) -> bool {
        if sig.len() < 1 + NONCE_LEN + 1 || sig.len() > FALCON512_SIG_MAX_LEN {
            return false;
        }
        let nonce = &sig[1..1 + NONCE_LEN];
        let comp = &sig[1 + NONCE_LEN..];
        let mut s2 = [0i16; N];
        if sig[0] != 0x39 {
            return false;
        }
        match comp_decode(comp, &mut s2) {
            Some(used) if used == comp.len() => {}
            // padded form: exactly 666 bytes, zero-only tail
            Some(used) if sig.len() == PADDED_SIG_LEN_512 && comp[used..].iter().all(|&b| b == 0) => {}
            _ => return false,
        }

        // c = HashToPoint(nonce || msg)
        let mut c = [0u16; N];
        hash_to_point_r3(nonce, msg, &mut c);

        // s1 = c - s2 * h  (mod q)
        let mut t = [0u16; N];
        mq::mqpoly_signed_to_ext(LOGN, &s2, &mut t);
        mq::mqpoly_ext_to_int(LOGN, &mut t);
        mq::mqpoly_int_to_NTT(LOGN, &mut t);
        mq::mqpoly_mul_ntt(LOGN, &mut t, &self.h_ntt);
        mq::mqpoly_NTT_to_int(LOGN, &mut t);
        mq::mqpoly_ext_to_int(LOGN, &mut c);
        mq::mqpoly_sub_int(LOGN, &mut c, &t);
        mq::mqpoly_int_to_ext(LOGN, &mut c);

        // ||(s1, s2)||^2 <= floor(beta^2)
        let mut norm: u64 = 0;
        for i in 0..N {
            let mut w = c[i] as i64;
            if w > (Q as i64 >> 1) {
                w -= Q as i64;
            }
            norm += (w * w) as u64;
            let v = s2[i] as i64;
            norm += (v * v) as u64;
        }
        norm <= L2BOUND_512
    }
}

pub fn verify(pk: &[u8], msg: &[u8], sig: &[u8]) -> Result<bool, VerifyError> {
    let pk = PublicKey::decode(pk)?;
    Ok(pk.verify(msg, sig))
}

/// Round-3 hash-to-point (vartime; the message is public on-chain anyway):
/// SHAKE256(nonce || msg), read 16-bit big-endian words, reject >= 5q, reduce mod q.
fn hash_to_point_r3(nonce: &[u8], msg: &[u8], c: &mut [u16; N]) {
    let mut sh = SHAKE256::new();
    sh.inject(nonce);
    sh.inject(msg);
    sh.flip();
    let mut i = 0;
    // extract in 136-byte chunks (one keccak-f per rate block) instead of 2 bytes at a time
    let mut buf = [0u8; 136];
    while i < N {
        sh.extract(&mut buf);
        let mut k = 0;
        while k < buf.len() && i < N {
            let w = ((buf[k] as u32) << 8) | (buf[k + 1] as u32);
            k += 2;
            if w < 61445 {
                c[i] = (w % Q) as u16;
                i += 1;
            }
        }
    }
}

/// Round-3 `comp_decode`: returns the number of bytes consumed, or `None` on invalid
/// encoding (|coef| > 2047, "-0", truncated input, non-zero unused bits in the last byte).
fn comp_decode(buf: &[u8], x: &mut [i16; N]) -> Option<usize> {
    let mut acc: u32 = 0;
    let mut acc_len: u32 = 0;
    let mut v = 0usize;
    for u in 0..N {
        if v >= buf.len() {
            return None;
        }
        acc = (acc << 8) | buf[v] as u32;
        v += 1;
        let b = acc >> acc_len;
        let s = b & 128;
        let mut m = b & 127;
        loop {
            if acc_len == 0 {
                if v >= buf.len() {
                    return None;
                }
                acc = (acc << 8) | buf[v] as u32;
                v += 1;
                acc_len = 8;
            }
            acc_len -= 1;
            if ((acc >> acc_len) & 1) != 0 {
                break;
            }
            m += 128;
            if m > 2047 {
                return None;
            }
        }
        if s != 0 && m == 0 {
            return None;
        }
        x[u] = if s != 0 { -(m as i32) as i16 } else { m as i16 };
    }
    if acc_len > 0 && (acc & ((1u32 << acc_len) - 1)) != 0 {
        return None;
    }
    Some(v)
}
