// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IEntryPoint, PackedUserOperation} from "@openzeppelin/contracts/interfaces/IERC4337.sol";

/// @notice `getUserOpHash`, which the OpenZeppelin `IEntryPoint` does not declare. Same selector on
///         EntryPoint v0.7, v0.8 and v0.9.
interface IEntryPointUserOpHash {
    function getUserOpHash(PackedUserOperation calldata userOp) external view returns (bytes32);
}

/// @title ArbOneFork
/// @notice Base of the Arbitrum One fork suite (`test/fork`): forks Arbitrum One at a pinned block and
///         builds ERC-4337 user operations for the EntryPoint deployments there.
/// @dev The suite only runs when `ARB_ONE_RPC` is set; under an offline `forge test` every test is
///      skipped. The pinned block needs an RPC that serves historical state (arb1.arbitrum.io prunes it
///      after a few hours). `ARB_ONE_FORK_BLOCK` overrides the pin, e.g. to fork a recent block on a
///      pruning RPC. All protocol contracts under test (Kernel, EntryPoint, Safe, USDG) are the real
///      deployments; only Qanary's own contracts and the mock post-quantum verifier are deployed in-test.
///      Plain forge cannot execute Stylus programs, so post-quantum signatures use `MockVerifier`
///      (valid iff `signature == abi.encode(key, hash)`).
abstract contract ArbOneFork is Test {
    /// @dev Arbitrum One block 511,050,000 (2026-10-02 17:51:52 UTC).
    uint256 internal constant PINNED_BLOCK = 511_050_000;

    /// @dev Global Dollar (USDG), 6 decimals.
    address internal constant USDG = 0x004B506865409877C9fA29bfb1ebA929984B9bbC;
    /// @dev Canonical ERC-4337 EntryPoint v0.7.
    address internal constant ENTRYPOINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    /// @dev Canonical ERC-4337 EntryPoint v0.9 (the one OpenZeppelin 5.7 `Account` targets).
    address internal constant ENTRYPOINT_V09 = 0x433709009B8330FDa32311DF1C2AFA402eD8D009;
    bytes32 internal constant ERC1967_IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    uint256 internal constant VERIFICATION_GAS = 1_000_000;
    uint256 internal constant CALL_GAS = 1_000_000;
    uint256 internal constant PRE_VERIFICATION_GAS = 60_000;
    uint256 internal constant MAX_FEE = 0.1 gwei;

    /// @dev Whether `setUp` forked Arbitrum One.
    bool internal forked;
    address internal bundler;

    /// @dev Skips the test unless the suite forked Arbitrum One.
    modifier onlyFork() {
        vm.skip(!forked, "Arbitrum One fork test: set ARB_ONE_RPC (archive-capable for the pinned block)");
        _;
    }

    /// @dev Forks Arbitrum One if `ARB_ONE_RPC` is set. Returns whether it did.
    function _fork() internal returns (bool) {
        string memory rpc = vm.envOr("ARB_ONE_RPC", string(""));
        if (bytes(rpc).length == 0) return false;
        vm.createSelectFork(rpc, vm.envOr("ARB_ONE_FORK_BLOCK", PINNED_BLOCK));
        assertEq(block.chainid, 42161, "not Arbitrum One");
        bundler = makeAddr("bundler");
        vm.deal(bundler, 1 ether);
        forked = true;
        return true;
    }

    /// @dev Marks `accounts`, both EntryPoints and USDG (proxy and implementation) cold, with their storage,
    ///      so a following call is priced like the first call of a fresh transaction. Logged gas figures are
    ///      call-frame gas: they exclude the 21,000 intrinsic gas and calldata gas, and include one cold
    ///      account access to the EntryPoint that a real bundle transaction (`tx.to`) would not pay.
    ///      Only call this from a test function, never from `setUp`: on a fork (forge 1.8.3), contracts that
    ///      `setUp` deploys and then cools are missing from the state the tests start from.
    function _cool(address[] memory accounts) internal {
        for (uint256 i = 0; i < accounts.length; ++i) {
            vm.cool(accounts[i]);
        }
        vm.cool(ENTRYPOINT_V07);
        vm.cool(ENTRYPOINT_V09);
        vm.cool(USDG);
        vm.cool(address(uint160(uint256(vm.load(USDG, ERC1967_IMPLEMENTATION_SLOT)))));
    }

    // ---------------------------------------------------------------- post-quantum (mock) signing

    /// @dev `MockVerifier` signature by the key stored at `keyPtr` over `hash`.
    function _pqSig(address keyPtr, bytes32 hash) internal pure returns (bytes memory) {
        return abi.encode(abi.encodePacked(keyPtr), hash);
    }

    // ---------------------------------------------------------------- user operations

    function _packHiLo(uint256 hi, uint256 lo) internal pure returns (bytes32) {
        return bytes32((hi << 128) | lo);
    }

    /// @dev Unsigned user operation with fixed gas limits and fees and no paymaster.
    function _userOp(address sender, uint256 nonce, bytes memory initCode, bytes memory callData)
        internal
        pure
        returns (PackedUserOperation memory op)
    {
        op.sender = sender;
        op.nonce = nonce;
        op.initCode = initCode;
        op.callData = callData;
        op.accountGasLimits = _packHiLo(VERIFICATION_GAS, CALL_GAS);
        op.preVerificationGas = PRE_VERIFICATION_GAS;
        op.gasFees = _packHiLo(MAX_FEE, MAX_FEE);
    }

    function _userOpHash(address entryPoint, PackedUserOperation memory op) internal view returns (bytes32) {
        return IEntryPointUserOpHash(entryPoint).getUserOpHash(op);
    }

    function _ops(PackedUserOperation memory op) internal pure returns (PackedUserOperation[] memory ops) {
        ops = new PackedUserOperation[](1);
        ops[0] = op;
    }

    /// @dev Submits `op` from the bundler EOA and returns the `handleOps` call-frame gas.
    function _handleOp(address entryPoint, PackedUserOperation memory op) internal returns (uint256 gasUsed) {
        PackedUserOperation[] memory ops = _ops(op);
        vm.prank(bundler, bundler);
        uint256 g = gasleft();
        IEntryPoint(entryPoint).handleOps(ops, payable(bundler));
        gasUsed = g - gasleft();
    }

    /// @dev Expects `handleOps([op])` from the bundler EOA to revert with `err`.
    function _expectHandleOpRevert(address entryPoint, PackedUserOperation memory op, bytes memory err) internal {
        PackedUserOperation[] memory ops = _ops(op);
        vm.prank(bundler, bundler);
        vm.expectRevert(err);
        IEntryPoint(entryPoint).handleOps(ops, payable(bundler));
    }

    /// @dev Byte length of the `handleOps([op], bundler)` calldata a bundler would submit.
    function _handleOpsCalldataSize(PackedUserOperation memory op) internal view returns (uint256) {
        return abi.encodeCall(IEntryPoint.handleOps, (_ops(op), payable(bundler))).length;
    }
}
