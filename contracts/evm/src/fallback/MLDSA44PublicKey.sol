// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IQanaryPQVerifier} from "../interfaces/IQanaryPQVerifier.sol";

/// @title MLDSA44PublicKey
/// @notice Parses an ERC-7913 ML-DSA-44 key exactly like the Stylus verifiers: `qanary_pq::parse_key`,
///         `parse_pointer_code`, the scheme dispatch, then the ML-DSA-44 public-key length check.
library MLDSA44PublicKey {
    /// @dev Scheme id of ML-DSA-44.
    uint8 internal constant SCHEME = 2;
    /// @dev Encoded ML-DSA-44 public-key length: rho (32 bytes) || t1 (4 x 320 bytes).
    uint256 internal constant LENGTH = 1312;

    /// @notice Returns the 1,312-byte public key behind `key`.
    /// @dev A 20-byte `key` is a KeyStore pointer whose code is `0x00 || scheme || pk`; any other
    ///      length is an inline `scheme || pk`. Reverts with `InvalidKeyLength(1, 0)` for an empty
    ///      key, `InvalidKey()` for pointer code shorter than 2 bytes or not starting with 0x00,
    ///      `UnsupportedScheme(s)` for a scheme other than 2 and `InvalidKeyLength(1312, n)` for a
    ///      public key of the wrong length.
    /// @param key The ERC-7913 key bytes.
    /// @return pk The public key.
    function fromKey(bytes calldata key) internal view returns (bytes memory pk) {
        uint256 len = key.length;
        if (len == 0) revert IQanaryPQVerifier.InvalidKeyLength(1, 0);
        uint8 scheme;
        if (len == 20) {
            // casting to 'bytes20' is safe because `key` is exactly 20 bytes here
            // forge-lint: disable-next-line(unsafe-typecast)
            address ptr = address(bytes20(key));
            uint256 size = ptr.code.length;
            if (size < 2) revert IQanaryPQVerifier.InvalidKey();
            uint256 head;
            assembly ("memory-safe") {
                mstore(0, 0)
                extcodecopy(ptr, 30, 0, 2)
                head := mload(0)
            }
            if (head >> 8 != 0) revert IQanaryPQVerifier.InvalidKey();
            // casting to 'uint8' is safe because `head` holds exactly two code bytes
            // forge-lint: disable-next-line(unsafe-typecast)
            scheme = uint8(head);
            if (scheme != SCHEME) revert IQanaryPQVerifier.UnsupportedScheme(scheme);
            if (size - 2 != LENGTH) revert IQanaryPQVerifier.InvalidKeyLength(LENGTH, size - 2);
            pk = new bytes(LENGTH);
            assembly ("memory-safe") {
                extcodecopy(ptr, add(pk, 32), 2, LENGTH)
            }
        } else {
            scheme = uint8(key[0]);
            if (scheme != SCHEME) revert IQanaryPQVerifier.UnsupportedScheme(scheme);
            if (len - 1 != LENGTH) revert IQanaryPQVerifier.InvalidKeyLength(LENGTH, len - 1);
            pk = key[1:];
        }
    }
}
