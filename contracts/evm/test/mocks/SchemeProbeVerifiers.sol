// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC7913SignatureVerifier} from "@openzeppelin/contracts/interfaces/IERC7913.sol";

/// @title NoSchemesVerifier
/// @notice Test-only ERC-7913 verifier with `MockVerifier` semantics but no `schemes()`, like the
///         classical OpenZeppelin verifiers (P-256, WebAuthn, RSA).
contract NoSchemesVerifier is IERC7913SignatureVerifier {
    /// @notice Valid iff `signature == abi.encode(key, hash)`.
    function verify(bytes calldata key, bytes32 hash, bytes calldata signature) external pure returns (bytes4) {
        return keccak256(signature) == keccak256(abi.encode(key, hash)) ? bytes4(0x024ad318) : bytes4(0xffffffff);
    }
}

/// @title RawSchemesVerifier
/// @notice Test-only ERC-7913 verifier with `MockVerifier` semantics whose `schemes()` returns
///         arbitrary raw bytes (or reverts), to probe how the validator parses the answer.
contract RawSchemesVerifier is IERC7913SignatureVerifier {
    bytes internal _answer;
    bool internal _reverts;

    /// @notice Sets the raw return data of `schemes()`.
    function setAnswer(bytes calldata answer) external {
        _answer = answer;
        _reverts = false;
    }

    /// @notice Sets the answer to the ABI encoding of `ids` as a `uint8[]`.
    function setSchemes(uint8[] calldata ids) external {
        _answer = abi.encode(ids);
        _reverts = false;
    }

    /// @notice Makes `schemes()` revert.
    function setReverting() external {
        _reverts = true;
    }

    /// @notice Valid iff `signature == abi.encode(key, hash)`.
    function verify(bytes calldata key, bytes32 hash, bytes calldata signature) external pure returns (bytes4) {
        return keccak256(signature) == keccak256(abi.encode(key, hash)) ? bytes4(0x024ad318) : bytes4(0xffffffff);
    }

    /// @notice Returns the configured raw bytes verbatim (not ABI-wrapped), or reverts.
    function schemes() external view returns (uint8[] memory) {
        require(!_reverts, "schemes disabled");
        bytes memory a = _answer;
        assembly ("memory-safe") {
            return(add(a, 0x20), mload(a))
        }
    }
}
