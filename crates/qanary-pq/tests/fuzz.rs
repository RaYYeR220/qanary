//! Property-based robustness checks (arbitrary/garbage inputs, single-byte mutation of a
//! valid signature) and a differential check against an independent ML-DSA implementation.
mod common;
use common::*;
use ml_dsa::{ExpandedSigningKey as SigningKey, MlDsa44, B32};
use proptest::collection::vec as pvec;
use proptest::prelude::*;
use qanary_pq::*;

// ---------------------------------------------------------------- arbitrary-input fuzzing

macro_rules! fuzz_never_accepts_garbage {
    ($name:ident, $verify:expr) => {
        proptest! {
            #![proptest_config(ProptestConfig { cases: 256, failure_persistence: None, ..ProptestConfig::default() })]
            #[test]
            fn $name(
                pk in pvec(any::<u8>(), 0..4000),
                msg in pvec(any::<u8>(), 0..4000),
                sig in pvec(any::<u8>(), 0..4000),
            ) {
                let f: fn(&[u8], &[u8], &[u8]) -> Result<bool, VerifyError> = $verify;
                let got = no_panic(|| f(&pk, &msg, &sig));
                prop_assert_ne!(got, Ok(true));
            }
        }
    };
}

fuzz_never_accepts_garbage!(fuzz_mldsa44_never_accepts_garbage, mldsa44_verify);
fuzz_never_accepts_garbage!(fuzz_mldsa65_never_accepts_garbage, mldsa65_verify);
fuzz_never_accepts_garbage!(fuzz_falcon512_never_accepts_garbage, falcon512_verify);
fuzz_never_accepts_garbage!(fuzz_fndsa512_never_accepts_garbage, fndsa512_verify);

// ---------------------------------------------------------------- single-byte mutation

/// Flips one byte of a known-valid signature at 256 sampled positions; none of them
/// should turn an invalid signature into an accepted one.
fn mutate_sig_never_accepts(
    verify: fn(&[u8], &[u8], &[u8]) -> Result<bool, VerifyError>,
    pk: &[u8],
    msg: &[u8],
    sig: &[u8],
) {
    assert_eq!(no_panic(|| verify(pk, msg, sig)), Ok(true), "fixture must be valid before mutation");
    let mut rng = XorShift(0xA5A5_1234);
    for _ in 0..256 {
        let pos = (rng.next() as usize) % sig.len();
        let mut s = sig.to_vec();
        s[pos] ^= 1 << (rng.next() % 8);
        let got = no_panic(|| verify(pk, msg, &s));
        assert_ne!(got, Ok(true), "position {pos}");
    }
}

#[test]
fn mutate_mldsa44_sig_never_accepts() {
    let (pk, msg, sig) = common::fixture("mldsa44");
    mutate_sig_never_accepts(mldsa44_verify, &pk, &msg, &sig);
}

#[test]
fn mutate_mldsa65_sig_never_accepts() {
    let (pk, msg, sig) = common::fixture("mldsa65");
    mutate_sig_never_accepts(mldsa65_verify, &pk, &msg, &sig);
}

#[test]
fn mutate_falcon512_sig_never_accepts() {
    let (pk, msg, sig) = common::fixture("falcon512_devsign");
    mutate_sig_never_accepts(falcon512_verify, &pk, &msg, &sig);
}

#[test]
fn mutate_fndsa512_sig_never_accepts() {
    let (sk, vk) = fndsa_keypair();
    let msg = b"mutation target".to_vec();
    let sig = fndsa_sign(&sk, &msg);
    mutate_sig_never_accepts(fndsa512_verify, &vk, &msg, &sig);
}

// ---------------------------------------------------------------- differential (ml-dsa vs fips204)

/// For 50 seed-derived keys, a signature produced by the independent RustCrypto `ml-dsa`
/// implementation must verify through our fips204-backed `mldsa44_verify`.
#[test]
fn differential_ml_dsa_signature_verifies_with_fips204_backend() {
    let mut rng = XorShift(0x5EED);
    let mut ok = 0;
    for i in 0..50u8 {
        let mut seed = [0u8; 32];
        seed[0] = i;
        for b in seed.iter_mut().skip(1) {
            *b = rng.next() as u8;
        }
        let sk = SigningKey::<MlDsa44>::from_seed(&B32::from(seed));
        let pk = sk.verifying_key().encode();
        let msg = rng.bytes(32);
        let sig = sk.sign_deterministic(&msg, b"").unwrap().encode();
        assert_eq!(mldsa44_verify(&pk, &msg, &sig), Ok(true), "seed {i}");
        ok += 1;
    }
    println!("differential ml-dsa -> fips204 verified = {ok}/50");
    assert_eq!(ok, 50);
}

/// A devsign (noble `@noble/post-quantum`) signature must also verify.
#[test]
fn differential_devsign_signature_verifies_with_fips204_backend() {
    let (pk, msg, sig) = common::fixture("mldsa44_devsign");
    assert_eq!(mldsa44_verify(&pk, &msg, &sig), Ok(true));
}
