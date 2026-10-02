//! Stylus ladder verifier: ECDSA over secp160r1 / P-192 / P-224.
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
extern crate alloc;

use qanary_curves::{ecdsa_verify, Curve};
use stylus_sdk::alloy_primitives::FixedBytes;
use stylus_sdk::alloy_sol_types::sol;
use stylus_sdk::prelude::*;

sol! {
    error UnknownCurve(uint8 curve);
}

#[derive(SolidityError)]
pub enum LadderError {
    UnknownCurve(UnknownCurve),
}

#[storage]
#[entrypoint]
pub struct LadderVerifier {}

#[public]
impl LadderVerifier {
    /// curve: 1 = secp160r1, 2 = P-192, 3 = P-224. Returns false for any invalid signature/point/range.
    pub fn verify(
        &self,
        curve: u8,
        qx: FixedBytes<32>,
        qy: FixedBytes<32>,
        digest: FixedBytes<32>,
        r: FixedBytes<32>,
        s: FixedBytes<32>,
    ) -> Result<bool, LadderError> {
        let c = Curve::from_u8(curve).ok_or(LadderError::UnknownCurve(UnknownCurve { curve }))?;
        Ok(ecdsa_verify(c, &qx.0, &qy.0, &digest.0, &r.0, &s.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use stylus_test::TestVM;

    fn b32(s: &str) -> FixedBytes<32> {
        let mut out = [0u8; 32];
        let h = s.trim_start_matches("0x");
        for i in 0..32 {
            out[i] = u8::from_str_radix(&h[2 * i..2 * i + 2], 16).unwrap();
        }
        FixedBytes(out)
    }
    fn first_valid(file: &str) -> [FixedBytes<32>; 5] {
        let v: serde_json::Value = serde_json::from_str(file).unwrap();
        let x = v["vectors"].as_array().unwrap().iter().find(|x| x["valid"] == true).unwrap();
        ["qx", "qy", "digest", "r", "s"].map(|k| b32(x[k].as_str().unwrap()))
    }
    fn vecs() -> [(u8, [FixedBytes<32>; 5]); 3] {
        [
            (1, first_valid(include_str!("../../../../vectors/ladder/secp160r1.json"))),
            (2, first_valid(include_str!("../../../../vectors/ladder/p192.json"))),
            (3, first_valid(include_str!("../../../../vectors/ladder/p224.json"))),
        ]
    }
    fn contract() -> (TestVM, LadderVerifier) {
        let vm = TestVM::default();
        let c = LadderVerifier::from(&vm);
        (vm, c)
    }

    #[test]
    fn valid_vectors_verify() {
        let (_vm, c) = contract();
        for (curve, [qx, qy, d, r, s]) in vecs() {
            assert_eq!(c.verify(curve, qx, qy, d, r, s).ok(), Some(true), "curve {curve}");
        }
    }

    #[test]
    fn tampered_s_fails() {
        let (_vm, c) = contract();
        for (curve, [qx, qy, d, r, mut s]) in vecs() {
            s.0[31] ^= 1;
            assert_eq!(c.verify(curve, qx, qy, d, r, s).ok(), Some(false), "curve {curve}");
        }
    }

    #[test]
    fn unknown_curve_reverts() {
        let (_vm, c) = contract();
        let [qx, qy, d, r, s] = vecs()[0].1;
        let e = c.verify(9, qx, qy, d, r, s);
        assert!(matches!(e, Err(LadderError::UnknownCurve(UnknownCurve { curve })) if curve == 9));
    }

    #[test]
    fn zero_r_is_false() {
        let (_vm, c) = contract();
        for (curve, [qx, qy, d, _r, s]) in vecs() {
            assert_eq!(c.verify(curve, qx, qy, d, FixedBytes::ZERO, s).ok(), Some(false), "curve {curve}");
        }
    }
}
