// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MockCanaryRegistry
/// @notice Test-only stand-in for the canary registry: settable ladder level and broken families.
contract MockCanaryRegistry {
    /// @notice Every view reverts while `reverting` is set.
    error MockRegistryRevert();

    uint8 internal _level;
    mapping(uint8 family => bool) internal _broken;
    bool public reverting;

    /// @notice Sets the ladder level returned by `ladderLevel`.
    function setLadderLevel(uint8 level) external {
        _level = level;
    }

    /// @notice Marks `family` as broken (or not).
    function setFamilyBroken(uint8 family, bool broken) external {
        _broken[family] = broken;
    }

    /// @notice Makes `ladderLevel` and `familyBroken` revert.
    function setReverting(bool r) external {
        reverting = r;
    }

    /// @notice The current ladder level.
    function ladderLevel() external view returns (uint8) {
        if (reverting) revert MockRegistryRevert();
        return _level;
    }

    /// @notice Whether `family` is broken.
    function familyBroken(uint8 family) external view returns (bool) {
        if (reverting) revert MockRegistryRevert();
        return _broken[family];
    }
}
