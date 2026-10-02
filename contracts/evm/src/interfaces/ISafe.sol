// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ISafe
/// @notice The Safe (v1.3+/v1.4.1) module entry point used by module-style executors.
interface ISafe {
    /// @notice Executes a call from an enabled module without owner confirmations.
    /// @param to Destination address.
    /// @param value Native value sent with the call.
    /// @param data Call data.
    /// @param operation 0 = CALL, 1 = DELEGATECALL.
    /// @return True if the inner call succeeded.
    function execTransactionFromModule(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        returns (bool);

    /// @notice Whether `module` is enabled on the Safe.
    /// @param module The module address.
    /// @return True if enabled.
    function isModuleEnabled(address module) external view returns (bool);
}
