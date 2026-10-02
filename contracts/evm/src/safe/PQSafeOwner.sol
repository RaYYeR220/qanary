// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title PQSafeOwner
/// @notice ERC-1271 owner for a Safe (1.3.0 / 1.4.1 / 1.5.0) whose signatures are checked by an
///         ERC-7913 post-quantum verifier against a key stored in a KeyStore pointer.
/// @dev Exposes both the current `isValidSignature(bytes32,bytes)` and the legacy Safe
///      `isValidSignature(bytes,bytes)` interfaces. No owner, no admin, immutable config.
///
///      Every signature is bound to the Safe that asks and to the chain. The key never signs the
///      hash it is shown; it signs the EIP-712 digest `safeMessageDigest(safe, hash)` of
///      `SafeMessage(address safe,bytes32 hash)` under the domain
///      `{name: "QanaryPQSafeOwner", version: "1", chainId, verifyingContract: this owner}`, where
///      `safe` is `msg.sender` (the Safe: `checkSignatures` runs in the Safe's context on every
///      version) and `hash` is the `bytes32` argument, or `keccak256(data)` on the legacy entry point.
///      This matters on Safe 1.3.0, whose `CompatibilityFallbackHandler` forwards the raw application
///      message (`abi.encode(dataHash)`) to contract owners instead of a Safe-bound message. One
///      `PQSafeOwner` exists per `(verifier, keyPtr)`, so without the binding an approval collected
///      for one Safe would also be a valid approval of every other Safe the same key owns.
///
///      What the key signs, per Safe path (`safe` is the Safe, `h` goes into `SafeMessage`):
///      - `execTransaction` (1.3.0, 1.4.1): legacy entry point with `data = txHashData`, so
///        `h = safeTxHash`. On 1.5.0 the `bytes32` entry point receives the same `safeTxHash`.
///      - ERC-1271 on the Safe, 1.3.0 handler: `data = abi.encode(appHash)`, so
///        `h = keccak256(abi.encode(appHash))`.
///      - ERC-1271 on the Safe, 1.4.1 / 1.5.0 handler: the owner sees the Safe's EIP-712 message
///        (as `data`, or as its hash), so `h = getMessageHashForSafe(safe, abi.encode(appHash))`.
///      Safe's `checkSignatures(dataHash, data, signatures)` does not check `keccak256(data) ==
///      dataHash` for contract owners (Safe <= 1.4.1). Do not use a PQ-owned Safe with an integrator
///      that calls `checkSignatures` as an external oracle with caller-supplied `data`.
contract PQSafeOwner is EIP712 {
    /// @dev ERC-1271 magic value, `isValidSignature(bytes32,bytes)`.
    bytes4 private constant MAGIC_VALUE = 0x1626ba7e;
    /// @dev Legacy Safe magic value, `isValidSignature(bytes,bytes)`.
    bytes4 private constant LEGACY_MAGIC_VALUE = 0x20c13b0b;
    bytes4 private constant INVALID = 0xffffffff;

    /// @notice EIP-712 type of the message the key signs to approve `hash` for `safe`.
    bytes32 public constant SAFE_MESSAGE_TYPEHASH = keccak256("SafeMessage(address safe,bytes32 hash)");

    /// @notice The ERC-7913 verifier contract.
    address public immutable verifier;
    /// @notice The KeyStore pointer holding the public key.
    address public immutable keyPtr;

    /// @param verifier_ The ERC-7913 verifier.
    /// @param keyPtr_ The KeyStore pointer of the public key.
    constructor(address verifier_, address keyPtr_) EIP712("QanaryPQSafeOwner", "1") {
        verifier = verifier_;
        keyPtr = keyPtr_;
    }

    /// @notice ERC-1271 signature check over `hash`, as asked by the Safe `msg.sender`.
    /// @param hash The hash the Safe asks about.
    /// @param sig The verifier-specific signature over `safeMessageDigest(msg.sender, hash)`.
    /// @return `0x1626ba7e` if valid, `0xffffffff` otherwise.
    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        return _valid(safeMessageDigest(msg.sender, hash), sig) ? MAGIC_VALUE : INVALID;
    }

    /// @notice Legacy Safe signature check over `data`, as asked by the Safe `msg.sender`.
    /// @param data The payload the Safe asks about.
    /// @param sig The verifier-specific signature over `safeMessageDigest(msg.sender, keccak256(data))`.
    /// @return `0x20c13b0b` if valid, `0xffffffff` otherwise.
    function isValidSignature(bytes calldata data, bytes calldata sig) external view returns (bytes4) {
        return _valid(safeMessageDigest(msg.sender, keccak256(data)), sig) ? LEGACY_MAGIC_VALUE : INVALID;
    }

    /// @notice The digest the key signs to approve `hash` for `safe` on this chain.
    /// @param safe The Safe that will ask (`msg.sender` of `isValidSignature`).
    /// @param hash The hash the Safe asks about (`keccak256(data)` on the legacy entry point).
    /// @return The EIP-712 digest of `SafeMessage(safe, hash)` under this owner's domain.
    function safeMessageDigest(address safe, bytes32 hash) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(SAFE_MESSAGE_TYPEHASH, safe, hash)));
    }

    function _valid(bytes32 digest, bytes calldata sig) private view returns (bool) {
        return SignatureChecker.isValidSignatureNow(abi.encodePacked(verifier, keyPtr), digest, sig);
    }
}
