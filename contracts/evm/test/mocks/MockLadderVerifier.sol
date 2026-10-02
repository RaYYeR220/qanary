// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ILadderVerifier} from "../../src/interfaces/ILadderVerifier.sol";

/// @title MockLadderVerifier
/// @notice Test-only stand-in for the Stylus ladder verifier. Accepts exactly the `(r, s)` pairs preset
///         for a `(curve, key, digest)`, plus the plain-ECDSA `e ≡ 0` forgery (digest 0, `r = s = qx`)
///         that the real verifier accepts for every key — so tests can show the registry never lets a
///         claimant pick the digest.
contract MockLadderVerifier is ILadderVerifier {
    mapping(bytes32 sigHash => bool) internal _accepted;

    /// @notice Makes `verify(curve, qx, qy, digest, r, s)` return true.
    function accept(uint8 curve, bytes32 qx, bytes32 qy, bytes32 digest, bytes32 r, bytes32 s) external {
        _accepted[keccak256(abi.encode(curve, qx, qy, digest, r, s))] = true;
    }

    /// @inheritdoc ILadderVerifier
    function verify(uint8 curve, bytes32 qx, bytes32 qy, bytes32 digest, bytes32 r, bytes32 s)
        external
        view
        returns (bool)
    {
        if (curve == 0 || curve > 3) revert UnknownCurve(curve);
        if (digest == bytes32(0) && r == qx && s == qx) return true;
        return _accepted[keccak256(abi.encode(curve, qx, qy, digest, r, s))];
    }
}
