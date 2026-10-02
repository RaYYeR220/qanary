//! Jacobian-coordinate point arithmetic for `a = -3` short Weierstrass curves.
//!
//! `(X, Y, Z)` represents the affine point `(X/Z^2, Y/Z^3)`; `Z = 0` is the point at
//! infinity. Formulas are variable-time (verification only handles public data).

use crate::field::{invert, is_zero, Fe, Field};
use crypto_bigint::U256;

#[derive(Clone, Copy)]
pub(crate) struct Point {
    x: Fe,
    y: Fe,
    z: Fe,
}

impl Point {
    pub(crate) fn infinity(fp: &Field) -> Self {
        Self {
            x: fp.one(),
            y: fp.one(),
            z: fp.zero(),
        }
    }

    pub(crate) fn from_affine(fp: &Field, x: Fe, y: Fe) -> Self {
        Self { x, y, z: fp.one() }
    }

    pub(crate) fn is_infinity(&self) -> bool {
        is_zero(&self.z)
    }

    /// Affine x-coordinate as an integer in `[0, p)`; `None` for infinity.
    pub(crate) fn affine_x(&self) -> Option<U256> {
        let zinv = invert(&self.z)?;
        Some((self.x * zinv.square()).retrieve())
    }

    /// Doubling with `a = -3` ("dbl-2001-b"). Infinity and 2-torsion map to infinity
    /// because `Z3 = 2*Y*Z`.
    pub(crate) fn double(&self) -> Self {
        let delta = self.z.square();
        let gamma = self.y.square();
        let beta = self.x * gamma;
        let t = (self.x - delta) * (self.x + delta);
        let alpha = t.double() + t; // 3 (X - delta)(X + delta) = 3X^2 + a Z^4 with a = -3
        let beta4 = beta.double().double();
        let x3 = alpha.square() - beta4.double();
        let z3 = (self.y + self.z).square() - gamma - delta;
        let gamma2_8 = gamma.square().double().double().double();
        let y3 = alpha * (beta4 - x3) - gamma2_8;
        Self {
            x: x3,
            y: y3,
            z: z3,
        }
    }

    /// Complete addition: handles infinity, `P == Q` and `P == -Q`.
    pub(crate) fn add(&self, other: &Self) -> Self {
        if self.is_infinity() {
            return *other;
        }
        if other.is_infinity() {
            return *self;
        }
        let z1z1 = self.z.square();
        let z2z2 = other.z.square();
        let u1 = self.x * z2z2;
        let u2 = other.x * z1z1;
        let s1 = self.y * other.z * z2z2;
        let s2 = other.y * self.z * z1z1;
        let h = u2 - u1;
        let r = s2 - s1;
        if is_zero(&h) {
            return if is_zero(&r) {
                self.double()
            } else {
                // P == -Q: infinity (h is zero).
                Self {
                    x: self.x,
                    y: self.y,
                    z: h,
                }
            };
        }
        let hh = h.square();
        let hhh = h * hh;
        let v = u1 * hh;
        let x3 = r.square() - hhh - v.double();
        let y3 = r * (v - x3) - s1 * hhh;
        let z3 = self.z * other.z * h;
        Self {
            x: x3,
            y: y3,
            z: z3,
        }
    }
}

/// `u1*G + u2*Q` by Shamir's trick, scanning `bits` bits from the most significant one.
/// `bits` must cover both scalars (they are reduced mod `n`, so `bitlen(n)` does).
pub(crate) fn mul_add(fp: &Field, u1: &U256, g: &Point, u2: &U256, q: &Point, bits: u32) -> Point {
    let gq = g.add(q);
    let mut acc = Point::infinity(fp);
    for i in (0..bits.min(U256::BITS)).rev() {
        acc = acc.double();
        match (u1.bit_vartime(i), u2.bit_vartime(i)) {
            (true, true) => acc = acc.add(&gq),
            (true, false) => acc = acc.add(g),
            (false, true) => acc = acc.add(q),
            (false, false) => {}
        }
    }
    acc
}
