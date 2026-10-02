// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IQanaryPQVerifier} from "../interfaces/IQanaryPQVerifier.sol";
import {IMLDSAVerifier} from "./vendor/IMLDSAVerifier.sol";
import {MLDSA44ExpandedKeyStore} from "./MLDSA44ExpandedKeyStore.sol";
import {MLDSA44PublicKey} from "./MLDSA44PublicKey.sol";

/// @title SolidityMLDSA44Verifier
/// @notice ERC-7913 ML-DSA-44 verifier in plain EVM code, for chains where the Stylus verifiers
///         cannot be activated. Same ABI, errors, key formats and semantics as the Stylus
///         `mldsa44-verifier`: FIPS 204 pure ML-DSA-44 with an empty context over the 32-byte
///         `hash` as the message (what AWS KMS `ML_DSA_SHAKE_256` with `MessageType: RAW` and
///         noble-post-quantum `ml_dsa44.sign(msg, sk)` produce). An account moves to the Stylus
///         verifier later by rotating to it with the same key pointer.
/// @dev Verification runs on the vendored Fireblocks `MLDSA44Verifier` core (`vendor/`, see
///      `README.md`), which reads an expanded key from a data contract. `MLDSA44ExpandedKeyStore`
///      computes that expansion on-chain once per key and deploys it at a CREATE2 address that
///      depends only on `keccak256(pk)`, so `verify` derives the blob from the key alone.
///
///      `verify` reads no storage and its whole call tree (this contract, the core and the
///      Keccak helper) contains none of the opcodes ERC-7562 bans during ERC-4337 validation;
///      `test/fallback` scans the three runtimes. CREATE2 and transient storage live in the key
///      store only.
///
///      `verify` flow, in the Stylus verifier's order: parse `key` (20 bytes = KeyStore pointer
///      whose code is `0x00 || scheme || pk`, otherwise inline `scheme || pk`), check the scheme,
///      the public-key length and the signature length, then require the prepared blob and ask the
///      core. A key that was never prepared reverts with `KeyNotPrepared`.
contract SolidityMLDSA44Verifier is IQanaryPQVerifier {
    /// @notice The only scheme id this verifier accepts (ML-DSA-44).
    uint8 public constant SCHEME = 2;
    /// @notice Encoded ML-DSA-44 public-key length.
    uint256 public constant PK_LENGTH = 1312;
    /// @notice ML-DSA-44 signature length.
    uint256 public constant SIGNATURE_LENGTH = 2420;
    /// @notice Code size of a prepared blob: the 0x00 prefix plus the 20,544-byte payload.
    uint256 public constant BLOB_SIZE = 20545;

    bytes4 private constant MAGIC = 0x024ad318;
    bytes4 private constant FAIL = 0xffffffff;

    /// @notice The vendored Fireblocks ML-DSA-44 core: `verify(pkBlob, message, signature) -> bool`.
    IMLDSAVerifier public immutable CORE;
    /// @notice The store that expands keys and deploys their blobs.
    MLDSA44ExpandedKeyStore public immutable EXPANDED_KEYS;
    /// @dev `EXPANDED_KEYS.BLOB_INIT_CODE_HASH()`, cached so `verify` makes no extra call.
    bytes32 private immutable BLOB_INIT_CODE_HASH;

    /// @notice The public key is well formed but its expansion was never prepared.
    /// @param pkHash keccak256 of the 1,312-byte public key.
    error KeyNotPrepared(bytes32 pkHash);
    /// @notice The core address has no code.
    error BadCore();
    /// @notice The key store address has no code.
    error BadKeyStore();

    /// @param core The deployed vendored `MLDSA44Verifier` (bound to the pinned Keccak helper).
    /// @param expandedKeys The deployed `MLDSA44ExpandedKeyStore` (bound to the same helper).
    constructor(IMLDSAVerifier core, MLDSA44ExpandedKeyStore expandedKeys) {
        if (address(core).code.length == 0) revert BadCore();
        if (address(expandedKeys).code.length == 0) revert BadKeyStore();
        CORE = core;
        EXPANDED_KEYS = expandedKeys;
        BLOB_INIT_CODE_HASH = expandedKeys.BLOB_INIT_CODE_HASH();
    }

    // ---------------------------------------------------------------- ERC-7913

    /// @inheritdoc IQanaryPQVerifier
    /// @dev Reverts with `InvalidKeyLength`, `InvalidKey`, `UnsupportedScheme` or
    ///      `InvalidSignatureLength` on malformed input and with `KeyNotPrepared` for a key without
    ///      a blob; a well-formed signature that does not verify returns 0xffffffff.
    function verify(bytes calldata key, bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        bytes32 pkHash = keccak256(MLDSA44PublicKey.fromKey(key));
        if (signature.length != SIGNATURE_LENGTH) revert InvalidSignatureLength(SIGNATURE_LENGTH, signature.length);
        address blob = blobAddress(pkHash);
        if (blob.code.length != BLOB_SIZE) revert KeyNotPrepared(pkHash);
        return CORE.verify(blob, abi.encodePacked(hash), signature) ? MAGIC : FAIL;
    }

    /// @inheritdoc IQanaryPQVerifier
    function schemes() external pure returns (uint8[] memory s) {
        s = new uint8[](1);
        s[0] = SCHEME;
    }

    // ---------------------------------------------------------------- key preparation

    /// @notice Prepares `key` for this verifier: `EXPANDED_KEYS.prepare(key)`.
    /// @dev Permissionless and idempotent; about 9.9M gas the first time, see
    ///      `MLDSA44ExpandedKeyStore.prepare`.
    /// @param key A KeyStore pointer (20 bytes) or an inline `scheme || pk`.
    /// @return The data contract holding the expanded key.
    function prepareKey(bytes calldata key) external returns (address) {
        return EXPANDED_KEYS.prepare(key);
    }

    /// @notice The address of the prepared blob for the public key with hash `pkHash`.
    /// @param pkHash keccak256 of the 1,312-byte public key.
    /// @return `EXPANDED_KEYS.blobAddress(pkHash)`, computed locally.
    function blobAddress(bytes32 pkHash) public view returns (address) {
        return address(
            uint160(
                uint256(keccak256(abi.encodePacked(bytes1(0xff), address(EXPANDED_KEYS), pkHash, BLOB_INIT_CODE_HASH)))
            )
        );
    }

    /// @notice Whether `key` is well formed and prepared, i.e. `verify` will not revert on it for a
    ///         2,420-byte signature.
    /// @param key A KeyStore pointer (20 bytes) or an inline `scheme || pk`; reverts like `verify`
    ///        when malformed.
    /// @return True if the expanded key is deployed.
    function isPrepared(bytes calldata key) external view returns (bool) {
        return blobAddress(keccak256(MLDSA44PublicKey.fromKey(key))).code.length == BLOB_SIZE;
    }
}
