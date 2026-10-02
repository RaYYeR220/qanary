// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IEntryPoint, PackedUserOperation} from "@openzeppelin/contracts/interfaces/IERC4337.sol";
import {Execution} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {IERC7821} from "@openzeppelin/contracts/interfaces/draft-IERC7821.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArbOneFork} from "./ArbOneFork.sol";
import {KeyStore} from "../../src/KeyStore.sol";
import {QanaryAccount} from "../../src/oz/QanaryAccount.sol";
import {QanaryAccountFactory} from "../../src/oz/QanaryAccountFactory.sol";
import {MockVerifier} from "../mocks/MockVerifier.sol";

/// @title OzAccountForkTest
/// @notice `QanaryAccount` (OpenZeppelin 5.7 `Account` + `SignerERC7913`) through the real EntryPoint it
///         targets on an Arbitrum One fork: counterfactual deployment by `QanaryAccountFactory` from
///         `initCode` and PQ-signed user operations moving real USDG.
/// @dev OpenZeppelin 5.7 `Account.entryPoint()` is EntryPoint v0.9 (`ERC4337Utils.ENTRYPOINT_V09`), which
///      is deployed on Arbitrum One, so no override is needed.
contract OzAccountForkTest is ArbOneFork {
    /// @dev ERC-7821 batch mode: call type 0x01, default exec type, no selector or payload.
    bytes32 internal constant BATCH_MODE = bytes32(uint256(1) << 248);
    uint256 internal constant FUNDING = 1_000e6;

    MockVerifier internal mv;
    KeyStore internal ks;
    QanaryAccountFactory internal factory;
    address internal keyPtr;
    address internal bob;

    function setUp() public {
        if (!_fork()) return;
        mv = new MockVerifier();
        ks = new KeyStore();
        factory = new QanaryAccountFactory();
        keyPtr = ks.store(abi.encodePacked(uint8(2), keccak256("mock ML-DSA-44 public key")));
        bob = makeAddr("bob");
    }

    function _signer() internal view returns (bytes memory) {
        return abi.encodePacked(address(mv), keyPtr);
    }

    function _transfer(address to, uint256 amount) internal pure returns (bytes memory) {
        Execution[] memory calls = new Execution[](1);
        calls[0] = Execution(USDG, 0, abi.encodeCall(IERC20.transfer, (to, amount)));
        return abi.encodeCall(IERC7821.execute, (BATCH_MODE, abi.encode(calls)));
    }

    function _op(address acct, bytes memory initCode, bytes memory callData)
        internal
        view
        returns (PackedUserOperation memory op)
    {
        op = _userOp(acct, IEntryPoint(ENTRYPOINT_V09).getNonce(acct, 0), initCode, callData);
        op.signature = _pqSig(keyPtr, _userOpHash(ENTRYPOINT_V09, op));
    }

    /// @dev First user operation: `initCode` deploys the clone, callData pays bob.
    function _deploy(bytes32 salt) internal returns (address acct, uint256 gasUsed) {
        acct = factory.predictAccount(_signer(), salt);
        assertEq(acct.code.length, 0);
        deal(USDG, acct, FUNDING);
        vm.deal(acct, 1 ether);
        bytes memory initCode =
            abi.encodePacked(address(factory), abi.encodeCall(QanaryAccountFactory.createAccount, (_signer(), salt)));
        gasUsed = _handleOp(ENTRYPOINT_V09, _op(acct, initCode, _transfer(bob, 100e6)));
    }

    function test_entryPointV09_isTargetAndDeployed() public onlyFork {
        assertEq(address(QanaryAccount(payable(factory.singleImpl())).entryPoint()), ENTRYPOINT_V09);
        assertGt(ENTRYPOINT_V09.code.length, 0, "EntryPoint v0.9 not deployed on Arbitrum One");
    }

    function test_firstUserOp_deploysAccount_movesUsdg() public onlyFork {
        uint256 bobBefore = IERC20(USDG).balanceOf(bob);
        (address acct, uint256 gasUsed) = _deploy(bytes32(uint256(1)));

        assertGt(acct.code.length, 0);
        assertEq(QanaryAccount(payable(acct)).signer(), _signer());
        assertEq(IERC20(USDG).balanceOf(bob) - bobBefore, 100e6);
        assertEq(IEntryPoint(ENTRYPOINT_V09).getNonce(acct, 0), 1);
        emit log_named_uint("gas: handleOps v0.9, deploy QanaryAccount + USDG transfer", gasUsed);
    }

    function test_handleOps_pqUserOp_transfersUsdg() public onlyFork {
        (address acct,) = _deploy(bytes32(uint256(2)));
        uint256 bobBefore = IERC20(USDG).balanceOf(bob);
        PackedUserOperation memory op = _op(acct, "", _transfer(bob, 250e6));
        uint256 size = _handleOpsCalldataSize(op);
        address[] memory touched = new address[](5);
        touched[0] = acct;
        touched[1] = factory.singleImpl();
        touched[2] = address(mv);
        touched[3] = keyPtr;
        touched[4] = bob;
        _cool(touched);
        uint256 gasUsed = _handleOp(ENTRYPOINT_V09, op);

        assertEq(IERC20(USDG).balanceOf(bob) - bobBefore, 250e6);
        assertEq(IERC20(USDG).balanceOf(acct), FUNDING - 350e6);
        emit log_named_uint("gas: handleOps v0.9, PQ-signed USDG transfer (mock verifier)", gasUsed);
        emit log_named_uint("bytes: handleOps calldata (mock PQ signature)", size);
    }

    function test_handleOps_tamperedSignature_AA24() public onlyFork {
        (address acct,) = _deploy(bytes32(uint256(3)));
        PackedUserOperation memory op = _op(acct, "", _transfer(bob, 1e6));
        bytes memory sig = op.signature;
        sig[sig.length - 1] ^= 0x01;
        op.signature = sig;
        _expectHandleOpRevert(
            ENTRYPOINT_V09, op, abi.encodeWithSelector(IEntryPoint.FailedOp.selector, 0, "AA24 signature error")
        );
    }
}
