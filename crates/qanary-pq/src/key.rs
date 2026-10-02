//! Parsing for the two shapes an ERC-7913 key can take: a raw 20-byte pointer to a
//! registry contract holding the actual key material, or an inline `scheme || pk` blob.

use crate::VerifyError;

/// A parsed ERC-7913 key.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeyRef<'a> {
    /// A 20-byte address pointing at a contract that stores the real key.
    Pointer([u8; 20]),
    /// The key encoded inline as `scheme (1 byte) || pk (remaining bytes)`.
    Inline { scheme: u8, pk: &'a [u8] },
}

/// Classifies a raw ERC-7913 key by length: exactly 20 bytes is a `Pointer`, an empty
/// key is rejected, anything else is `Inline` (first byte is the scheme id).
pub fn parse_key(key: &[u8]) -> Result<KeyRef<'_>, VerifyError> {
    if key.is_empty() {
        return Err(VerifyError::KeyLength { expected: 1, got: 0 });
    }
    if key.len() == 20 {
        let mut ptr = [0u8; 20];
        ptr.copy_from_slice(key);
        return Ok(KeyRef::Pointer(ptr));
    }
    Ok(KeyRef::Inline { scheme: key[0], pk: &key[1..] })
}

/// Decodes the bytecode read back from a pointer contract: a leading `0x00` stop byte
/// (so the data contract itself can never be executed) followed by the scheme id and
/// the inline key bytes. Returns `(scheme, pk)`.
pub fn parse_pointer_code(code: &[u8]) -> Result<(u8, &[u8]), VerifyError> {
    if code.len() < 2 || code[0] != 0x00 {
        return Err(VerifyError::KeyDecode);
    }
    Ok((code[1], &code[2..]))
}
