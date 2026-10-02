// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Account} from "@openzeppelin/contracts/account/Account.sol";
import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";
import {
    MultiSignerERC7913Weighted
} from "@openzeppelin/contracts/utils/cryptography/signers/MultiSignerERC7913Weighted.sol";
import {ERC7739} from "@openzeppelin/contracts/utils/cryptography/signers/draft-ERC7739.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/// @title QanaryMultisigAccount
/// @notice ERC-4337 smart account governed by a weighted threshold of ERC-7913 signers
///         (e.g. Stylus post-quantum verifiers).
/// @dev Deployed as an implementation and cloned by `QanaryAccountFactory`. Signature format is
///      OpenZeppelin's `abi.encode(bytes[] signers, bytes[] signatures)`.
contract QanaryMultisigAccount is Account, MultiSignerERC7913Weighted, ERC7739, ERC7821, Initializable {
    /// @dev The locked implementation needs one reachable placeholder signer to satisfy the base
    ///      constructor; clones never see this state and the implementation can never be initialized.
    constructor() MultiSignerERC7913Weighted(_placeholder(), _one(), 1) EIP712("QanaryMultisigAccount", "1") {
        _disableInitializers();
    }

    /// @notice Configures the signer set once, right after the clone is created.
    /// @param signers ERC-7913 signers (`verifier ‖ keyPtr`).
    /// @param weights Weight of each signer, same order as `signers`.
    /// @param threshold Total weight required to authorize.
    function initialize(bytes[] calldata signers, uint64[] calldata weights, uint64 threshold) external initializer {
        _addSigners(signers);
        _setSignerWeights(signers, weights);
        _setThreshold(threshold);
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

    function _placeholder() private pure returns (bytes[] memory s) {
        s = new bytes[](1);
        s[0] = abi.encodePacked(address(0xdead));
    }

    function _one() private pure returns (uint64[] memory w) {
        w = new uint64[](1);
        w[0] = 1;
    }
}
