//! Post-quantum signature verification core, `no_std`, no floats, no panics on
//! attacker-controlled input (malformed keys/signatures map to `Err`/`false`).
//!
//! Schemes (ids are the on-chain `scheme` byte used by the multi-scheme verifier):
//! - 1 `FnDsa512`   FN-DSA-512 as implemented by `fn-dsa-vrfy` 0.4.0 (pure mode, empty
//!                   context, `HASH_ID_RAW`).
//! - 2 `MlDsa44`    FIPS 204 ML-DSA-44, pure (external) interface, empty context.
//! - 3 `MlDsa65`    FIPS 204 ML-DSA-65, same.
//! - 4 `Falcon512`  Falcon-512 as submitted to NIST round 3, implemented on top of
//!                   `fn-dsa-comm`'s mod-q NTT arithmetic plus round-3 codecs and
//!                   hash-to-point.
//!
//! The plain `*_verify` functions use an empty context / domain-separation string; the
//! `*_verify_ctx` variants take an explicit context of at most 255 bytes.
#![no_std]
#![allow(dead_code)]

#[cfg(feature = "falcon512")]
pub mod falcon_r3;
pub mod key;

pub use key::{parse_key, parse_pointer_code, KeyRef};

/// Scheme identifiers (first byte of an inline ERC-7913 key for the multi-scheme
/// verifier).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Scheme {
    FnDsa512 = 1,
    MlDsa44 = 2,
    MlDsa65 = 3,
    Falcon512 = 4,
}

impl Scheme {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            1 => Some(Self::FnDsa512),
            2 => Some(Self::MlDsa44),
            3 => Some(Self::MlDsa65),
            4 => Some(Self::Falcon512),
            _ => None,
        }
    }
}

const FNDSA512_PK_LEN: usize = 897;
const FNDSA512_SIG_LEN: usize = 666;
const FALCON512_PK_LEN: usize = 897;
/// Upper bound on an accepted (compressed-format) round-3 Falcon-512 signature; the
/// padded format is exactly 666 bytes.
const FALCON512_SIG_MAX_LEN: usize = 809;
const MLDSA44_PK_LEN: usize = 1312;
const MLDSA44_SIG_LEN: usize = 2420;
const MLDSA65_PK_LEN: usize = 1952;
const MLDSA65_SIG_LEN: usize = 3309;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VerifyError {
    /// Public key has the wrong length for the scheme.
    KeyLength { expected: usize, got: usize },
    /// Signature has the wrong length for the scheme.
    SigLength { expected: usize, got: usize },
    /// Public key has the right length but does not decode (bad header, coefficient
    /// out of range, ...).
    KeyDecode,
    /// Context string longer than 255 bytes.
    ContextTooLong,
    /// Scheme id not compiled into this build.
    UnsupportedScheme,
}

/// Verifies `sig` over `msg` under `pk`, for the given scheme. Pure mode, empty
/// context, no allocation.
pub fn verify(scheme: Scheme, pk: &[u8], msg: &[u8], sig: &[u8]) -> Result<bool, VerifyError> {
    match scheme {
        #[cfg(feature = "fndsa512")]
        Scheme::FnDsa512 => fndsa512_verify(pk, msg, sig),
        #[cfg(feature = "mldsa44")]
        Scheme::MlDsa44 => mldsa44_verify(pk, msg, sig),
        #[cfg(feature = "mldsa65")]
        Scheme::MlDsa65 => mldsa65_verify(pk, msg, sig),
        #[cfg(feature = "falcon512")]
        Scheme::Falcon512 => falcon512_verify(pk, msg, sig),
        #[allow(unreachable_patterns)]
        _ => Err(VerifyError::UnsupportedScheme),
    }
}

// ---------------------------------------------------------------- FN-DSA-512 (fn-dsa-vrfy)

#[cfg(feature = "fndsa512")]
pub fn fndsa512_verify(pk: &[u8], msg: &[u8], sig: &[u8]) -> Result<bool, VerifyError> {
    fndsa512_verify_ctx(pk, msg, b"", sig)
}

/// Same as [`fndsa512_verify`] with an explicit domain context (at most 255 bytes).
#[cfg(feature = "fndsa512")]
pub fn fndsa512_verify_ctx(pk: &[u8], msg: &[u8], ctx: &[u8], sig: &[u8]) -> Result<bool, VerifyError> {
    use fn_dsa_vrfy::{DomainContext, VerifyingKey, VerifyingKey512, HASH_ID_RAW};
    if pk.len() != FNDSA512_PK_LEN {
        return Err(VerifyError::KeyLength { expected: FNDSA512_PK_LEN, got: pk.len() });
    }
    if sig.len() != FNDSA512_SIG_LEN {
        return Err(VerifyError::SigLength { expected: FNDSA512_SIG_LEN, got: sig.len() });
    }
    if ctx.len() > 255 {
        return Err(VerifyError::ContextTooLong);
    }
    let vk = VerifyingKey512::decode(pk).ok_or(VerifyError::KeyDecode)?;
    Ok(vk.verify(sig, &DomainContext(ctx), &HASH_ID_RAW, msg))
}

// ---------------------------------------------------------------- Falcon-512 (round 3)

#[cfg(feature = "falcon512")]
pub fn falcon512_verify(pk: &[u8], msg: &[u8], sig: &[u8]) -> Result<bool, VerifyError> {
    falcon_r3::verify(pk, msg, sig)
}

// ---------------------------------------------------------------- ML-DSA (fips204)

#[cfg(any(feature = "mldsa44", feature = "mldsa65"))]
macro_rules! fips204_verify_fn {
    ($name:ident, $name_ctx:ident, $module:ident, $pklen:expr, $siglen:expr) => {
        /// FIPS 204 ML-DSA pure verify, empty context.
        pub fn $name(pk: &[u8], msg: &[u8], sig: &[u8]) -> Result<bool, VerifyError> {
            $name_ctx(pk, msg, b"", sig)
        }

        /// FIPS 204 ML-DSA pure verify with an explicit context (at most 255 bytes).
        pub fn $name_ctx(pk: &[u8], msg: &[u8], ctx: &[u8], sig: &[u8]) -> Result<bool, VerifyError> {
            use fips204::traits::{SerDes, Verifier};
            let pkb = <[u8; $pklen]>::try_from(pk)
                .map_err(|_| VerifyError::KeyLength { expected: $pklen, got: pk.len() })?;
            let sigb = <[u8; $siglen]>::try_from(sig)
                .map_err(|_| VerifyError::SigLength { expected: $siglen, got: sig.len() })?;
            if ctx.len() > 255 {
                return Err(VerifyError::ContextTooLong);
            }
            let key = fips204::$module::PublicKey::try_from_bytes(pkb).map_err(|_| VerifyError::KeyDecode)?;
            Ok(key.verify(msg, &sigb, ctx))
        }
    };
}

#[cfg(feature = "mldsa44")]
fips204_verify_fn!(mldsa44_verify, mldsa44_verify_ctx, ml_dsa_44, MLDSA44_PK_LEN, MLDSA44_SIG_LEN);
#[cfg(feature = "mldsa65")]
fips204_verify_fn!(mldsa65_verify, mldsa65_verify_ctx, ml_dsa_65, MLDSA65_PK_LEN, MLDSA65_SIG_LEN);
