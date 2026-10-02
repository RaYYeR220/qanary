//! Stylus ERC-7913 verifier (falcon512-verifier)
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
extern crate alloc;

include!("../../common/abi.rs");

const SCHEMES: &[u8] = &[1, 4];

fn dispatch(scheme: u8, pk: &[u8], msg: &[u8], sig: &[u8]) -> Result<bool, qanary_pq::VerifyError> {
    match scheme {
        1 => qanary_pq::fndsa512_verify(pk, msg, sig),
        4 => qanary_pq::falcon512_verify(pk, msg, sig),
        _ => Err(qanary_pq::VerifyError::UnsupportedScheme),
    }
}

include!("../../common/contract.rs");

#[cfg(test)]
mod tests {
    use super::*;
    use stylus_test::TestVM;

    const SCHEME: u8 = 4;
    const WRONG_SCHEME: u8 = 3;

    fn hexf(s: &str) -> Vec<u8> {
        hex::decode(s.trim()).unwrap()
    }
    fn fixture() -> (Vec<u8>, FixedBytes<32>, Vec<u8>) {
        let pk = hexf(include_str!("../../../../vectors/falcon512_devsign.pk"));
        let msg = hexf(include_str!("../../../../vectors/falcon512_devsign.msg"));
        let sig = hexf(include_str!("../../../../vectors/falcon512_devsign.sig"));
        (pk, FixedBytes::<32>::from_slice(&msg), sig)
    }
    fn inline_key(scheme: u8, pk: &[u8]) -> Bytes {
        let mut k = vec![scheme];
        k.extend_from_slice(pk);
        k.into()
    }
    fn contract() -> (TestVM, PqVerifier) {
        let vm = TestVM::default();
        let c = PqVerifier::from(&vm);
        (vm, c)
    }

    #[test]
    fn valid_inline_returns_magic() {
        let (_vm, c) = contract();
        let (pk, h, sig) = fixture();
        let r = c.verify(inline_key(SCHEME, &pk), h, sig.into()).ok().unwrap();
        assert_eq!(r, ERC7913_MAGIC);
    }

    #[test]
    fn tampered_signature_returns_fail() {
        let (_vm, c) = contract();
        let (pk, h, mut sig) = fixture();
        let n = sig.len();
        sig[n / 2] ^= 0x01;
        let r = c.verify(inline_key(SCHEME, &pk), h, sig.into()).ok().unwrap();
        assert_eq!(r, ERC7913_FAIL);
    }

    #[test]
    fn wrong_hash_returns_fail() {
        let (_vm, c) = contract();
        let (pk, _h, sig) = fixture();
        let r = c.verify(inline_key(SCHEME, &pk), FixedBytes::<32>::ZERO, sig.into()).ok().unwrap();
        assert_eq!(r, ERC7913_FAIL);
    }

    #[test]
    fn wrong_scheme_is_unsupported() {
        let (_vm, c) = contract();
        let (pk, h, sig) = fixture();
        let r = c.verify(inline_key(WRONG_SCHEME, &pk), h, sig.into());
        assert!(matches!(
            r,
            Err(VerifierError::UnsupportedScheme(UnsupportedScheme { scheme })) if scheme == WRONG_SCHEME
        ));
    }

    #[test]
    fn empty_key_is_invalid_key_length() {
        let (_vm, c) = contract();
        let (_pk, h, sig) = fixture();
        let r = c.verify(Bytes::new(), h, sig.into());
        assert!(matches!(r, Err(VerifierError::InvalidKeyLength(_))));
    }

    #[test]
    fn wrong_pk_length_is_invalid_key_length() {
        let (_vm, c) = contract();
        let (pk, h, sig) = fixture();
        let r = c.verify(inline_key(SCHEME, &pk[..pk.len() - 1]), h, sig.into());
        assert!(matches!(r, Err(VerifierError::InvalidKeyLength(_))));
    }

    #[test]
    fn wrong_sig_length_is_invalid_signature_length() {
        // Round-3 Falcon-512 (scheme 4) signatures are variable length: a malformed one is a
        // well-formed-but-invalid signature (FAIL). The FN-DSA-512 path (scheme 1) is fixed length.
        let (_vm, c) = contract();
        let (pk, h, sig) = fixture();
        let r = c.verify(inline_key(SCHEME, &pk), h, sig[..sig.len() - 1].to_vec().into()).ok().unwrap();
        assert_eq!(r, ERC7913_FAIL);
        let r = c.verify(inline_key(1, &pk), h, sig[..sig.len() - 1].to_vec().into());
        assert!(matches!(r, Err(VerifierError::InvalidSignatureLength(_))));
    }

    #[test]
    fn schemes_lists_supported_ids() {
        let (_vm, c) = contract();
        assert_eq!(c.schemes(), vec![1, 4]);
    }

    fn ptr_key(a: Address) -> Bytes {
        a.as_slice().to_vec().into()
    }

    #[test]
    fn pointer_valid_returns_magic() {
        let (vm, c) = contract();
        let (pk, h, sig) = fixture();
        let a = Address::repeat_byte(0xAB);
        let mut code = vec![0x00, SCHEME];
        code.extend_from_slice(&pk);
        vm.set_code(a, code);
        let r = c.verify(ptr_key(a), h, sig.into()).ok().unwrap();
        assert_eq!(r, ERC7913_MAGIC);
    }

    #[test]
    fn pointer_to_empty_code_is_invalid_key() {
        let (_vm, c) = contract();
        let (_pk, h, sig) = fixture();
        let r = c.verify(ptr_key(Address::repeat_byte(0xCD)), h, sig.into());
        assert!(matches!(r, Err(VerifierError::InvalidKey(_))));
    }

    #[test]
    fn pointer_code_without_stop_prefix_is_invalid_key() {
        let (vm, c) = contract();
        let (pk, h, sig) = fixture();
        let a = Address::repeat_byte(0xEF);
        let mut code = vec![0x60, SCHEME];
        code.extend_from_slice(&pk);
        vm.set_code(a, code);
        let r = c.verify(ptr_key(a), h, sig.into());
        assert!(matches!(r, Err(VerifierError::InvalidKey(_))));
    }
}
