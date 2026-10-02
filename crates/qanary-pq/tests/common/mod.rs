#![allow(dead_code)]
use std::path::PathBuf;

pub fn vectors_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../vectors")
}

pub fn read_hex(rel: &str) -> Vec<u8> {
    let s = std::fs::read_to_string(vectors_dir().join(rel)).unwrap();
    hex::decode(s.trim()).unwrap()
}

/// Reads `vectors/<name>.pk`, `<name>.msg` and `<name>.sig` (hex, one value per file)
/// and returns their decoded bytes as `(pk, msg, sig)`.
pub fn fixture(name: &str) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let pk = read_hex(&format!("{name}.pk"));
    let msg = read_hex(&format!("{name}.msg"));
    let sig = read_hex(&format!("{name}.sig"));
    (pk, msg, sig)
}

/// Tiny deterministic xorshift for fuzz-ish inputs (no rand dependency needed).
pub struct XorShift(pub u64);
impl XorShift {
    pub fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    pub fn bytes(&mut self, n: usize) -> Vec<u8> {
        (0..n).map(|_| self.next() as u8).collect()
    }
}

/// Run `f` and assert it doesn't panic (a panic in Stylus = trap = revert without data).
pub fn no_panic<T>(f: impl FnOnce() -> T + std::panic::UnwindSafe) -> T {
    match std::panic::catch_unwind(f) {
        Ok(v) => v,
        Err(_) => panic!("verifier panicked on malformed input"),
    }
}

/// Generates an FN-DSA-512 keypair (`(signing_key, verifying_key)` bytes).
pub fn fndsa_keypair() -> (Vec<u8>, Vec<u8>) {
    use fn_dsa::{sign_key_size, vrfy_key_size, KeyPairGenerator, KeyPairGenerator512, FN_DSA_LOGN_512};
    use rand_core::OsRng;
    let mut kg = KeyPairGenerator512::default();
    let mut sk = vec![0u8; sign_key_size(FN_DSA_LOGN_512)];
    let mut vk = vec![0u8; vrfy_key_size(FN_DSA_LOGN_512)];
    kg.keygen(FN_DSA_LOGN_512, &mut OsRng, &mut sk, &mut vk);
    (sk, vk)
}

/// Signs `msg` with an FN-DSA-512 signing key, empty domain context, `HASH_ID_RAW`
/// (matching what `qanary_pq::fndsa512_verify` expects).
pub fn fndsa_sign(sk: &[u8], msg: &[u8]) -> Vec<u8> {
    use fn_dsa::{signature_size, SigningKey, SigningKey512, DOMAIN_NONE, FN_DSA_LOGN_512, HASH_ID_RAW};
    use rand_core::OsRng;
    let mut sk = SigningKey512::decode(sk).unwrap();
    let mut sig = vec![0u8; signature_size(FN_DSA_LOGN_512)];
    sk.sign(&mut OsRng, &DOMAIN_NONE, &HASH_ID_RAW, msg, &mut sig).unwrap();
    sig
}
