// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IQuantumCanaryRegistry
/// @notice Public quantum-threat signal: bounties on a ladder of small elliptic-curve discrete-log
///         challenges plus the production curves. Claims raise the ladder level or mark a classical
///         signature family as broken; hot-tier modules read both to throttle or kill classical keys.
interface IQuantumCanaryRegistry {
    // targets: 0 = L1 secp160r1, 1 = L2 P-192, 2 = L3 P-224, 3 = K1 secp256k1, 4 = R1 P-256 ; families: 0 = SECP256K1, 1 = P256
    event Claimed(uint8 indexed target, address indexed claimant, uint256 tokenBounty, uint256 ethBounty);
    event LevelRaised(uint8 previous, uint8 current);
    event FamilyBroken(uint8 indexed family);
    event Funded(uint8 indexed target, address indexed funder, uint256 tokenAmount, uint256 ethAmount);
    error InvalidTarget(uint8 target);
    error AlreadyClaimed(uint8 target);
    error InvalidProof();
    error TokenBountiesDisabled();
    function ladderLevel() external view returns (uint8);
    function familyBroken(uint8 family) external view returns (bool);
    function claimed(uint8 target) external view returns (bool);
    function claimMessage(uint8 target, address claimant) external view returns (bytes32);
    function claim(uint8 target, bytes calldata proof) external;
    function fund(uint8 target, uint256 amount) external;
    function fundETH(uint8 target) external payable;
    function bounty(uint8 target) external view returns (uint256 tokenAmount, uint256 ethAmount);
    function isDrill() external view returns (bool);
}
