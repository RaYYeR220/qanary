// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @notice ABI of the Qanary Stylus ladder verifier: ECDSA over the canary curves.
interface ILadderVerifier {
    error UnknownCurve(uint8 curve);

    /// curve: 1 = secp160r1, 2 = P-192, 3 = P-224. Returns false for any invalid signature/point/range.
    function verify(uint8 curve, bytes32 qx, bytes32 qy, bytes32 digest, bytes32 r, bytes32 s) external view returns (bool);
}
