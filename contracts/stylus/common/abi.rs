// Shared ABI pieces, `include!`d by every verifier contract (each crate stays a single
// cdylib with its own #[entrypoint] without duplicating the error/interface glue).
//
// ERC-7913 `verify(bytes key, bytes32 hash, bytes signature) view returns (bytes4)`:
//   key = 20-byte pointer (code = 0x00 || scheme || pk)  OR  scheme (1 byte) || pk
//   returns 0x024ad318 on success, 0xffffffff on a well-formed but invalid signature,
//   reverts with a typed error on malformed key/signature lengths or key encoding.

use stylus_sdk::alloy_primitives::{FixedBytes, U256};
use stylus_sdk::alloy_sol_types::sol;
use stylus_sdk::prelude::*;

sol! {
    error InvalidKeyLength(uint256 expected, uint256 got);
    error InvalidSignatureLength(uint256 expected, uint256 got);
    error InvalidKey();
    error UnsupportedScheme(uint8 scheme);
}

#[derive(SolidityError)]
pub enum VerifierError {
    InvalidKeyLength(InvalidKeyLength),
    InvalidSignatureLength(InvalidSignatureLength),
    InvalidKey(InvalidKey),
    UnsupportedScheme(UnsupportedScheme),
}

/// `IERC7913SignatureVerifier.verify.selector` = bytes4(keccak256("verify(bytes,bytes32,bytes)"))
pub const ERC7913_MAGIC: FixedBytes<4> = FixedBytes([0x02, 0x4a, 0xd3, 0x18]);
pub const ERC7913_FAIL: FixedBytes<4> = FixedBytes([0xff, 0xff, 0xff, 0xff]);

pub fn map_err(scheme: u8, e: qanary_pq::VerifyError) -> VerifierError {
    use qanary_pq::VerifyError as E;
    match e {
        E::KeyLength { expected, got } => VerifierError::InvalidKeyLength(InvalidKeyLength {
            expected: U256::from(expected),
            got: U256::from(got),
        }),
        E::SigLength { expected, got } => VerifierError::InvalidSignatureLength(InvalidSignatureLength {
            expected: U256::from(expected),
            got: U256::from(got),
        }),
        // ContextTooLong cannot occur on the context-free path; treat it as a bad key.
        E::KeyDecode | E::ContextTooLong => VerifierError::InvalidKey(InvalidKey {}),
        E::UnsupportedScheme => VerifierError::UnsupportedScheme(UnsupportedScheme { scheme }),
    }
}
