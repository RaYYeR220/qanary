//! ML-DSA-44/65 against NIST ACVP sigVer vectors, seed-derived negative controls,
//! and scheme dispatch.
mod common;
use common::*;
use qanary_pq::*;
use serde_json::Value;

fn h(v: &Value) -> Vec<u8> {
    hex::decode(v.as_str().unwrap()).unwrap()
}

/// `mldsa44_verify` / `mldsa65_verify` take no context argument (it is fixed to the
/// empty string), so an ACVP vector only predicts our result directly when its own
/// `context` field is also empty; a vector signed under a non-empty context is
/// expected to fail through this crate's API regardless of its original `testPassed`.
fn run_acvp_sigver(path: std::path::PathBuf, verify: fn(&[u8], &[u8], &[u8]) -> Result<bool, VerifyError>) {
    let d: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let tests = d["tests"].as_array().unwrap();
    let mut processed = 0usize;
    for t in tests {
        let pk = h(&t["pk"]);
        let msg = h(&t["message"]);
        let sig = h(&t["signature"]);
        let ctx_empty = t["context"].as_str().unwrap_or("").is_empty();
        let expect_true = ctx_empty && t["testPassed"].as_bool().unwrap();
        let got = no_panic(|| verify(&pk, &msg, &sig)).unwrap_or(false);
        assert_eq!(got, expect_true, "tcId={}", t["tcId"]);
        processed += 1;
    }
    assert_eq!(processed, tests.len());
}

#[test]
fn acvp_sigver_mldsa44_pure() {
    run_acvp_sigver(vectors_dir().join("mldsa/sigver-44.json"), mldsa44_verify);
}

#[test]
fn acvp_sigver_mldsa65_pure() {
    run_acvp_sigver(vectors_dir().join("mldsa/sigver-65.json"), mldsa65_verify);
}

#[test]
fn mldsa44_negative_controls() {
    let (pk, msg, sig) = common::fixture("mldsa44");
    assert_eq!(mldsa44_verify(&pk, &msg, &sig), Ok(true));
    let mut s = sig.clone();
    s[100] ^= 1;
    assert_eq!(mldsa44_verify(&pk, &msg, &s), Ok(false));
    let mut m = msg.clone();
    m[0] ^= 1;
    assert_eq!(mldsa44_verify(&pk, &m, &sig), Ok(false));
    let mut p = pk.clone();
    p[40] ^= 1;
    assert_eq!(mldsa44_verify(&p, &msg, &sig), Ok(false));
    assert!(matches!(mldsa44_verify(&pk, &msg, &sig[..2419]), Err(VerifyError::SigLength { .. })));
    assert!(matches!(mldsa44_verify(&pk[..1311], &msg, &sig), Err(VerifyError::KeyLength { .. })));
}

#[test]
fn mldsa65_negative_controls() {
    let (pk, msg, sig) = common::fixture("mldsa65");
    assert_eq!(mldsa65_verify(&pk, &msg, &sig), Ok(true));
    let mut s = sig.clone();
    s[100] ^= 1;
    assert_eq!(mldsa65_verify(&pk, &msg, &s), Ok(false));
    let mut m = msg.clone();
    m[0] ^= 1;
    assert_eq!(mldsa65_verify(&pk, &m, &sig), Ok(false));
    let mut p = pk.clone();
    p[40] ^= 1;
    assert_eq!(mldsa65_verify(&p, &msg, &sig), Ok(false));
    assert!(matches!(mldsa65_verify(&pk, &msg, &sig[..3308]), Err(VerifyError::SigLength { .. })));
    assert!(matches!(mldsa65_verify(&pk[..1951], &msg, &sig), Err(VerifyError::KeyLength { .. })));
}

#[test]
fn scheme_dispatch_matches_direct_calls() {
    let (pk44, msg44, sig44) = common::fixture("mldsa44");
    assert_eq!(verify(Scheme::MlDsa44, &pk44, &msg44, &sig44), mldsa44_verify(&pk44, &msg44, &sig44));
    let (pk65, msg65, sig65) = common::fixture("mldsa65");
    assert_eq!(verify(Scheme::MlDsa65, &pk65, &msg65, &sig65), mldsa65_verify(&pk65, &msg65, &sig65));
    let (pkf, msgf, sigf) = common::fixture("falcon512_devsign");
    assert_eq!(verify(Scheme::Falcon512, &pkf, &msgf, &sigf), falcon512_verify(&pkf, &msgf, &sigf));
    let vk = common::read_hex("fndsa/kat_512_vk.hex");
    let sig = common::read_hex("fndsa/kat_512_sig.hex");
    assert_eq!(verify(Scheme::FnDsa512, &vk, b"message", &sig), fndsa512_verify(&vk, b"message", &sig));
}
