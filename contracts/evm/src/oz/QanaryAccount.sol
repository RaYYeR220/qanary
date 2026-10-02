// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Account} from "@openzeppelin/contracts/account/Account.sol";
import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";
import {SignerERC7913} from "@openzeppelin/contracts/utils/cryptography/signers/SignerERC7913.sol";
import {ERC7739} from "@openzeppelin/contracts/utils/cryptography/signers/draft-ERC7739.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/// @title QanaryAccount
/// @notice ERC-4337 smart account whose single signer is an ERC-7913 verifier, e.g. a Stylus
///         post-quantum verifier, plus the key pointer it verifies against.
/// @dev Deployed as an implementation and cloned (ERC-1167) by `QanaryAccountFactory`. The
///      implementation itself is locked. Executors are the entry point and the account itself.
contract QanaryAccount is Account, SignerERC7913, ERC7739, ERC7821, Initializable {
    constructor() SignerERC7913("") EIP712("QanaryAccount", "1") {
        _disableInitializers();
    }

    /// @notice Sets the account's signer once, right after the clone is created.
    /// @param signer_ ERC-7913 signer: `verifier ‖ keyPtr`.
    function initialize(bytes calldata signer_) external initializer {
        _setSigner(signer_);
    }

    /// @inheritdoc SignerERC7913
    function signer() public view override returns (bytes memory) {
        return super.signer();
    }

    /// @dev ERC-7821 `execute` is callable by the entry point or the account itself.
    function _erc7821AuthorizedExecutor(address caller, bytes32 mode, bytes calldata executionData)
        internal
        view
        override
        returns (bool)
    {
        return caller == address(entryPoint()) || super._erc7821AuthorizedExecutor(caller, mode, executionData);
    }
}
