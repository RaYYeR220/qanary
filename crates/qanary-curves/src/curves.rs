//! Domain parameters of the canary ladder curves.
//!
//! All three are short Weierstrass curves `y^2 = x^3 + a*x + b` over a prime field with
//! `a = p - 3` and cofactor 1, so every on-curve point other than infinity has order `n`.

use crypto_bigint::U256;

/// Domain parameters of one curve. Values are reduced, `p` and `n` are odd primes.
#[derive(Clone, Copy, Debug)]
pub struct CurveParams {
    pub p: U256,
    pub a: U256,
    pub b: U256,
    pub n: U256,
    pub gx: U256,
    pub gy: U256,
    /// Bit length of `n`; the digest is truncated to this many leftmost bits.
    pub nbits: u32,
}

/// secp160r1, SEC 2 (v1) §2.4.2. Note `n > p` (161-bit order).
pub const SECP160R1: CurveParams = CurveParams {
    p: U256::from_be_hex("000000000000000000000000ffffffffffffffffffffffffffffffff7fffffff"),
    a: U256::from_be_hex("000000000000000000000000ffffffffffffffffffffffffffffffff7ffffffc"),
    b: U256::from_be_hex("0000000000000000000000001c97befc54bd7a8b65acf89f81d4d4adc565fa45"),
    n: U256::from_be_hex("00000000000000000000000100000000000000000001f4c8f927aed3ca752257"),
    gx: U256::from_be_hex("0000000000000000000000004a96b5688ef573284664698968c38bb913cbfc82"),
    gy: U256::from_be_hex("00000000000000000000000023a628553168947d59dcc912042351377ac5fb32"),
    nbits: 161,
};

/// NIST P-192 (secp192r1), FIPS 186-4 §D.1.2.1.
pub const P192: CurveParams = CurveParams {
    p: U256::from_be_hex("0000000000000000fffffffffffffffffffffffffffffffeffffffffffffffff"),
    a: U256::from_be_hex("0000000000000000fffffffffffffffffffffffffffffffefffffffffffffffc"),
    b: U256::from_be_hex("000000000000000064210519e59c80e70fa7e9ab72243049feb8deecc146b9b1"),
    n: U256::from_be_hex("0000000000000000ffffffffffffffffffffffff99def836146bc9b1b4d22831"),
    gx: U256::from_be_hex("0000000000000000188da80eb03090f67cbf20eb43a18800f4ff0afd82ff1012"),
    gy: U256::from_be_hex("000000000000000007192b95ffc8da78631011ed6b24cdd573f977a11e794811"),
    nbits: 192,
};

/// NIST P-224 (secp224r1), FIPS 186-4 §D.1.2.2.
pub const P224: CurveParams = CurveParams {
    p: U256::from_be_hex("00000000ffffffffffffffffffffffffffffffff000000000000000000000001"),
    a: U256::from_be_hex("00000000fffffffffffffffffffffffffffffffefffffffffffffffffffffffe"),
    b: U256::from_be_hex("00000000b4050a850c04b3abf54132565044b0b7d7bfd8ba270b39432355ffb4"),
    n: U256::from_be_hex("00000000ffffffffffffffffffffffffffff16a2e0b8f03e13dd29455c5c2a3d"),
    gx: U256::from_be_hex("00000000b70e0cbd6bb4bf7f321390b94a03c1d356c21122343280d6115c1d21"),
    gy: U256::from_be_hex("00000000bd376388b5f723fb4c22dfe6cd4375a05a07476444d5819985007e34"),
    nbits: 224,
};

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    use std::{format, path::PathBuf, string::String};

    /// Hex of a U256 as the vector files print it.
    fn hx(v: &U256) -> String {
        let mut s = String::from("0x");
        for b in v.to_be_bytes() {
            s.push_str(&format!("{b:02x}"));
        }
        s
    }

    /// The constants above, copied from the standards, equal python-ecdsa's
    /// (exported by scripts/gen_ladder_vectors.py into vectors/ladder/*.json).
    #[test]
    fn params_match_python_ecdsa() {
        for (name, c) in [("secp160r1", SECP160R1), ("p192", P192), ("p224", P224)] {
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join(format!("../../vectors/ladder/{name}.json"));
            let json: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
            let p = &json["params"];
            for (field, v) in [
                ("p", c.p),
                ("a", c.a),
                ("b", c.b),
                ("n", c.n),
                ("gx", c.gx),
                ("gy", c.gy),
            ] {
                assert_eq!(p[field].as_str().unwrap(), hx(&v), "{name}.{field}");
            }
            assert_eq!(c.nbits, c.n.bits_vartime(), "{name}.nbits");
            assert_eq!(
                c.a,
                c.p.wrapping_sub(&U256::from_u8(3)),
                "{name}: a = p - 3"
            );
        }
    }
}
