// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC7913SignatureVerifier} from "@openzeppelin/contracts/interfaces/IERC7913.sol";

/// @title MockVerifier
/// @notice Test-only ERC-7913 verifier. A signature is valid iff it equals `abi.encode(key, hash)`.
contract MockVerifier is IERC7913SignatureVerifier {
    /// @notice `verify` was called for a key registered through `revertOn`.
    error MockVerifierRevert();

    mapping(bytes32 keyHash => bool) public reverts;

    /// @notice Makes every future `verify` call for `key` revert.
    /// @param key The key bytes exactly as the verifier receives them.
    function revertOn(bytes calldata key) external {
        reverts[keccak256(key)] = true;
    }

    /// @notice Returns the ERC-7913 magic value iff `keccak256(signature) == keccak256(abi.encode(key, hash))`.
    /// @param key The key bytes (for the validator: the 20-byte key pointer).
    /// @param hash The signed digest.
    /// @param signature The candidate signature.
    /// @return `0x024ad318` on success, `0xffffffff` otherwise.
    function verify(bytes calldata key, bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (reverts[keccak256(key)]) revert MockVerifierRevert();
        return keccak256(signature) == keccak256(abi.encode(key, hash)) ? bytes4(0x024ad318) : bytes4(0xffffffff);
    }
}
