// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ILadderVerifier} from "../interfaces/ILadderVerifier.sol";

/// @title LadderUnavailableVerifier
/// @notice Ladder verifier for chains where the Stylus ladder program cannot be activated (Arbitrum One
///         and Nova while new Stylus activations are paused). Every `verify` reverts, so a registry built
///         on it fails closed: L1–L3 claims revert and the ladder level never moves, while K1 (`ecrecover`)
///         and R1 (P-256) claims keep working.
/// @dev The registry's ladder is immutable. Accounts that want the full ladder point their hot tier at a
///      registry whose ladder is the live Stylus program (`HotTierExecutor.configure`, sent by the
///      post-quantum root) once one exists on that chain.
contract LadderUnavailableVerifier is ILadderVerifier {
    /// @notice No ladder verifier runs on this chain.
    error LadderUnavailable();

    /// @inheritdoc ILadderVerifier
    function verify(uint8, bytes32, bytes32, bytes32, bytes32, bytes32) external pure returns (bool) {
        revert LadderUnavailable();
    }
}
