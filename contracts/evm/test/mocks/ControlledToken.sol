// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title ControlledToken
/// @notice Test-only ERC-20 with issuer controls: a global pause, a per-address blacklist and a
///         burn-on-transfer fee. Mints and burns are never blocked.
contract ControlledToken is ERC20 {
    /// @notice Transfers are paused.
    error TokenPaused();
    /// @notice `account` is blacklisted.
    error Blacklisted(address account);

    bool public paused;
    uint256 public feeBps;
    mapping(address account => bool) public blocked;

    constructor() ERC20("Controlled", "CTL") {}

    /// @notice Mints `amount` to `to`.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Pauses (or resumes) all transfers.
    function setPaused(bool p) external {
        paused = p;
    }

    /// @notice Blacklists (or clears) `account` as sender and recipient.
    function setBlocked(address account, bool b) external {
        blocked[account] = b;
    }

    /// @notice Burns `bps` basis points of every transfer.
    function setFeeBps(uint256 bps) external {
        feeBps = bps;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            if (paused) revert TokenPaused();
            if (blocked[from]) revert Blacklisted(from);
            if (blocked[to]) revert Blacklisted(to);
            uint256 fee = value * feeBps / 10_000;
            if (fee != 0) {
                super._update(from, address(0), fee);
                value -= fee;
            }
        }
        super._update(from, to, value);
    }
}
