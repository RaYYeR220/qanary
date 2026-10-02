// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PackedUserOperation} from "@openzeppelin/contracts/interfaces/IERC4337.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {Account as OZAccount} from "@openzeppelin/contracts/account/Account.sol";
import {Execution} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {QanaryAccount} from "../src/oz/QanaryAccount.sol";
import {QanaryMultisigAccount} from "../src/oz/QanaryMultisigAccount.sol";
import {QanaryAccountFactory} from "../src/oz/QanaryAccountFactory.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";

contract Target {
    uint256 public value;

    function set(uint256 v) external {
        value = v;
    }
}

contract QanaryAccountTest is Test {
    MockVerifier verifier;
    QanaryAccountFactory factory;
    Target target;

    bytes keyA = hex"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    bytes keyB = hex"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    bytes keyC = hex"cccccccccccccccccccccccccccccccccccccccc";

    // ERC-7821 batch mode: callType 0x01, execType 0x00, selector 0, payload 0.
    bytes32 constant BATCH_MODE = 0x0100000000000000000000000000000000000000000000000000000000000000;

    function setUp() public {
        verifier = new MockVerifier();
        factory = new QanaryAccountFactory();
        target = new Target();
    }

    function _signer(bytes memory key) internal view returns (bytes memory) {
        return abi.encodePacked(address(verifier), key);
    }

    function _sig(bytes memory key, bytes32 h) internal pure returns (bytes memory) {
        return abi.encode(key, h);
    }

    function _single() internal returns (QanaryAccount) {
        return QanaryAccount(payable(factory.createAccount(_signer(keyA), bytes32(uint256(1)))));
    }

    function _op(address sender, bytes memory sig) internal pure returns (PackedUserOperation memory op) {
        op.sender = sender;
        op.signature = sig;
    }

    function test_validateUserOp_validSignature() public {
        QanaryAccount acc = _single();
        bytes32 h = keccak256("userOp");
        vm.prank(address(acc.entryPoint()));
        assertEq(acc.validateUserOp(_op(address(acc), _sig(keyA, h)), h, 0), 0);
    }

    function test_validateUserOp_badSignature() public {
        QanaryAccount acc = _single();
        bytes32 h = keccak256("userOp");
        vm.prank(address(acc.entryPoint()));
        assertEq(acc.validateUserOp(_op(address(acc), _sig(keyB, h)), h, 0), 1);
    }

    function test_validateUserOp_onlyEntryPoint() public {
        QanaryAccount acc = _single();
        bytes32 h = keccak256("userOp");
        PackedUserOperation memory op = _op(address(acc), _sig(keyA, h));
        vm.expectRevert(abi.encodeWithSelector(OZAccount.AccountUnauthorized.selector, address(this)));
        acc.validateUserOp(op, h, 0);
    }

    function test_isValidSignature_erc7739PersonalSign() public {
        QanaryAccount acc = _single();
        bytes32 contents = keccak256("hello");
        (, string memory name, string memory version, uint256 chainId, address vc,,) = acc.eip712Domain();
        bytes32 domainSep = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                vc
            )
        );
        bytes32 structHash = keccak256(abi.encode(keccak256("PersonalSign(bytes prefixed)"), contents));
        bytes32 wrapped = MessageHashUtils.toTypedDataHash(domainSep, structHash);
        assertEq(acc.isValidSignature(contents, _sig(keyA, wrapped)), IERC1271.isValidSignature.selector);
        // a signature over the raw (unwrapped) hash must not validate
        assertEq(acc.isValidSignature(contents, _sig(keyA, contents)), bytes4(0xffffffff));
    }

    function test_execute_batchFromEntryPoint() public {
        QanaryAccount acc = _single();
        Execution[] memory calls = new Execution[](1);
        calls[0] = Execution(address(target), 0, abi.encodeCall(Target.set, (42)));
        vm.prank(address(acc.entryPoint()));
        acc.execute(BATCH_MODE, abi.encode(calls));
        assertEq(target.value(), 42);

        vm.expectRevert(abi.encodeWithSelector(OZAccount.AccountUnauthorized.selector, address(this)));
        acc.execute(BATCH_MODE, abi.encode(calls));
    }

    function test_reinitializeReverts() public {
        QanaryAccount acc = _single();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        acc.initialize(_signer(keyB));
    }

    function test_implementationCannotBeInitialized() public {
        QanaryAccount impl = QanaryAccount(payable(factory.singleImpl()));
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(_signer(keyB));
    }

    function test_signer_isStored() public {
        assertEq(_single().signer(), _signer(keyA));
    }

    function test_factory_predictionMatchesAndEmits() public {
        bytes memory s = _signer(keyA);
        address predicted = factory.predictAccount(s, bytes32(uint256(7)));
        vm.expectEmit(true, false, false, true);
        emit QanaryAccountFactory.AccountCreated(predicted, false);
        assertEq(factory.createAccount(s, bytes32(uint256(7))), predicted);
        assertTrue(predicted.code.length > 0);
        // different signer, same salt -> different address
        assertTrue(factory.predictAccount(_signer(keyB), bytes32(uint256(7))) != predicted);
    }

    // ---------------- multisig ----------------

    function _multisig() internal returns (QanaryMultisigAccount) {
        bytes[] memory signers = new bytes[](3);
        signers[0] = _signer(keyA);
        signers[1] = _signer(keyB);
        signers[2] = _signer(keyC);
        uint64[] memory weights = new uint64[](3);
        weights[0] = 1;
        weights[1] = 1;
        weights[2] = 1;
        return QanaryMultisigAccount(payable(factory.createMultisig(signers, weights, 2, bytes32(uint256(2)))));
    }

    function _multiSig(bytes32 h, bytes[] memory keys) internal view returns (bytes memory) {
        bytes[] memory signers = new bytes[](keys.length);
        bytes[] memory sigs = new bytes[](keys.length);
        for (uint256 i; i < keys.length; ++i) {
            signers[i] = _signer(keys[i]);
            sigs[i] = _sig(keys[i], h);
        }
        return abi.encode(signers, sigs);
    }

    function test_multisig_twoOfThreePasses() public {
        QanaryMultisigAccount acc = _multisig();
        bytes32 h = keccak256("op");
        bytes[] memory keys = new bytes[](2);
        keys[0] = keyA;
        keys[1] = keyC;
        vm.prank(address(acc.entryPoint()));
        assertEq(acc.validateUserOp(_op(address(acc), _multiSig(h, keys)), h, 0), 0);
    }

    function test_multisig_oneOfThreeFails() public {
        QanaryMultisigAccount acc = _multisig();
        bytes32 h = keccak256("op");
        bytes[] memory keys = new bytes[](1);
        keys[0] = keyA;
        vm.prank(address(acc.entryPoint()));
        assertEq(acc.validateUserOp(_op(address(acc), _multiSig(h, keys)), h, 0), 1);
    }

    function test_multisig_weighted() public {
        bytes[] memory signers = new bytes[](2);
        signers[0] = _signer(keyA);
        signers[1] = _signer(keyB);
        uint64[] memory weights = new uint64[](2);
        weights[0] = 3;
        weights[1] = 1;
        QanaryMultisigAccount acc =
            QanaryMultisigAccount(payable(factory.createMultisig(signers, weights, 3, bytes32(0))));
        bytes32 h = keccak256("op");
        bytes[] memory heavy = new bytes[](1);
        heavy[0] = keyA;
        bytes[] memory light = new bytes[](1);
        light[0] = keyB;
        vm.startPrank(address(acc.entryPoint()));
        assertEq(acc.validateUserOp(_op(address(acc), _multiSig(h, heavy)), h, 0), 0);
        assertEq(acc.validateUserOp(_op(address(acc), _multiSig(h, light)), h, 0), 1);
        vm.stopPrank();
    }

    function test_multisig_reinitializeReverts() public {
        QanaryMultisigAccount acc = _multisig();
        bytes[] memory signers = new bytes[](1);
        signers[0] = _signer(keyA);
        uint64[] memory weights = new uint64[](1);
        weights[0] = 1;
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        acc.initialize(signers, weights, 1);
    }

    function test_multisig_factoryPrediction() public {
        bytes[] memory signers = new bytes[](2);
        signers[0] = _signer(keyA);
        signers[1] = _signer(keyB);
        uint64[] memory weights = new uint64[](2);
        weights[0] = 1;
        weights[1] = 1;
        address predicted = factory.predictMultisig(signers, weights, 2, bytes32(uint256(9)));
        vm.expectEmit(true, false, false, true);
        emit QanaryAccountFactory.AccountCreated(predicted, true);
        assertEq(factory.createMultisig(signers, weights, 2, bytes32(uint256(9))), predicted);
        // threshold is bound into the address
        assertTrue(factory.predictMultisig(signers, weights, 1, bytes32(uint256(9))) != predicted);
    }
}
