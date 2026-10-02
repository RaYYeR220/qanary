// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title RevertingToken
/// @notice Test-only token whose `balanceOf` always reverts; `transfer` is a no-op success.
contract RevertingToken {
    /// @notice `balanceOf` was called.
    error BalanceOfDisabled();

    /// @notice Always reverts.
    function balanceOf(address) external pure returns (uint256) {
        revert BalanceOfDisabled();
    }

    /// @notice Pretends to transfer.
    function transfer(address, uint256) external pure returns (bool) {
        return true;
    }
}
