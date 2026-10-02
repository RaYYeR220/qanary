// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {QanaryAccount} from "./QanaryAccount.sol";
import {QanaryMultisigAccount} from "./QanaryMultisigAccount.sol";

/// @title QanaryAccountFactory
/// @notice Deterministic ERC-1167 clone factory for `QanaryAccount` and `QanaryMultisigAccount`.
/// @dev The clone salt is `keccak256(abi.encode(<init args>, salt))`, so a predicted address
///      commits to the full signer configuration. No owner, no admin.
contract QanaryAccountFactory {
    /// @notice Implementation cloned for single-signer accounts.
    address public immutable singleImpl;
    /// @notice Implementation cloned for multisig accounts.
    address public immutable multisigImpl;

    /// @notice Emitted when an account clone is deployed.
    /// @param account The new account.
    /// @param multisig Whether it is a `QanaryMultisigAccount`.
    event AccountCreated(address indexed account, bool multisig);

    constructor() {
        singleImpl = address(new QanaryAccount());
        multisigImpl = address(new QanaryMultisigAccount());
    }

    /// @notice Deploys (or returns the existing) single-signer account.
    /// @param signer ERC-7913 signer: `verifier ‖ keyPtr`.
    /// @param salt User-chosen salt.
    /// @return account The account address.
    function createAccount(bytes calldata signer, bytes32 salt) external returns (address account) {
        bytes32 s = _singleSalt(signer, salt);
        account = Clones.predictDeterministicAddress(singleImpl, s, address(this));
        if (account.code.length != 0) return account;
        Clones.cloneDeterministic(singleImpl, s);
        QanaryAccount(payable(account)).initialize(signer);
        emit AccountCreated(account, false);
    }

    /// @notice Deploys (or returns the existing) weighted multisig account.
    /// @param signers ERC-7913 signers.
    /// @param weights Signer weights, same order.
    /// @param threshold Total weight required.
    /// @param salt User-chosen salt.
    /// @return account The account address.
    function createMultisig(bytes[] calldata signers, uint64[] calldata weights, uint64 threshold, bytes32 salt)
        external
        returns (address account)
    {
        bytes32 s = _multisigSalt(signers, weights, threshold, salt);
        account = Clones.predictDeterministicAddress(multisigImpl, s, address(this));
        if (account.code.length != 0) return account;
        Clones.cloneDeterministic(multisigImpl, s);
        QanaryMultisigAccount(payable(account)).initialize(signers, weights, threshold);
        emit AccountCreated(account, true);
    }

    /// @notice Predicts the single-signer account address.
    /// @param signer ERC-7913 signer.
    /// @param salt User-chosen salt.
    /// @return The address `createAccount` deploys to.
    function predictAccount(bytes calldata signer, bytes32 salt) external view returns (address) {
        return Clones.predictDeterministicAddress(singleImpl, _singleSalt(signer, salt), address(this));
    }

    /// @notice Predicts the multisig account address.
    /// @param signers ERC-7913 signers.
    /// @param weights Signer weights.
    /// @param threshold Total weight required.
    /// @param salt User-chosen salt.
    /// @return The address `createMultisig` deploys to.
    function predictMultisig(bytes[] calldata signers, uint64[] calldata weights, uint64 threshold, bytes32 salt)
        external
        view
        returns (address)
    {
        return Clones.predictDeterministicAddress(
            multisigImpl, _multisigSalt(signers, weights, threshold, salt), address(this)
        );
    }

    function _singleSalt(bytes calldata signer, bytes32 salt) private pure returns (bytes32) {
        return keccak256(abi.encode(signer, salt));
    }

    function _multisigSalt(bytes[] calldata signers, uint64[] calldata weights, uint64 threshold, bytes32 salt)
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(signers, weights, threshold, salt));
    }
}
