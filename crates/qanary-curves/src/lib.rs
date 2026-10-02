//! ECDSA signature verification over the quantum-canary ladder curves:
//! secp160r1, NIST P-192 and NIST P-224.
//!
//! `no_std`, allocation-free and panic-free on every input, for use inside an
//! Arbitrum Stylus contract. Not constant-time: it only verifies public data.

#![no_std]

pub mod curves;
mod field;
mod point;

use crypto_bigint::U256;
use curves::CurveParams;
use field::{invert, Field};
use point::{mul_add, Point};

/// A ladder curve. The discriminant is the on-chain curve id.
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Curve {
    Secp160r1 = 1,
    P192 = 2,
    P224 = 3,
}

impl Curve {
    /// Curve for an on-chain id; `None` for unknown ids.
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            1 => Some(Self::Secp160r1),
            2 => Some(Self::P192),
            3 => Some(Self::P224),
            _ => None,
        }
    }

    /// Domain parameters of the curve.
    pub fn params(self) -> &'static CurveParams {
        match self {
            Self::Secp160r1 => &curves::SECP160R1,
            Self::P192 => &curves::P192,
            Self::P224 => &curves::P224,
        }
    }
}

/// ECDSA verify per SEC1 §4.1.4: digest truncated to bitlen(n); r,s ∈ [1,n-1]; Q on curve, not infinity.
/// Coordinates/scalars are 32-byte big-endian, left-padded. Never panics.
pub fn ecdsa_verify(
    curve: Curve,
    qx: &[u8; 32],
    qy: &[u8; 32],
    digest: &[u8; 32],
    r: &[u8; 32],
    s: &[u8; 32],
) -> bool {
    verify(curve.params(), qx, qy, digest, r, s).unwrap_or(false)
}

fn verify(
    c: &CurveParams,
    qx: &[u8; 32],
    qy: &[u8; 32],
    digest: &[u8; 32],
    r: &[u8; 32],
    s: &[u8; 32],
) -> Option<bool> {
    let fp = Field::new(&c.p)?;
    let fn_ = Field::new(&c.n)?;

    // 1 <= r, s <= n - 1 (`elem` rejects values >= n).
    let r_int = U256::from_be_slice(r);
    let r = fn_.elem(&r_int)?;
    let s = fn_.elem(&U256::from_be_slice(s))?;
    let w = invert(&s)?; // `None` exactly when s == 0
    if r_int == U256::ZERO {
        return None;
    }

    // Q: canonical coordinates on the curve. The cofactor is 1, so it has order n;
    // (0, 0) is not on any of these curves (b != 0), which rules out that infinity encoding.
    let x = fp.elem(&U256::from_be_slice(qx))?;
    let y = fp.elem(&U256::from_be_slice(qy))?;
    let a = fp.elem(&c.a)?;
    let b = fp.elem(&c.b)?;
    if y.square() != x.square() * x + a * x + b {
        return None;
    }
    let q = Point::from_affine(&fp, x, y);
    let g = Point::from_affine(&fp, fp.elem(&c.gx)?, fp.elem(&c.gy)?);

    // e = leftmost nbits bits of the digest, reduced mod n.
    let shift = U256::BITS.checked_sub(c.nbits)?;
    let e = U256::from_be_slice(digest).overflowing_shr_vartime(shift);
    let e: Option<U256> = e.into();
    let e = fn_.reduce(&e?);

    let u1 = (e * w).retrieve();
    let u2 = (r * w).retrieve();
    let point = mul_add(&fp, &u1, &g, &u2, &q, c.nbits);
    if point.is_infinity() {
        return None;
    }
    // v = X.x mod n; X.x < p < 2^256 and p < 2n for all ladder curves, but reduce generally.
    let v = fn_.reduce(&point.affine_x()?);
    Some(v == r)
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    use std::{format, path::PathBuf};

    fn on_curve(c: &CurveParams, x: &U256, y: &U256) -> bool {
        let fp = Field::new(&c.p).unwrap();
        let (Some(x), Some(y)) = (fp.elem(x), fp.elem(y)) else {
            return false;
        };
        let (a, b) = (fp.elem(&c.a).unwrap(), fp.elem(&c.b).unwrap());
        y.square() == x.square() * x + a * x + b
    }

    fn u(v: &serde_json::Value) -> U256 {
        U256::from_be_hex(&v.as_str().unwrap()[2..])
    }

    #[test]
    fn generators_on_curve() {
        for c in [Curve::Secp160r1, Curve::P192, Curve::P224] {
            let p = c.params();
            assert!(on_curve(p, &p.gx, &p.gy), "{c:?}");
        }
    }

    #[test]
    fn n_times_g_is_infinity() {
        for c in [Curve::Secp160r1, Curve::P192, Curve::P224] {
            let p = c.params();
            let fp = Field::new(&p.p).unwrap();
            let g = Point::from_affine(&fp, fp.elem(&p.gx).unwrap(), fp.elem(&p.gy).unwrap());
            let inf = Point::infinity(&fp);
            let n_minus_1 = p.n.wrapping_sub(&U256::ONE);
            // (n-1)G + G = O and (n-1)G = -G.
            let a = mul_add(&fp, &n_minus_1, &g, &U256::ZERO, &inf, p.nbits);
            assert_eq!(a.affine_x(), Some(p.gx), "{c:?}");
            assert!(a.add(&g).is_infinity(), "{c:?}");
            assert!(
                mul_add(&fp, &n_minus_1, &g, &U256::ONE, &g, p.nbits).is_infinity(),
                "{c:?}"
            );
            // G + G == 2G via add vs double.
            assert_eq!(g.add(&g).affine_x(), g.double().affine_x(), "{c:?}");
        }
    }

    /// The NUMS and drill ladder points written by scripts/nums.py are on their curves.
    #[test]
    fn canary_targets_on_curve() {
        let path =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../deployments/canary-targets.json");
        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        for (c, name) in [
            (Curve::Secp160r1, "secp160r1"),
            (Curve::P192, "p192"),
            (Curve::P224, "p224"),
        ] {
            for set in ["nums", "drill"] {
                let pt = &json[set][name];
                assert!(
                    on_curve(c.params(), &u(&pt["x"]), &u(&pt["y"])),
                    "{}",
                    format!("{set} {name}")
                );
            }
        }
    }
}
