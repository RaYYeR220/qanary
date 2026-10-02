use qanary_pq::*;

#[test]
fn twenty_bytes_is_pointer() {
    assert!(matches!(parse_key(&[7u8; 20]), Ok(KeyRef::Pointer(_))));
}

#[test]
fn inline_splits_scheme() {
    let mut k = vec![2u8];
    k.extend([9u8; 1312]);
    match parse_key(&k).unwrap() {
        KeyRef::Inline { scheme, pk } => {
            assert_eq!(scheme, 2);
            assert_eq!(pk.len(), 1312)
        }
        _ => panic!(),
    }
}

#[test]
fn empty_key_rejected() {
    assert!(matches!(parse_key(&[]), Err(VerifyError::KeyLength { .. })));
}

#[test]
fn pointer_code_needs_stop_prefix() {
    assert_eq!(parse_pointer_code(&[0x00, 2, 1, 2, 3]).unwrap().0, 2);
    assert_eq!(parse_pointer_code(&[0x60, 2, 1]), Err(VerifyError::KeyDecode));
    assert_eq!(parse_pointer_code(&[0x00]), Err(VerifyError::KeyDecode));
    assert_eq!(parse_pointer_code(&[]), Err(VerifyError::KeyDecode));
}
