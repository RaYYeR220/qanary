//! Falcon-512 round-3 (NIST KAT, devsign fixture, negative controls) and FN-DSA-512
//! (upstream KAT, sign/verify round trips, negative controls).
mod common;
use common::*;
use qanary_pq::{falcon512_verify, falcon_r3, fndsa512_verify, fndsa512_verify_ctx, VerifyError};

// ---------------------------------------------------------------- Falcon-512 round-3

pub struct Kat {
    pub msg: Vec<u8>,
    pub pk: Vec<u8>,
    /// falcon.c compressed format: 0x29 || nonce || comp(s2)
    pub sig: Vec<u8>,
}

pub fn load_kats() -> Vec<Kat> {
    let txt = std::fs::read_to_string(vectors_dir().join("falcon-r3/falcon512-KAT.rsp")).unwrap();
    let mut out = vec![];
    let (mut msg, mut pk, mut mlen) = (vec![], vec![], 0usize);
    for line in txt.lines() {
        let Some((k, v)) = line.split_once(" = ") else { continue };
        match k {
            "mlen" => mlen = v.parse().unwrap(),
            "msg" => msg = hex::decode(v).unwrap(),
            "pk" => pk = hex::decode(v).unwrap(),
            "sm" => {
                // sm = sig_len(2, BE) || nonce(40) || msg(mlen) || esig(sig_len), esig[0] = 0x29
                let sm = hex::decode(v).unwrap();
                let sig_len = ((sm[0] as usize) << 8) | sm[1] as usize;
                let nonce = &sm[2..42];
                assert_eq!(&sm[42..42 + mlen], &msg[..]);
                let esig = &sm[42 + mlen..];
                assert_eq!(esig.len(), sig_len);
                assert_eq!(esig[0], 0x29);
                let mut sig = vec![0x29];
                sig.extend_from_slice(nonce);
                sig.extend_from_slice(&esig[1..]);
                out.push(Kat { msg: msg.clone(), pk: pk.clone(), sig });
            }
            _ => {}
        }
    }
    out
}

#[test]
fn falcon512_nist_round3_kat_100() {
    let kats = load_kats();
    assert_eq!(kats.len(), 100);
    let mut pass = 0;
    for (i, k) in kats.iter().enumerate() {
        assert_eq!(falcon_r3::verify(&k.pk, &k.msg, &k.sig), Ok(true), "KAT {i}");
        pass += 1;
        // padded format (0x39, 666 bytes) of the same signature must also verify
        if k.sig.len() <= 666 {
            let mut p = k.sig.clone();
            p[0] = 0x39;
            p.resize(666, 0);
            assert_eq!(falcon_r3::verify(&k.pk, &k.msg, &p), Ok(true), "KAT {i} padded");
        }
    }
    println!("falcon512 round-3 KAT pass = {pass}/100");
}

#[test]
fn falcon512_negative_controls() {
    let kats = load_kats();
    let mut neg = 0;
    for i in 0..kats.len() {
        let k = &kats[i];
        let other = &kats[(i + 1) % kats.len()];
        // wrong message
        let mut m = k.msg.clone();
        m[0] ^= 1;
        assert_eq!(falcon_r3::verify(&k.pk, &m, &k.sig), Ok(false));
        // wrong public key
        assert_eq!(falcon_r3::verify(&other.pk, &k.msg, &k.sig), Ok(false));
        // tampered nonce / body / trailing garbage / truncated
        for pos in [1usize, 30, 45, 300, k.sig.len() - 1] {
            let mut s = k.sig.clone();
            s[pos] ^= 0x10;
            assert_eq!(no_panic(|| falcon_r3::verify(&k.pk, &k.msg, &s)), Ok(false), "{i}/{pos}");
        }
        let mut s = k.sig.clone();
        s.push(0);
        assert_eq!(falcon_r3::verify(&k.pk, &k.msg, &s), Ok(false));
        let s = &k.sig[..k.sig.len() - 1];
        assert_eq!(falcon_r3::verify(&k.pk, &k.msg, s), Ok(false));
        neg += 9;
    }
    println!("falcon512 round-3 negative controls rejected = {neg}");
}

#[test]
fn falcon512_malformed_never_panic() {
    let mut rng = XorShift(99);
    let k = &load_kats()[0];
    for _ in 0..2000 {
        let len = (rng.next() % 900) as usize;
        let mut sig = rng.bytes(len);
        if !sig.is_empty() {
            sig[0] = if rng.next() & 1 == 0 { 0x29 } else { 0x39 };
        }
        let r = no_panic(|| falcon_r3::verify(&k.pk, &k.msg, &sig));
        assert_eq!(r, Ok(false));
        let mut pk = rng.bytes(897);
        pk[0] = 9;
        let r = no_panic(|| falcon_r3::verify(&pk, &k.msg, &k.sig));
        assert!(r != Ok(true));
    }
}

#[test]
fn falcon512_devsign_fixture_verifies() {
    let (pk, msg, sig) = common::fixture("falcon512_devsign");
    assert_eq!(sig.len(), 666, "devsign falcon fixture must be the padded round-3 format");
    assert_eq!(falcon512_verify(&pk, &msg, &sig), Ok(true));
    assert_eq!(falcon_r3::verify(&pk, &msg, &sig), Ok(true));
}

// ---------------------------------------------------------------- FN-DSA-512

#[test]
fn fndsa512_upstream_kat() {
    // Vector embedded in fn-dsa-vrfy 0.4.0 own test suite, signed over ctx="context", msg="message".
    let vk = read_hex("fndsa/kat_512_vk.hex");
    let sig = read_hex("fndsa/kat_512_sig.hex");
    assert_eq!(fndsa512_verify_ctx(&vk, b"message", b"context", &sig), Ok(true));
    // wrong message / wrong or empty context / tampered signature / bad lengths
    assert_eq!(fndsa512_verify_ctx(&vk, b"messagf", b"context", &sig), Ok(false));
    assert_eq!(fndsa512_verify_ctx(&vk, b"message", b"contexu", &sig), Ok(false));
    assert_eq!(fndsa512_verify(&vk, b"message", &sig), Ok(false));
    let mut bad = sig.clone();
    bad[100] ^= 1;
    assert_eq!(fndsa512_verify_ctx(&vk, b"message", b"context", &bad), Ok(false));
    assert!(matches!(fndsa512_verify_ctx(&vk[..vk.len() - 1], b"message", b"context", &sig), Err(VerifyError::KeyLength { .. })));
    assert_eq!(fndsa512_verify_ctx(&vk, b"message", &[0u8; 256], &sig), Err(VerifyError::ContextTooLong));
}

#[test]
fn fndsa512_roundtrip_and_negative_controls() {
    let mut rng = XorShift(0xF00D);
    let (mut ok, mut neg) = (0, 0);
    let (_, other_vk) = fndsa_keypair();
    for _ in 0..25 {
        let (sk, vk) = fndsa_keypair();
        let msg = rng.bytes(32); // a 32-byte hash, as in the ERC-7913 path
        let sig = fndsa_sign(&sk, &msg);
        assert_eq!(fndsa512_verify(&vk, &msg, &sig), Ok(true));
        ok += 1;
        // wrong message
        let mut m2 = msg.clone();
        m2[0] ^= 1;
        assert_eq!(fndsa512_verify(&vk, &m2, &sig), Ok(false));
        // wrong pk
        assert_eq!(fndsa512_verify(&other_vk, &msg, &sig), Ok(false));
        // tampered signature: nonce byte, body bytes, header
        for pos in [1usize, 20, 41, 200, 400, 665] {
            let mut s2 = sig.clone();
            s2[pos] ^= 0x04;
            assert_eq!(no_panic(|| fndsa512_verify(&vk, &msg, &s2)), Ok(false), "pos {pos}");
        }
        let mut s3 = sig.clone();
        s3[0] = 0x3a;
        assert_eq!(fndsa512_verify(&vk, &msg, &s3), Ok(false));
        neg += 9;
    }
    println!("fndsa512 roundtrip ok={ok} negative={neg}");
    assert_eq!(ok, 25);
}

#[test]
fn fndsa512_malformed_inputs_never_panic() {
    let mut rng = XorShift(7);
    let (_, vk) = fndsa_keypair();
    // lengths
    assert!(matches!(fndsa512_verify(&vk[..896], b"x", &[0u8; 666]), Err(VerifyError::KeyLength { .. })));
    assert!(matches!(fndsa512_verify(&vk, b"x", &[0u8; 665]), Err(VerifyError::SigLength { .. })));
    assert!(matches!(fndsa512_verify(&[], b"x", &[]), Err(VerifyError::KeyLength { .. })));
    // random garbage of correct length
    for _ in 0..500 {
        let mut pk = rng.bytes(897);
        pk[0] = 0x09;
        let sig = rng.bytes(666);
        let r = no_panic(|| fndsa512_verify(&pk, b"msg", &sig));
        assert!(matches!(r, Ok(false) | Err(VerifyError::KeyDecode)), "{r:?}");
        let mut sig2 = rng.bytes(666);
        sig2[0] = 0x39;
        let r = no_panic(|| fndsa512_verify(&vk, b"msg", &sig2));
        assert_eq!(r, Ok(false));
    }
}
