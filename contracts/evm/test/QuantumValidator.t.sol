// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PackedUserOperation} from "@openzeppelin/contracts/interfaces/IERC4337.sol";
import {MODULE_TYPE_VALIDATOR, MODULE_TYPE_EXECUTOR} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {QuantumValidator} from "../src/QuantumValidator.sol";
import {KeyStore} from "../src/KeyStore.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

contract QuantumValidatorTest is Test {
    bytes4 internal constant ERC1271_MAGIC = 0x1626ba7e;
    bytes4 internal constant ERC1271_INVALID = 0xffffffff;
    uint32 internal constant DELAY = 1 days;

    QuantumValidator internal qv;
    MockVerifier internal mv;
    KeyStore internal ks;

    address internal constant ACCOUNT = address(0xA11CE);
    address internal constant ACCOUNT_B = address(0xB0B);
    address internal constant STRANGER = address(0xCAFE);
    /// @dev Codeless address well above the precompile range.
    address internal constant EOA_VERIFIER = address(0xE0A00);

    address internal keyPtr;
    address internal keyPtr2;
    address internal keyPtr3;

    bytes[] internal guardianKeys;
    bytes[] internal guardians;

    function setUp() public {
        qv = new QuantumValidator();
        mv = new MockVerifier();
        ks = new KeyStore();
        keyPtr = ks.store(abi.encodePacked(uint8(1), bytes32("pk-one")));
        keyPtr2 = ks.store(abi.encodePacked(uint8(1), bytes32("pk-two")));
        keyPtr3 = ks.store(abi.encodePacked(uint8(1), bytes32("pk-three")));
        for (uint256 i = 0; i < 3; ++i) {
            guardianKeys.push(abi.encodePacked("guardian-key-", uint8(i)));
            guardians.push(abi.encodePacked(address(mv), guardianKeys[i]));
        }
    }

    // ---------------------------------------------------------------- helpers

    function _sig(address ptr, bytes32 h) internal pure returns (bytes memory) {
        return abi.encode(abi.encodePacked(ptr), h);
    }

    function _installData(address verifier, address ptr, bytes[] memory gs, uint8 threshold, uint32 delay)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(
            QuantumValidator.InstallData({
                verifier: verifier, keyPtr: ptr, guardians: gs, threshold: threshold, delay: delay
            })
        );
    }

    function _install(address account, address ptr) internal {
        bytes memory data = _installData(address(mv), ptr, new bytes[](0), 0, 0);
        vm.prank(account);
        qv.onInstall(data);
    }

    function _installWithGuardians(address account) internal {
        bytes memory data = _installData(address(mv), keyPtr, guardians, 2, DELAY);
        vm.prank(account);
        qv.onInstall(data);
    }

    function _op(address sender, bytes memory signature) internal pure returns (PackedUserOperation memory op) {
        op.sender = sender;
        op.signature = signature;
    }

    function _validate(address caller, bytes32 userOpHash, bytes memory signature) internal returns (uint256) {
        PackedUserOperation memory op = _op(caller, signature);
        vm.prank(caller);
        return qv.validateUserOp(op, userOpHash);
    }

    /// @dev Guardian signatures over the current recovery digest, aligned by index; `false` = abstain.
    function _guardianSigs(address account, address newPtr, bool s0, bool s1, bool s2)
        internal
        view
        returns (bytes[] memory sigs)
    {
        bytes32 d = qv.recoveryDigest(account, address(mv), newPtr);
        sigs = new bytes[](3);
        if (s0) sigs[0] = abi.encode(guardianKeys[0], d);
        if (s1) sigs[1] = abi.encode(guardianKeys[1], d);
        if (s2) sigs[2] = abi.encode(guardianKeys[2], d);
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("QanaryValidator"),
                keccak256("1"),
                block.chainid,
                address(qv)
            )
        );
    }

    /// @dev ERC-7562 "associated" storage of `account`: the slot `account` itself, or
    ///      `keccak256(account ‖ x) + n` with `n <= 128`. `x` ranges over this contract's top-level slots.
    function _isAssociated(address account, bytes32 slot) internal pure returns (bool) {
        if (uint256(slot) == uint256(uint160(account))) return true;
        for (uint256 s = 0; s < 16; ++s) {
            uint256 base = uint256(keccak256(abi.encode(account, s)));
            if (uint256(slot) >= base && uint256(slot) - base <= 128) return true;
        }
        return false;
    }

    function _assertAllAssociated(address account, bytes32[] memory slots) internal pure {
        for (uint256 i = 0; i < slots.length; ++i) {
            assertTrue(_isAssociated(account, slots[i]), "slot not associated with account");
        }
    }

    function _expectInvalidKey(address verifier, address ptr) internal {
        bytes memory data = _installData(verifier, ptr, new bytes[](0), 0, 0);
        vm.prank(ACCOUNT);
        vm.expectRevert(QuantumValidator.InvalidKeyConfig.selector);
        qv.onInstall(data);
    }

    function _expectInvalidGuardians(bytes[] memory gs, uint8 threshold, uint32 delay) internal {
        bytes memory data = _installData(address(mv), keyPtr, gs, threshold, delay);
        vm.prank(ACCOUNT);
        vm.expectRevert(QuantumValidator.InvalidGuardianConfig.selector);
        qv.onInstall(data);
    }

    // ---------------------------------------------------------------- install

    function test_constants() public view {
        assertEq(qv.ACCOUNT_MESSAGE_TYPEHASH(), keccak256("AccountMessage(address account,bytes32 hash)"));
        assertEq(
            qv.RECOVERY_TYPEHASH(), keccak256("Recovery(address account,address verifier,address keyPtr,uint256 nonce)")
        );
        assertEq(qv.MIN_RECOVERY_DELAY(), 1 hours);
    }

    function test_isModuleType() public view {
        assertTrue(qv.isModuleType(MODULE_TYPE_VALIDATOR));
        assertFalse(qv.isModuleType(MODULE_TYPE_EXECUTOR));
        assertFalse(qv.isModuleType(0));
    }

    function test_onInstall_setsConfigAndEmits() public {
        assertFalse(qv.isInitialized(ACCOUNT));
        bytes memory data = _installData(address(mv), keyPtr, new bytes[](0), 0, 0);

        vm.expectEmit(true, false, false, true, address(qv));
        emit QuantumValidator.KeyConfigured(ACCOUNT, address(mv), keyPtr);
        vm.prank(ACCOUNT);
        qv.onInstall(data);

        assertTrue(qv.isInitialized(ACCOUNT));
        QuantumValidator.Config memory c = qv.configOf(ACCOUNT);
        assertEq(c.verifier, address(mv));
        assertEq(c.keyPtr, keyPtr);
        (bytes[] memory gs, uint8 threshold, uint32 delay) = qv.guardiansOf(ACCOUNT);
        assertEq(gs.length, 0);
        assertEq(threshold, 0);
        assertEq(delay, 0);
        assertFalse(qv.isInitialized(ACCOUNT_B));
    }

    function test_onInstall_withGuardians() public {
        bytes memory data = _installData(address(mv), keyPtr, guardians, 2, DELAY);

        vm.expectEmit(true, false, false, true, address(qv));
        emit QuantumValidator.KeyConfigured(ACCOUNT, address(mv), keyPtr);
        vm.expectEmit(true, false, false, true, address(qv));
        emit QuantumValidator.GuardiansSet(ACCOUNT, 3, 2, DELAY);
        vm.prank(ACCOUNT);
        qv.onInstall(data);

        (bytes[] memory gs, uint8 threshold, uint32 delay) = qv.guardiansOf(ACCOUNT);
        assertEq(gs.length, 3);
        for (uint256 i = 0; i < 3; ++i) {
            assertEq(gs[i], guardians[i]);
        }
        assertEq(threshold, 2);
        assertEq(delay, DELAY);
    }

    function test_onInstall_twice_reverts() public {
        _install(ACCOUNT, keyPtr);
        bytes memory data = _installData(address(mv), keyPtr2, new bytes[](0), 0, 0);
        vm.prank(ACCOUNT);
        vm.expectRevert(abi.encodeWithSelector(QuantumValidator.AlreadyInitialized.selector, ACCOUNT));
        qv.onInstall(data);
    }

    function test_onInstall_zeroVerifier_reverts() public {
        bytes memory data = _installData(address(0), keyPtr, new bytes[](0), 0, 0);
        vm.prank(ACCOUNT);
        vm.expectRevert(QuantumValidator.InvalidKeyConfig.selector);
        qv.onInstall(data);
    }

    function test_onInstall_codelessKeyPtr_reverts() public {
        bytes memory data = _installData(address(mv), address(0xDEAD), new bytes[](0), 0, 0);
        vm.prank(ACCOUNT);
        vm.expectRevert(QuantumValidator.InvalidKeyConfig.selector);
        qv.onInstall(data);
    }

    function test_onInstall_oneByteKeyPtr_reverts() public {
        address stub = address(0xBEEF);
        vm.etch(stub, hex"00");
        bytes memory data = _installData(address(mv), stub, new bytes[](0), 0, 0);
        vm.prank(ACCOUNT);
        vm.expectRevert(QuantumValidator.InvalidKeyConfig.selector);
        qv.onInstall(data);
    }

    function test_onInstall_twoByteKeyPtr_accepted() public {
        address stub = address(0xBEEF);
        vm.etch(stub, hex"0001");
        _install(ACCOUNT, stub);
        assertEq(qv.configOf(ACCOUNT).keyPtr, stub);
    }

    function test_onInstall_thresholdAboveCount_reverts() public {
        _expectInvalidGuardians(guardians, 4, DELAY);
    }

    function test_onInstall_tooManyGuardians_reverts() public {
        bytes[] memory gs = new bytes[](17);
        for (uint256 i = 0; i < gs.length; ++i) {
            gs[i] = abi.encodePacked(address(mv), "g", uint8(i));
        }
        _expectInvalidGuardians(gs, 1, DELAY);
    }

    function test_onInstall_sixteenGuardians_accepted() public {
        bytes[] memory gs = new bytes[](16);
        for (uint256 i = 0; i < gs.length; ++i) {
            gs[i] = abi.encodePacked(address(mv), "g", uint8(i));
        }
        bytes memory data = _installData(address(mv), keyPtr, gs, 16, qv.MIN_RECOVERY_DELAY());
        vm.prank(ACCOUNT);
        qv.onInstall(data);
        (bytes[] memory stored, uint8 threshold,) = qv.guardiansOf(ACCOUNT);
        assertEq(stored.length, 16);
        assertEq(threshold, 16);
    }

    function test_onInstall_delayBelowMinimum_reverts() public {
        _expectInvalidGuardians(guardians, 2, 1 hours - 1);
    }

    function test_onInstall_shortGuardian_reverts() public {
        bytes[] memory gs = new bytes[](2);
        gs[0] = guardians[0];
        gs[1] = abi.encodePacked(address(mv)); // exactly 20 bytes: no key
        _expectInvalidGuardians(gs, 1, DELAY);
    }

    function test_onInstall_guardiansWithZeroThreshold_reverts() public {
        _expectInvalidGuardians(guardians, 0, DELAY);
    }

    function test_onInstall_duplicateGuardian_reverts() public {
        bytes[] memory gs = new bytes[](3);
        gs[0] = guardians[0];
        gs[1] = guardians[1];
        gs[2] = guardians[0];
        _expectInvalidGuardians(gs, 2, DELAY);
    }

    // ---------------------------------------------------------------- validateUserOp

    function test_validateUserOp_validSignature_returns0() public {
        _install(ACCOUNT, keyPtr);
        bytes32 h = keccak256("user-op");
        assertEq(_validate(ACCOUNT, h, _sig(keyPtr, h)), 0);
    }

    function test_validateUserOp_invalidSignature_returns1() public {
        _install(ACCOUNT, keyPtr);
        bytes32 h = keccak256("user-op");
        assertEq(_validate(ACCOUNT, h, _sig(keyPtr, keccak256("other-op"))), 1);
        assertEq(_validate(ACCOUNT, h, _sig(keyPtr2, h)), 1);
        assertEq(_validate(ACCOUNT, h, ""), 1);
    }

    function test_validateUserOp_verifierReverts_returns1() public {
        _install(ACCOUNT, keyPtr);
        mv.revertOn(abi.encodePacked(keyPtr));
        bytes32 h = keccak256("user-op");
        assertEq(_validate(ACCOUNT, h, _sig(keyPtr, h)), 1);
    }

    function test_validateUserOp_uninstalledAccount_returns1() public {
        _install(ACCOUNT, keyPtr);
        bytes32 h = keccak256("user-op");
        // ACCOUNT_B never installed the module; a signature valid for ACCOUNT's key must not pass.
        assertEq(_validate(ACCOUNT_B, h, _sig(keyPtr, h)), 1);
    }

    function test_validateUserOp_readsCallerConfigNotOpSender() public {
        _install(ACCOUNT, keyPtr);
        bytes32 h = keccak256("user-op");
        PackedUserOperation memory op = _op(ACCOUNT, _sig(keyPtr, h)); // claims to be ACCOUNT
        vm.prank(ACCOUNT_B);
        assertEq(qv.validateUserOp(op, h), 1);
    }

    function test_validateUserOp_gas() public {
        _install(ACCOUNT, keyPtr);
        bytes32 h = keccak256("user-op");
        PackedUserOperation memory op = _op(ACCOUNT, _sig(keyPtr, h));
        vm.prank(ACCOUNT);
        uint256 result = qv.validateUserOp(op, h);
        assertEq(result, 0);
        emit log_named_uint("validateUserOp frame gas (mock verifier)", vm.lastCallGas().gasTotalUsed);
    }

    // ---------------------------------------------------------------- ERC-1271

    function test_accountDigest_matchesEip712() public view {
        bytes32 h = keccak256("message");
        bytes32 structHash = keccak256(abi.encode(qv.ACCOUNT_MESSAGE_TYPEHASH(), ACCOUNT, h));
        bytes32 expected = keccak256(abi.encodePacked(hex"1901", _domainSeparator(), structHash));
        assertEq(qv.accountDigest(ACCOUNT, h), expected);
    }

    function test_isValidSignatureWithSender_valid() public {
        _install(ACCOUNT, keyPtr);
        bytes32 h = keccak256("message");
        bytes memory sig = _sig(keyPtr, qv.accountDigest(ACCOUNT, h));
        vm.prank(ACCOUNT);
        assertEq(qv.isValidSignatureWithSender(STRANGER, h, sig), ERC1271_MAGIC);
    }

    function test_isValidSignatureWithSender_rawHash_invalid() public {
        _install(ACCOUNT, keyPtr);
        bytes32 h = keccak256("message");
        vm.prank(ACCOUNT);
        assertEq(qv.isValidSignatureWithSender(STRANGER, h, _sig(keyPtr, h)), ERC1271_INVALID);
    }

    function test_isValidSignatureWithSender_crossAccountReplay_invalid() public {
        _install(ACCOUNT, keyPtr);
        _install(ACCOUNT_B, keyPtr); // same key on both accounts
        bytes32 h = keccak256("message");
        bytes memory sigA = _sig(keyPtr, qv.accountDigest(ACCOUNT, h));
        bytes memory sigB = _sig(keyPtr, qv.accountDigest(ACCOUNT_B, h));

        vm.prank(ACCOUNT_B);
        assertEq(qv.isValidSignatureWithSender(STRANGER, h, sigA), ERC1271_INVALID);
        vm.prank(ACCOUNT_B);
        assertEq(qv.isValidSignatureWithSender(STRANGER, h, sigB), ERC1271_MAGIC);
    }

    function test_isValidSignatureWithSender_uninitialized_invalid() public {
        bytes32 h = keccak256("message");
        bytes memory sig = _sig(keyPtr, qv.accountDigest(ACCOUNT, h));
        vm.prank(ACCOUNT);
        assertEq(qv.isValidSignatureWithSender(STRANGER, h, sig), ERC1271_INVALID);
    }

    function test_isValidSignatureWithSender_verifierReverts_invalid() public {
        _install(ACCOUNT, keyPtr);
        mv.revertOn(abi.encodePacked(keyPtr));
        bytes32 h = keccak256("message");
        bytes memory sig = _sig(keyPtr, qv.accountDigest(ACCOUNT, h));
        vm.prank(ACCOUNT);
        assertEq(qv.isValidSignatureWithSender(STRANGER, h, sig), ERC1271_INVALID);
    }

    // ---------------------------------------------------------------- rotateKey

    function test_rotateKey_updatesConfigAndEmits() public {
        _install(ACCOUNT, keyPtr);

        vm.expectEmit(true, false, false, true, address(qv));
        emit QuantumValidator.KeyConfigured(ACCOUNT, address(mv), keyPtr2);
        vm.prank(ACCOUNT);
        qv.rotateKey(address(mv), keyPtr2);

        assertEq(qv.configOf(ACCOUNT).keyPtr, keyPtr2);
        bytes32 h = keccak256("user-op");
        assertEq(_validate(ACCOUNT, h, _sig(keyPtr, h)), 1);
        assertEq(_validate(ACCOUNT, h, _sig(keyPtr2, h)), 0);
    }

    function test_rotateKey_onlyConfiguresCaller() public {
        _install(ACCOUNT, keyPtr);
        _install(ACCOUNT_B, keyPtr);

        vm.prank(ACCOUNT_B);
        qv.rotateKey(address(mv), keyPtr2);

        assertEq(qv.configOf(ACCOUNT).keyPtr, keyPtr);
        assertEq(qv.configOf(ACCOUNT_B).keyPtr, keyPtr2);
        bytes32 h = keccak256("user-op");
        assertEq(_validate(ACCOUNT, h, _sig(keyPtr, h)), 0);
    }

    function test_rotateKey_uninitialized_reverts() public {
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(QuantumValidator.NotInitialized.selector, STRANGER));
        qv.rotateKey(address(mv), keyPtr2);
    }

    function test_rotateKey_invalidConfig_reverts() public {
        _install(ACCOUNT, keyPtr);
        vm.prank(ACCOUNT);
        vm.expectRevert(QuantumValidator.InvalidKeyConfig.selector);
        qv.rotateKey(address(0), keyPtr2);
        vm.prank(ACCOUNT);
        vm.expectRevert(QuantumValidator.InvalidKeyConfig.selector);
        qv.rotateKey(address(mv), address(0xDEAD));
    }

    function test_rotateKey_clearsPendingRecovery() public {
        _installWithGuardians(ACCOUNT);
        bytes[] memory sigs = _guardianSigs(ACCOUNT, keyPtr2, true, true, false);
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);
        assertGt(qv.pendingRecoveryOf(ACCOUNT).eta, 0);

        vm.expectEmit(true, false, false, true, address(qv));
        emit QuantumValidator.RecoveryCancelled(ACCOUNT);
        vm.prank(ACCOUNT);
        qv.rotateKey(address(mv), keyPtr3);

        QuantumValidator.PendingRecovery memory p = qv.pendingRecoveryOf(ACCOUNT);
        assertEq(p.eta, 0);
        assertEq(p.keyPtr, address(0));
        vm.expectRevert(QuantumValidator.NoPendingRecovery.selector);
        qv.executeRecovery(ACCOUNT);
    }

    // ---------------------------------------------------------------- setGuardians

    function test_setGuardians_updatesAndEmits() public {
        _install(ACCOUNT, keyPtr);
        vm.expectEmit(true, false, false, true, address(qv));
        emit QuantumValidator.GuardiansSet(ACCOUNT, 3, 3, 2 days);
        vm.prank(ACCOUNT);
        qv.setGuardians(guardians, 3, 2 days);

        (bytes[] memory gs, uint8 threshold, uint32 delay) = qv.guardiansOf(ACCOUNT);
        assertEq(gs.length, 3);
        assertEq(gs[2], guardians[2]);
        assertEq(threshold, 3);
        assertEq(delay, 2 days);
    }

    function test_setGuardians_canRemoveAll() public {
        _installWithGuardians(ACCOUNT);
        vm.prank(ACCOUNT);
        qv.setGuardians(new bytes[](0), 0, 0);
        (bytes[] memory gs, uint8 threshold, uint32 delay) = qv.guardiansOf(ACCOUNT);
        assertEq(gs.length, 0);
        assertEq(threshold, 0);
        assertEq(delay, 0);
    }

    function test_setGuardians_uninitialized_reverts() public {
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(QuantumValidator.NotInitialized.selector, STRANGER));
        qv.setGuardians(guardians, 2, DELAY);
    }

    function test_setGuardians_invalid_reverts() public {
        _install(ACCOUNT, keyPtr);
        vm.prank(ACCOUNT);
        vm.expectRevert(QuantumValidator.InvalidGuardianConfig.selector);
        qv.setGuardians(guardians, 4, DELAY);
    }

    function test_setGuardians_clearsPendingRecovery() public {
        _installWithGuardians(ACCOUNT);
        bytes[] memory sigs = _guardianSigs(ACCOUNT, keyPtr2, true, true, false);
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);

        vm.prank(ACCOUNT);
        qv.setGuardians(guardians, 3, DELAY);
        assertEq(qv.pendingRecoveryOf(ACCOUNT).eta, 0);
    }

    // ---------------------------------------------------------------- recovery

    function test_recoveryDigest_matchesEip712() public {
        _installWithGuardians(ACCOUNT);
        bytes32 structHash = keccak256(abi.encode(qv.RECOVERY_TYPEHASH(), ACCOUNT, address(mv), keyPtr2, uint256(0)));
        bytes32 expected = keccak256(abi.encodePacked(hex"1901", _domainSeparator(), structHash));
        assertEq(qv.recoveryDigest(ACCOUNT, address(mv), keyPtr2), expected);
    }

    function test_proposeRecovery_oneSignature_reverts() public {
        _installWithGuardians(ACCOUNT);
        bytes[] memory sigs = _guardianSigs(ACCOUNT, keyPtr2, false, true, false);
        vm.expectRevert(abi.encodeWithSelector(QuantumValidator.InsufficientGuardianSignatures.selector, 1, 2));
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);
    }

    function test_proposeRecovery_duplicatedSignatureCountsOnce() public {
        _installWithGuardians(ACCOUNT);
        bytes[] memory sigs = _guardianSigs(ACCOUNT, keyPtr2, true, false, false);
        sigs[1] = sigs[0]; // guardian 0's signature replayed in guardian 1's slot
        sigs[2] = sigs[0];
        vm.expectRevert(abi.encodeWithSelector(QuantumValidator.InsufficientGuardianSignatures.selector, 1, 2));
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);
    }

    function test_proposeRecovery_setsPendingAndEmits() public {
        _installWithGuardians(ACCOUNT);
        bytes[] memory sigs = _guardianSigs(ACCOUNT, keyPtr2, true, false, true);
        uint48 eta = uint48(block.timestamp + DELAY);

        vm.expectEmit(true, false, false, true, address(qv));
        emit QuantumValidator.RecoveryProposed(ACCOUNT, address(mv), keyPtr2, eta);
        vm.prank(STRANGER); // anyone may relay guardian approvals
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);

        QuantumValidator.PendingRecovery memory p = qv.pendingRecoveryOf(ACCOUNT);
        assertEq(p.verifier, address(mv));
        assertEq(p.keyPtr, keyPtr2);
        assertEq(p.eta, eta);
        // Config is untouched until execution.
        assertEq(qv.configOf(ACCOUNT).keyPtr, keyPtr);
    }

    function test_executeRecovery_beforeEta_reverts() public {
        _installWithGuardians(ACCOUNT);
        bytes[] memory sigs = _guardianSigs(ACCOUNT, keyPtr2, true, true, false);
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);
        uint48 eta = qv.pendingRecoveryOf(ACCOUNT).eta;

        vm.warp(eta - 1);
        vm.expectRevert(abi.encodeWithSelector(QuantumValidator.RecoveryNotReady.selector, eta));
        qv.executeRecovery(ACCOUNT);
    }

    function test_executeRecovery_afterEta_swapsKey() public {
        _installWithGuardians(ACCOUNT);
        bytes[] memory sigs = _guardianSigs(ACCOUNT, keyPtr2, true, true, false);
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);
        vm.warp(qv.pendingRecoveryOf(ACCOUNT).eta);

        vm.expectEmit(true, false, false, true, address(qv));
        emit QuantumValidator.KeyConfigured(ACCOUNT, address(mv), keyPtr2);
        vm.prank(STRANGER); // anyone may execute once the delay has elapsed
        qv.executeRecovery(ACCOUNT);

        assertEq(qv.configOf(ACCOUNT).keyPtr, keyPtr2);
        assertEq(qv.pendingRecoveryOf(ACCOUNT).eta, 0);
        bytes32 h = keccak256("user-op");
        assertEq(_validate(ACCOUNT, h, _sig(keyPtr, h)), 1);
        assertEq(_validate(ACCOUNT, h, _sig(keyPtr2, h)), 0);
        // Guardians survive recovery.
        (bytes[] memory gs, uint8 threshold,) = qv.guardiansOf(ACCOUNT);
        assertEq(gs.length, 3);
        assertEq(threshold, 2);
    }

    function test_executeRecovery_noPending_reverts() public {
        _installWithGuardians(ACCOUNT);
        vm.expectRevert(QuantumValidator.NoPendingRecovery.selector);
        qv.executeRecovery(ACCOUNT);
    }

    function test_cancelRecovery_clearsPending() public {
        _installWithGuardians(ACCOUNT);
        bytes[] memory sigs = _guardianSigs(ACCOUNT, keyPtr2, true, true, false);
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);

        vm.expectEmit(true, false, false, true, address(qv));
        emit QuantumValidator.RecoveryCancelled(ACCOUNT);
        vm.prank(ACCOUNT);
        qv.cancelRecovery();

        assertEq(qv.pendingRecoveryOf(ACCOUNT).eta, 0);
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(QuantumValidator.NoPendingRecovery.selector);
        qv.executeRecovery(ACCOUNT);
        assertEq(qv.configOf(ACCOUNT).keyPtr, keyPtr);
    }

    function test_cancelRecovery_onlyAffectsCaller() public {
        _installWithGuardians(ACCOUNT);
        bytes[] memory sigs = _guardianSigs(ACCOUNT, keyPtr2, true, true, false);
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);

        vm.prank(STRANGER);
        vm.expectRevert(QuantumValidator.NoPendingRecovery.selector);
        qv.cancelRecovery();
        assertGt(qv.pendingRecoveryOf(ACCOUNT).eta, 0);
    }

    function test_cancelRecovery_noPending_reverts() public {
        _installWithGuardians(ACCOUNT);
        vm.prank(ACCOUNT);
        vm.expectRevert(QuantumValidator.NoPendingRecovery.selector);
        qv.cancelRecovery();
    }

    function test_proposeRecovery_nonceIncrements_oldSignaturesNotReplayable() public {
        _installWithGuardians(ACCOUNT);
        bytes32 digestBefore = qv.recoveryDigest(ACCOUNT, address(mv), keyPtr2);
        bytes[] memory sigs = _guardianSigs(ACCOUNT, keyPtr2, true, true, false);
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);
        assertTrue(qv.recoveryDigest(ACCOUNT, address(mv), keyPtr2) != digestBefore);

        vm.prank(ACCOUNT);
        qv.cancelRecovery();

        vm.expectRevert(abi.encodeWithSelector(QuantumValidator.InsufficientGuardianSignatures.selector, 0, 2));
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);
    }

    function test_proposeRecovery_overwritesPending() public {
        _installWithGuardians(ACCOUNT);
        bytes[] memory sigs = _guardianSigs(ACCOUNT, keyPtr2, true, true, false);
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);

        uint256 later = vm.getBlockTimestamp() + 1 hours;
        vm.warp(later);
        sigs = _guardianSigs(ACCOUNT, keyPtr3, false, true, true);
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr3, sigs);

        QuantumValidator.PendingRecovery memory p = qv.pendingRecoveryOf(ACCOUNT);
        assertEq(p.keyPtr, keyPtr3);
        assertEq(p.eta, later + DELAY);
    }

    function test_proposeRecovery_signaturesForOtherAccountRejected() public {
        _installWithGuardians(ACCOUNT);
        _installWithGuardians(ACCOUNT_B); // same guardian set
        bytes[] memory sigsForA = _guardianSigs(ACCOUNT, keyPtr2, true, true, true);
        vm.expectRevert(abi.encodeWithSelector(QuantumValidator.InsufficientGuardianSignatures.selector, 0, 2));
        qv.proposeRecovery(ACCOUNT_B, address(mv), keyPtr2, sigsForA);
    }

    function test_proposeRecovery_signaturesBindNewKey() public {
        _installWithGuardians(ACCOUNT);
        bytes[] memory sigs = _guardianSigs(ACCOUNT, keyPtr2, true, true, false);
        vm.expectRevert(abi.encodeWithSelector(QuantumValidator.InsufficientGuardianSignatures.selector, 0, 2));
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr3, sigs);
    }

    function test_proposeRecovery_revertingGuardianVerifierIsNotCounted() public {
        _installWithGuardians(ACCOUNT);
        mv.revertOn(guardianKeys[0]);

        bytes[] memory sigs = _guardianSigs(ACCOUNT, keyPtr2, true, true, false);
        vm.expectRevert(abi.encodeWithSelector(QuantumValidator.InsufficientGuardianSignatures.selector, 1, 2));
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);

        sigs = _guardianSigs(ACCOUNT, keyPtr2, true, true, true);
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);
        assertEq(qv.pendingRecoveryOf(ACCOUNT).keyPtr, keyPtr2);
    }

    function test_proposeRecovery_noGuardians_reverts() public {
        _install(ACCOUNT, keyPtr);
        bytes[] memory sigs = new bytes[](0);
        vm.expectRevert(QuantumValidator.InvalidGuardianConfig.selector);
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);
    }

    function test_proposeRecovery_uninitialized_reverts() public {
        bytes[] memory sigs = new bytes[](0);
        vm.expectRevert(abi.encodeWithSelector(QuantumValidator.NotInitialized.selector, ACCOUNT));
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);
    }

    function test_proposeRecovery_invalidNewKey_reverts() public {
        _installWithGuardians(ACCOUNT);
        bytes[] memory sigs = _guardianSigs(ACCOUNT, address(0xDEAD), true, true, false);
        vm.expectRevert(QuantumValidator.InvalidKeyConfig.selector);
        qv.proposeRecovery(ACCOUNT, address(mv), address(0xDEAD), sigs);
    }

    function test_proposeRecovery_extraSignaturesIgnored() public {
        _installWithGuardians(ACCOUNT);
        bytes[] memory base = _guardianSigs(ACCOUNT, keyPtr2, true, true, false);
        bytes[] memory sigs = new bytes[](5);
        sigs[0] = base[0];
        sigs[1] = base[1];
        sigs[3] = base[0];
        sigs[4] = base[1];
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);
        assertEq(qv.pendingRecoveryOf(ACCOUNT).keyPtr, keyPtr2);
    }

    // ---------------------------------------------------------------- uninstall

    function test_onUninstall_clearsAllState() public {
        _installWithGuardians(ACCOUNT);
        bytes[] memory sigs = _guardianSigs(ACCOUNT, keyPtr2, true, true, false);
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);

        vm.prank(ACCOUNT);
        qv.onUninstall("");

        assertFalse(qv.isInitialized(ACCOUNT));
        QuantumValidator.Config memory c = qv.configOf(ACCOUNT);
        assertEq(c.verifier, address(0));
        assertEq(c.keyPtr, address(0));
        (bytes[] memory gs, uint8 threshold, uint32 delay) = qv.guardiansOf(ACCOUNT);
        assertEq(gs.length, 0);
        assertEq(threshold, 0);
        assertEq(delay, 0);
        QuantumValidator.PendingRecovery memory p = qv.pendingRecoveryOf(ACCOUNT);
        assertEq(p.verifier, address(0));
        assertEq(p.keyPtr, address(0));
        assertEq(p.eta, 0);

        bytes32 h = keccak256("user-op");
        assertEq(_validate(ACCOUNT, h, _sig(keyPtr, h)), 1);
        vm.expectRevert(QuantumValidator.NoPendingRecovery.selector);
        qv.executeRecovery(ACCOUNT);

        // Reinstall works, and pre-uninstall guardian approvals stay dead (nonce is not reset).
        _installWithGuardians(ACCOUNT);
        assertTrue(qv.isInitialized(ACCOUNT));
        vm.expectRevert(abi.encodeWithSelector(QuantumValidator.InsufficientGuardianSignatures.selector, 0, 2));
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);
    }

    function test_onUninstall_onlyAffectsCaller() public {
        _install(ACCOUNT, keyPtr);
        _install(ACCOUNT_B, keyPtr2);
        vm.prank(ACCOUNT_B);
        qv.onUninstall("");
        assertTrue(qv.isInitialized(ACCOUNT));
        assertFalse(qv.isInitialized(ACCOUNT_B));
    }

    // ---------------------------------------------------------------- verifier must be real code

    /// @dev Why codeless/precompile verifiers are dangerous: the identity precompile echoes the
    ///      ERC-7913 calldata, whose first word is `verify.selector ‖ 0…0`, i.e. the magic value.
    function test_identityPrecompileWouldAcceptAnySignature() public view {
        assertTrue(SignatureChecker.isValidSignatureNow(abi.encodePacked(address(4), keyPtr), keccak256("x"), ""));
    }

    function test_onInstall_identityPrecompileVerifier_reverts() public {
        _expectInvalidKey(address(4), keyPtr);
    }

    function test_onInstall_eoaVerifier_reverts() public {
        _expectInvalidKey(EOA_VERIFIER, keyPtr);
    }

    function test_onInstall_precompileRangeVerifierWithCode_reverts() public {
        vm.etch(address(0xff), address(mv).code);
        _expectInvalidKey(address(0xff), keyPtr);
        vm.etch(address(0xffff), address(mv).code);
        _expectInvalidKey(address(0xffff), keyPtr);
    }

    function test_onInstall_verifierJustAbovePrecompileRange_accepted() public {
        vm.etch(address(0x10000), address(mv).code);
        bytes memory data = _installData(address(0x10000), keyPtr, new bytes[](0), 0, 0);
        vm.prank(ACCOUNT);
        qv.onInstall(data);
        assertEq(qv.configOf(ACCOUNT).verifier, address(0x10000));
    }

    function test_rotateKey_codelessVerifier_reverts() public {
        _install(ACCOUNT, keyPtr);
        vm.prank(ACCOUNT);
        vm.expectRevert(QuantumValidator.InvalidKeyConfig.selector);
        qv.rotateKey(address(4), keyPtr2);
        vm.prank(ACCOUNT);
        vm.expectRevert(QuantumValidator.InvalidKeyConfig.selector);
        qv.rotateKey(EOA_VERIFIER, keyPtr2);
    }

    function test_proposeRecovery_codelessVerifier_reverts() public {
        _installWithGuardians(ACCOUNT);
        bytes32 d = qv.recoveryDigest(ACCOUNT, address(4), keyPtr2);
        bytes[] memory sigs = new bytes[](3);
        sigs[0] = abi.encode(guardianKeys[0], d);
        sigs[1] = abi.encode(guardianKeys[1], d);
        vm.expectRevert(QuantumValidator.InvalidKeyConfig.selector);
        qv.proposeRecovery(ACCOUNT, address(4), keyPtr2, sigs);
    }

    function test_onInstall_guardianWithPrecompilePrefix_reverts() public {
        bytes[] memory gs = new bytes[](2);
        gs[0] = guardians[0];
        gs[1] = abi.encodePacked(address(4), "guardian-key");
        _expectInvalidGuardians(gs, 1, DELAY);
    }

    function test_onInstall_guardianWithCodelessVerifier_reverts() public {
        bytes[] memory gs = new bytes[](2);
        gs[0] = guardians[0];
        gs[1] = abi.encodePacked(EOA_VERIFIER, "guardian-key");
        _expectInvalidGuardians(gs, 1, DELAY);
    }

    function test_setGuardians_guardianWithPrecompilePrefix_reverts() public {
        _install(ACCOUNT, keyPtr);
        bytes[] memory gs = new bytes[](1);
        gs[0] = abi.encodePacked(address(4), "guardian-key");
        vm.prank(ACCOUNT);
        vm.expectRevert(QuantumValidator.InvalidGuardianConfig.selector);
        qv.setGuardians(gs, 1, DELAY);
    }

    // ---------------------------------------------------------------- stale approvals die

    function test_rotateKey_invalidatesOutstandingApprovals() public {
        _installWithGuardians(ACCOUNT);
        bytes[] memory sigs = _guardianSigs(ACCOUNT, keyPtr2, true, true, false); // collected, not submitted

        vm.prank(ACCOUNT);
        qv.rotateKey(address(mv), keyPtr3);

        vm.expectRevert(abi.encodeWithSelector(QuantumValidator.InsufficientGuardianSignatures.selector, 0, 2));
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);
    }

    function test_setGuardians_invalidatesOutstandingApprovals() public {
        _installWithGuardians(ACCOUNT);
        bytes[] memory sigs = _guardianSigs(ACCOUNT, keyPtr2, true, true, false);

        vm.prank(ACCOUNT);
        qv.setGuardians(guardians, 2, DELAY); // same set, re-confirmed

        vm.expectRevert(abi.encodeWithSelector(QuantumValidator.InsufficientGuardianSignatures.selector, 0, 2));
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);
    }

    function test_reinstall_invalidatesOutstandingApprovals() public {
        _installWithGuardians(ACCOUNT);
        bytes[] memory sigs = _guardianSigs(ACCOUNT, keyPtr2, true, true, false);

        vm.prank(ACCOUNT);
        qv.onUninstall("");
        _installWithGuardians(ACCOUNT);

        vm.expectRevert(abi.encodeWithSelector(QuantumValidator.InsufficientGuardianSignatures.selector, 0, 2));
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);
    }

    function test_cancelRecovery_invalidatesOutstandingApprovals() public {
        _installWithGuardians(ACCOUNT);
        bytes[] memory first = _guardianSigs(ACCOUNT, keyPtr2, true, true, false);
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, first);
        bytes[] memory second = _guardianSigs(ACCOUNT, keyPtr3, true, true, false); // queued follow-up

        vm.prank(ACCOUNT);
        qv.cancelRecovery();

        vm.expectRevert(abi.encodeWithSelector(QuantumValidator.InsufficientGuardianSignatures.selector, 0, 2));
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr3, second);
    }

    function test_executeRecovery_invalidatesOutstandingApprovals() public {
        _installWithGuardians(ACCOUNT);
        bytes[] memory first = _guardianSigs(ACCOUNT, keyPtr2, true, true, false);
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, first);
        bytes[] memory second = _guardianSigs(ACCOUNT, keyPtr3, true, true, false);

        vm.warp(qv.pendingRecoveryOf(ACCOUNT).eta);
        qv.executeRecovery(ACCOUNT);

        vm.expectRevert(abi.encodeWithSelector(QuantumValidator.InsufficientGuardianSignatures.selector, 0, 2));
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr3, second);
    }

    // ---------------------------------------------------------------- ERC-7562 storage

    function test_onInstall_withoutGuardians_touchesOnlyAssociatedStorage() public {
        bytes memory data = _installData(address(mv), keyPtr, new bytes[](0), 0, 0);
        vm.record();
        vm.prank(ACCOUNT);
        qv.onInstall(data);
        (bytes32[] memory reads, bytes32[] memory writes) = vm.accesses(address(qv));
        assertGt(writes.length, 0);
        _assertAllAssociated(ACCOUNT, reads);
        _assertAllAssociated(ACCOUNT, writes);
    }

    function test_validateUserOp_touchesOnlyAssociatedStorage() public {
        _install(ACCOUNT, keyPtr);
        bytes32 h = keccak256("user-op");
        PackedUserOperation memory op = _op(ACCOUNT, _sig(keyPtr, h));
        vm.record();
        vm.prank(ACCOUNT);
        assertEq(qv.validateUserOp(op, h), 0);
        (bytes32[] memory reads, bytes32[] memory writes) = vm.accesses(address(qv));
        assertGt(reads.length, 0);
        assertEq(writes.length, 0);
        _assertAllAssociated(ACCOUNT, reads);
    }

    // ---------------------------------------------------------------- fuzz

    function testFuzz_randomSignatureNeverValidates(bytes calldata sig, bytes32 h) public {
        _install(ACCOUNT, keyPtr);
        vm.assume(keccak256(sig) != keccak256(_sig(keyPtr, h)));
        assertEq(_validate(ACCOUNT, h, sig), 1);

        vm.assume(keccak256(sig) != keccak256(_sig(keyPtr, qv.accountDigest(ACCOUNT, h))));
        vm.prank(ACCOUNT);
        assertEq(qv.isValidSignatureWithSender(STRANGER, h, sig), ERC1271_INVALID);
    }

    function testFuzz_randomGuardianSignaturesNeverRecover(bytes calldata s0, bytes calldata s1) public {
        _installWithGuardians(ACCOUNT);
        bytes32 d = qv.recoveryDigest(ACCOUNT, address(mv), keyPtr2);
        vm.assume(keccak256(s0) != keccak256(abi.encode(guardianKeys[0], d)));
        vm.assume(keccak256(s1) != keccak256(abi.encode(guardianKeys[1], d)));
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = s0;
        sigs[1] = s1;
        vm.expectRevert(abi.encodeWithSelector(QuantumValidator.InsufficientGuardianSignatures.selector, 0, 2));
        qv.proposeRecovery(ACCOUNT, address(mv), keyPtr2, sigs);
    }
}
