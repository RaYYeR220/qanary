// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title PQSafeOwner
/// @notice ERC-1271 owner for a Safe (1.3.0 / 1.4.1) whose signatures are checked by an
///         ERC-7913 post-quantum verifier against a key stored in a KeyStore pointer.
/// @dev Exposes both the current `isValidSignature(bytes32,bytes)` and the legacy Safe
///      `isValidSignature(bytes,bytes)` interfaces. No owner, no admin, immutable config.
contract PQSafeOwner {
    /// @dev ERC-1271 magic value, `isValidSignature(bytes32,bytes)`.
    bytes4 private constant MAGIC_VALUE = 0x1626ba7e;
    /// @dev Legacy Safe magic value, `isValidSignature(bytes,bytes)`.
    bytes4 private constant LEGACY_MAGIC_VALUE = 0x20c13b0b;
    bytes4 private constant INVALID = 0xffffffff;

    /// @notice The ERC-7913 verifier contract.
    address public immutable verifier;
    /// @notice The KeyStore pointer holding the public key.
    address public immutable keyPtr;

    /// @param verifier_ The ERC-7913 verifier.
    /// @param keyPtr_ The KeyStore pointer of the public key.
    constructor(address verifier_, address keyPtr_) {
        verifier = verifier_;
        keyPtr = keyPtr_;
    }

    /// @notice ERC-1271 signature check over `hash`.
    /// @param hash The signed digest.
    /// @param sig The verifier-specific signature.
    /// @return `0x1626ba7e` if valid, `0xffffffff` otherwise.
    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        return _valid(hash, sig) ? MAGIC_VALUE : INVALID;
    }

    /// @notice Legacy Safe signature check over `keccak256(data)`.
    /// @param data The signed payload.
    /// @param sig The verifier-specific signature.
    /// @return `0x20c13b0b` if valid, `0xffffffff` otherwise.
    function isValidSignature(bytes calldata data, bytes calldata sig) external view returns (bytes4) {
        return _valid(keccak256(data), sig) ? LEGACY_MAGIC_VALUE : INVALID;
    }

    function _valid(bytes32 hash, bytes calldata sig) private view returns (bool) {
        return SignatureChecker.isValidSignatureNow(abi.encodePacked(verifier, keyPtr), hash, sig);
    }
}
