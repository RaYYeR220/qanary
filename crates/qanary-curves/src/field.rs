//! Prime-field arithmetic in Montgomery form with a modulus chosen at runtime.
//!
//! One [`Field`] is built for the base field (mod `p`) and one for the scalar field
//! (mod `n`); elements of both are [`Fe`]s carrying their own parameters.

use crypto_bigint::{
    modular::{MontyForm, MontyParams},
    Odd, U256,
};

const LIMBS: usize = U256::LIMBS;

/// A field element in Montgomery form. Always fully reduced.
pub(crate) type Fe = MontyForm<LIMBS>;

/// A prime field `Z/mZ` for an odd prime `m < 2^256`.
#[derive(Clone, Copy)]
pub(crate) struct Field {
    params: MontyParams<LIMBS>,
    modulus: U256,
}

impl Field {
    /// `None` if `modulus` is even (never for the curve constants).
    pub(crate) fn new(modulus: &U256) -> Option<Self> {
        let odd: Option<Odd<U256>> = Odd::new(*modulus).into();
        Some(Self {
            params: MontyParams::new_vartime(odd?),
            modulus: *modulus,
        })
    }

    /// `v` as a field element if it is canonical (`v < m`).
    pub(crate) fn elem(&self, v: &U256) -> Option<Fe> {
        if v < &self.modulus {
            Some(Fe::new(v, self.params))
        } else {
            None
        }
    }

    /// `v mod m` as a field element.
    pub(crate) fn reduce(&self, v: &U256) -> Fe {
        // `MontyForm::new` maps any `v < 2^256` to `v * R mod m`, i.e. it reduces.
        Fe::new(v, self.params)
    }

    pub(crate) fn zero(&self) -> Fe {
        Fe::zero(self.params)
    }

    pub(crate) fn one(&self) -> Fe {
        Fe::one(self.params)
    }
}

pub(crate) fn is_zero(x: &Fe) -> bool {
    // Zero is zero in Montgomery form, and elements are kept fully reduced.
    x.as_montgomery() == &U256::ZERO
}

/// Multiplicative inverse; `None` for zero.
pub(crate) fn invert(x: &Fe) -> Option<Fe> {
    x.inv_vartime().into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arithmetic_roundtrips() {
        let f = Field::new(&U256::from_u64(1_000_003)).unwrap();
        let a = f.elem(&U256::from_u64(123_456)).unwrap();
        let inv = invert(&a).unwrap();
        assert_eq!((a * inv).retrieve(), U256::ONE);
        assert!(invert(&f.zero()).is_none());
        assert!(is_zero(&(a - a)));
        assert!(!is_zero(&f.one()));
        assert!(f.elem(&U256::from_u64(1_000_003)).is_none());
        assert_eq!(f.reduce(&U256::from_u64(1_000_004)).retrieve(), U256::ONE);
        assert_eq!(
            f.reduce(&U256::MAX).retrieve(),
            U256::MAX.rem_vartime(&U256::from_u64(1_000_003).to_nz().unwrap())
        );
        assert!(Field::new(&U256::from_u64(10)).is_none());
    }
}
