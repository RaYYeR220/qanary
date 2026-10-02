// Shared contract body; the including crate defines
//   const SCHEMES: &[u8]
//   fn dispatch(scheme: u8, pk: &[u8], msg: &[u8], sig: &[u8]) -> Result<bool, qanary_pq::VerifyError>
use alloc::vec::Vec;
use qanary_pq::KeyRef;
use stylus_sdk::abi::Bytes;
use stylus_sdk::alloy_primitives::Address;

#[storage]
#[entrypoint]
pub struct PqVerifier {}

fn verdict(scheme: u8, pk: &[u8], msg: &[u8], sig: &[u8]) -> Result<FixedBytes<4>, VerifierError> {
    match dispatch(scheme, pk, msg, sig) {
        Ok(true) => Ok(ERC7913_MAGIC),
        Ok(false) => Ok(ERC7913_FAIL),
        Err(e) => Err(map_err(scheme, e)),
    }
}

#[public]
impl PqVerifier {
    /// ERC-7913 `verify`. `key` is either a 20-byte pointer to a contract whose code is
    /// `0x00 || scheme || pk`, or an inline `scheme || pk`.
    pub fn verify(&self, key: Bytes, hash: FixedBytes<32>, signature: Bytes) -> Result<FixedBytes<4>, VerifierError> {
        match qanary_pq::parse_key(&key).map_err(|e| map_err(0, e))? {
            KeyRef::Pointer(addr) => {
                let code = self.vm().code(Address::from(addr));
                let (scheme, pk) = qanary_pq::parse_pointer_code(&code).map_err(|e| map_err(0, e))?;
                verdict(scheme, pk, hash.as_slice(), &signature)
            }
            KeyRef::Inline { scheme, pk } => verdict(scheme, pk, hash.as_slice(), &signature),
        }
    }

    /// Scheme ids this verifier accepts.
    pub fn schemes(&self) -> Vec<u8> {
        SCHEMES.to_vec()
    }
}
