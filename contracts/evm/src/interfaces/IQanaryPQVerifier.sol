// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @notice ABI of the Qanary Stylus post-quantum verifiers (ML-DSA-44, ML-DSA-65, Falcon-512 / FN-DSA-512).
/// `verify` is wire-compatible with ERC-7913 `IERC7913SignatureVerifier.verify`.
/// `key` is either 20 bytes (address of a contract whose code is `0x00 || scheme || publicKey`)
/// or an inline `scheme (1 byte) || publicKey`.
interface IQanaryPQVerifier {
    error InvalidKeyLength(uint256 expected, uint256 got);
    error InvalidSignatureLength(uint256 expected, uint256 got);
    error InvalidKey();
    error UnsupportedScheme(uint8 scheme);

    /// @return 0x024ad318 when the signature over `hash` is valid, 0xffffffff when it is well formed but invalid.
    function verify(bytes calldata key, bytes32 hash, bytes calldata signature) external view returns (bytes4);

    /// @return Scheme ids this verifier accepts: [2] ML-DSA-44, [3] ML-DSA-65, [1, 4] FN-DSA-512 and Falcon-512.
    function schemes() external pure returns (uint8[] memory);
}
