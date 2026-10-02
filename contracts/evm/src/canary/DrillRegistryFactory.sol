// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ILadderVerifier} from "../interfaces/ILadderVerifier.sol";
import {CanaryTargets} from "./CanaryTargets.sol";
import {QuantumCanaryRegistry} from "./QuantumCanaryRegistry.sol";

/// @title DrillRegistryFactory
/// @notice Permissionless factory for drill registries: canary registries guarding the published drill
///         keys (`CanaryTargets.drill()`), so integrators can rehearse real claims and watch hot-tier
///         modules react without touching the live tripwire. Every drill is a fresh, independent
///         registry; claim messages bind to its address, so a drill proof never works anywhere else.
contract DrillRegistryFactory {
    /// @notice A drill registry was deployed by `creator`.
    event DrillCreated(address indexed registry, address indexed creator);

    /// @notice Ladder verifier handed to every drill registry.
    ILadderVerifier public immutable ladder;
    /// @notice Bounty token handed to every drill registry (`address(0)` for ETH-only).
    IERC20 public immutable bountyToken;

    constructor(ILadderVerifier ladder_, IERC20 bountyToken_) {
        ladder = ladder_;
        bountyToken = bountyToken_;
    }

    /// @notice Deploys a new drill registry over the published drill keys.
    function create() external returns (QuantumCanaryRegistry registry) {
        registry = new QuantumCanaryRegistry(ladder, bountyToken, CanaryTargets.drill(), true);
        // The registry constructor only stores immutables and makes no calls, so nothing can reenter here.
        // forge-lint: disable-next-line(reentrancy-events)
        emit DrillCreated(address(registry), msg.sender);
    }
}
