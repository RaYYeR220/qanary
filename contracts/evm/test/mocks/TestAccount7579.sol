// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccountERC7579} from "@openzeppelin/contracts/account/extensions/draft-AccountERC7579.sol";

/// @title TestAccount7579
/// @notice Test-only concrete OpenZeppelin ERC-7579 account. Modules can be installed and
///         uninstalled without authorization so executors can be exercised in unit tests.
contract TestAccount7579 is AccountERC7579 {
    /// @notice Installs `module` as `moduleTypeId`, bypassing the entry-point/self check.
    function installModuleForTest(uint256 moduleTypeId, address module, bytes calldata initData) external {
        _installModule(moduleTypeId, module, initData);
    }

    /// @notice Uninstalls `module` as `moduleTypeId`, bypassing the entry-point/self check.
    function uninstallModuleForTest(uint256 moduleTypeId, address module, bytes calldata deInitData) external {
        _uninstallModule(moduleTypeId, module, deInitData);
    }
}
