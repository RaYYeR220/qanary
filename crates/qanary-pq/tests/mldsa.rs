//! ML-DSA-44/65 against NIST ACVP sigVer vectors, seed-derived negative controls,
//! and scheme dispatch.
mod common;
use common::*;
use qanary_pq::*;
use serde_json::Value;

fn h(v: &Value) -> Vec<u8> {
    hex::decode(v.as_str().unwrap()).unwrap()
}

type CtxVerify = fn(&[u8], &[u8], &[u8], &[u8]) -> Result<bool, VerifyError>;

/// Runs every vector in the file (any context) and requires the result to equal `testPassed`.
fn run_acvp_sigver(path: std::path::PathBuf, verify: CtxVerify) {
    let d: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let tests = d["tests"].as_array().unwrap();
    let (mut processed, mut pass, mut fail) = (0usize, 0usize, 0usize);
    for t in tests {
        let (pk, msg, ctx, sig) = (h(&t["pk"]), h(&t["message"]), h(&t["context"]), h(&t["signature"]));
        let expected = t["testPassed"].as_bool().unwrap();
        let got = no_panic(|| verify(&pk, &msg, &ctx, &sig)).unwrap_or(false);
        assert_eq!(got, expected, "tcId={}", t["tcId"]);
        processed += 1;
        if expected { pass += 1 } else { fail += 1 }
    }
    assert_eq!(processed, tests.len());
    println!("ACVP {}: total={processed} expected-pass={pass} expected-fail={fail}", path.display());
}

#[test]
fn acvp_sigver_mldsa44_pure() {
    run_acvp_sigver(vectors_dir().join("mldsa/sigver-44.json"), mldsa44_verify_ctx);
}

#[test]
fn acvp_sigver_mldsa65_pure() {
    run_acvp_sigver(vectors_dir().join("mldsa/sigver-65.json"), mldsa65_verify_ctx);
}

#[test]
fn context_too_long_rejected() {
    let (pk, msg, sig) = common::fixture("mldsa44");
    assert_eq!(mldsa44_verify_ctx(&pk, &msg, &[0u8; 256], &sig), Err(VerifyError::ContextTooLong));
    assert_eq!(mldsa44_verify_ctx(&pk, &msg, &[0u8; 255], &sig), Ok(false));
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
