// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PackedUserOperation} from "@openzeppelin/contracts/interfaces/IERC4337.sol";
import {IMLDSAVerifier} from "evm-ml-dsa-verifier/IMLDSAVerifier.sol";
import {DevSign} from "../utils/DevSign.sol";
import {Fixtures} from "../utils/Fixtures.sol";
import {KeyStore} from "../../src/KeyStore.sol";
import {IQanaryPQVerifier} from "../../src/interfaces/IQanaryPQVerifier.sol";
import {QuantumValidator} from "../../src/QuantumValidator.sol";
import {SolidityMLDSA44Verifier} from "../../src/fallback/SolidityMLDSA44Verifier.sol";

/// @notice SolidityMLDSA44Verifier under plain forge: fixtures, live dev-signer signatures (FFI,
///         `npm ci` in scripts/devsign), NIST ACVP sigVer, the reference expansion of the upstream
///         `prepare.py`, malformed inputs, and QuantumValidator on top.
/// @dev Gas figures are call-frame gas with every touched account cooled (`vm.cool`) first; they
///      exclude intrinsic and calldata gas.
contract SolidityMLDSA44VerifierTest is DevSign {
    bytes4 internal constant MAGIC = 0x024ad318;
    bytes4 internal constant FAIL = 0xffffffff;
    uint8 internal constant MLDSA44 = 2;
    address internal constant ACCOUNT = address(0xA11CE);
    string internal constant HELPER_HEX = "lib/evm-ml-dsa-verifier/helpers/f1600_170.hex";

    address internal helper;
    IMLDSAVerifier internal core;
    SolidityMLDSA44Verifier internal v;
    KeyStore internal ks;

    function setUp() public {
        helper = _deployRuntime(_hex(vm.readFile(HELPER_HEX)));
        core = IMLDSAVerifier(vm.deployCode("MLDSA44Verifier.sol:MLDSA44Verifier", abi.encode(helper)));
        v = new SolidityMLDSA44Verifier(core, helper);
        ks = new KeyStore();
    }

    // ---------------------------------------------------------------- helpers

    function _hex(string memory s) internal pure returns (bytes memory) {
        return vm.parseBytes(string.concat("0x", vm.trim(s)));
    }

    /// @dev Deploys `runtime` verbatim: PUSH2 len DUP1 PUSH1 12 PUSH1 0 CODECOPY PUSH1 0 RETURN.
    function _deployRuntime(bytes memory runtime) internal returns (address a) {
        bytes memory init = abi.encodePacked(hex"61", uint16(runtime.length), hex"80600c6000396000f3", runtime);
        assembly ("memory-safe") {
            a := create(0, add(init, 32), mload(init))
        }
        require(a != address(0) && a.code.length == runtime.length, "runtime deploy failed");
    }

    function _inline(bytes memory pk) internal pure returns (bytes memory) {
        return abi.encodePacked(MLDSA44, pk);
    }

    function _ptr(bytes memory pk) internal returns (address) {
        return ks.store(_inline(pk));
    }

    function _fixture(string memory name) internal view returns (bytes memory pk, bytes32 h, bytes memory sig) {
        pk = Fixtures.hexFile(vm, string.concat(name, ".pk"));
        h = bytes32(Fixtures.hexFile(vm, string.concat(name, ".msg")));
        sig = Fixtures.hexFile(vm, string.concat(name, ".sig"));
    }

    function _blob(bytes memory pk) internal view returns (address) {
        return v.blobAddress(keccak256(pk));
    }

    function _cool(address extra) internal {
        vm.cool(address(v));
        vm.cool(address(core));
        vm.cool(helper);
        vm.cool(extra);
    }

    /// @dev Cold `verify`; returns the result and the call-frame gas.
    function _verifyCold(bytes memory key, bytes32 h, bytes memory sig, address blob)
        internal
        returns (bytes4 r, uint256 gasUsed)
    {
        _cool(blob);
        if (key.length == 20) vm.cool(address(bytes20(key)));
        uint256 g = gasleft();
        r = v.verify(key, h, sig);
        gasUsed = g - gasleft();
    }

    function _flip(bytes memory b, uint256 i) internal pure returns (bytes memory c) {
        c = bytes.concat(b);
        c[i] ^= 0x01;
    }

    function _seed(string memory label, uint256 i) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("qanary-devsign/evm-fallback/", label, i));
    }

    // ---------------------------------------------------------------- deployment

    function test_codeSizes_withinEip170() public view {
        assertLe(address(v).code.length, 24_576, "adapter");
        assertLe(address(core).code.length, 24_576, "core");
        assertLe(helper.code.length, 24_576, "helper");
        assertEq(helper.codehash, v.F1600_CODEHASH(), "helper is the pinned runtime");
    }

    function test_constructor_rejectsWrongHelper() public {
        vm.expectRevert(SolidityMLDSA44Verifier.BadHelper.selector);
        new SolidityMLDSA44Verifier(core, address(core));
    }

    function test_constructor_rejectsCodelessCore() public {
        vm.expectRevert(SolidityMLDSA44Verifier.BadCore.selector);
        new SolidityMLDSA44Verifier(IMLDSAVerifier(address(0xC0DE)), helper);
    }

    function test_schemes() public view {
        uint8[] memory s = v.schemes();
        assertEq(s.length, 1);
        assertEq(s[0], MLDSA44);
    }

    // ---------------------------------------------------------------- fixtures

    function test_fixture_inline() public {
        (bytes memory pk, bytes32 h, bytes memory sig) = _fixture("mldsa44");
        bytes memory key = _inline(pk);
        uint256 g = gasleft();
        address blob = v.prepareKey(key);
        emit log_named_uint("gas: prepareKey (on-chain expansion + 20,545-byte blob)", g - gasleft());
        assertEq(blob, _blob(pk));
        assertEq(blob.code.length, v.BLOB_SIZE());

        (bytes4 r, uint256 gasUsed) = _verifyCold(key, h, sig, blob);
        assertEq(r, MAGIC, "valid fixture");
        emit log_named_uint("gas: verify, inline key (cold)", gasUsed);
    }

    function test_fixture_pointer() public {
        (bytes memory pk, bytes32 h, bytes memory sig) = _fixture("mldsa44");
        address ptr = _ptr(pk);
        address blob = v.prepareKey(abi.encodePacked(ptr));
        assertEq(blob, _blob(pk), "pointer and inline keys share the blob");

        (bytes4 r, uint256 gasUsed) = _verifyCold(abi.encodePacked(ptr), h, sig, blob);
        assertEq(r, MAGIC, "valid fixture via KeyStore pointer");
        emit log_named_uint("gas: verify, KeyStore pointer key (cold)", gasUsed);
        assertEq(v.verify(_inline(pk), h, sig), MAGIC, "inline key after pointer prepare");
    }

    function test_fixture_nobleDevsign() public {
        (bytes memory pk, bytes32 h, bytes memory sig) = _fixture("mldsa44_devsign");
        address ptr = _ptr(pk);
        v.prepareKey(abi.encodePacked(ptr));
        assertEq(v.verify(abi.encodePacked(ptr), h, sig), MAGIC);
        assertEq(v.verify(_inline(pk), h, sig), MAGIC);
    }

    function test_fixture_coreAgrees() public {
        (bytes memory pk, bytes32 h, bytes memory sig) = _fixture("mldsa44");
        address blob = v.prepareKey(_inline(pk));
        assertTrue(core.verify(blob, abi.encodePacked(h), sig));
    }

    // ---------------------------------------------------------------- tampering

    function test_tamperedSignature_returnsFail() public {
        (bytes memory pk, bytes32 h, bytes memory sig) = _fixture("mldsa44");
        bytes memory key = _inline(pk);
        v.prepareKey(key);
        // c~, z (first, middle, last byte), hint indices, hint counts
        uint256[7] memory at = [uint256(0), 31, 32, 1200, 2335, 2340, 2419];
        for (uint256 i = 0; i < at.length; ++i) {
            assertEq(v.verify(key, h, _flip(sig, at[i])), FAIL, vm.toString(at[i]));
        }
    }

    function test_tamperedHash_returnsFail() public {
        (bytes memory pk, bytes32 h, bytes memory sig) = _fixture("mldsa44");
        bytes memory key = _inline(pk);
        v.prepareKey(key);
        assertEq(v.verify(key, h ^ bytes32(uint256(1)), sig), FAIL);
        assertEq(v.verify(key, bytes32(0), sig), FAIL);
        assertEq(v.verify(key, keccak256(abi.encode(h)), sig), FAIL);
    }

    function test_tamperedPublicKey_returnsFail() public {
        (bytes memory pk, bytes32 h, bytes memory sig) = _fixture("mldsa44");
        bytes memory rhoFlip = _flip(pk, 5);
        bytes memory t1Flip = _flip(pk, 700);
        // an unprepared (tampered) key reverts, a prepared one fails
        vm.expectRevert(abi.encodeWithSelector(SolidityMLDSA44Verifier.KeyNotPrepared.selector, keccak256(rhoFlip)));
        v.verify(_inline(rhoFlip), h, sig);
        v.prepareKey(_inline(rhoFlip));
        v.prepareKey(_inline(t1Flip));
        assertEq(v.verify(_inline(rhoFlip), h, sig), FAIL, "rho");
        assertEq(v.verify(_inline(t1Flip), h, sig), FAIL, "t1");
    }

    function test_otherKeysSignature_returnsFail() public {
        (bytes memory pk,,) = _fixture("mldsa44");
        (, bytes32 h2, bytes memory sig2) = _fixture("mldsa44_devsign");
        v.prepareKey(_inline(pk));
        assertEq(v.verify(_inline(pk), h2, sig2), FAIL);
    }

    /// forge-config: default.fuzz.runs = 48
    function testFuzz_randomSignature_returnsFail(bytes32 h, bytes32 seed) public {
        (bytes memory pk,,) = _fixture("mldsa44");
        bytes memory key = _inline(pk);
        v.prepareKey(key);
        bytes memory sig = new bytes(2420);
        for (uint256 i = 0; i < 2420; i += 32) {
            bytes32 w = keccak256(abi.encode(seed, i));
            for (uint256 k = 0; k < 32 && i + k < 2420; ++k) {
                sig[i + k] = w[k];
            }
        }
        assertEq(v.verify(key, h, sig), FAIL);
    }

    /// forge-config: default.fuzz.runs = 96
    function testFuzz_byteFlip_returnsFail(uint256 pos, uint8 mask) public {
        vm.assume(mask != 0);
        (bytes memory pk, bytes32 h, bytes memory sig) = _fixture("mldsa44");
        bytes memory key = _inline(pk);
        v.prepareKey(key);
        pos = bound(pos, 0, sig.length - 1);
        sig[pos] ^= bytes1(mask);
        assertEq(v.verify(key, h, sig), FAIL);
    }

    // ---------------------------------------------------------------- live dev-signer (FFI)

    function test_devsign_roundTrips() public {
        uint256 n = 12;
        for (uint256 i = 0; i < n; ++i) {
            bytes32 seed = keccak256(abi.encode(_seed("roundtrip", i), vm.randomUint()));
            bytes memory pk = pqKeygen("mldsa44", seed);
            address ptr = _ptr(pk);
            v.prepareKey(abi.encodePacked(ptr));
            bytes32 h = bytes32(vm.randomUint());
            bytes memory sig = pqSign("mldsa44", seed, abi.encodePacked(h));

            assertEq(v.verify(abi.encodePacked(ptr), h, sig), MAGIC, "pointer");
            assertEq(v.verify(_inline(pk), h, sig), MAGIC, "inline");
            assertEq(v.verify(abi.encodePacked(ptr), h, _flip(sig, uint256(h) % sig.length)), FAIL, "tampered sig");
            assertEq(v.verify(abi.encodePacked(ptr), ~h, sig), FAIL, "tampered hash");
        }
    }

    function test_devsign_sameKeyManyMessages() public {
        bytes32 seed = _seed("many", 0);
        bytes memory pk = pqKeygen("mldsa44", seed);
        bytes memory key = abi.encodePacked(_ptr(pk));
        v.prepareKey(key);
        for (uint256 i = 0; i < 4; ++i) {
            bytes32 h = keccak256(abi.encode(i, vm.randomUint()));
            assertEq(v.verify(key, h, pqSign("mldsa44", seed, abi.encodePacked(h))), MAGIC);
        }
    }

    // ---------------------------------------------------------------- reference expansion, ACVP

    /// @dev The on-chain expansion equals the upstream `prepare.py` output byte for byte, for the
    ///      two fixtures and the 15 ACVP sigVer keys (`vectors/mldsa/prepared-44.json`).
    function test_prepare_matchesUpstreamPrepare() public {
        string memory ref = Fixtures.jsonFile(vm, "mldsa/prepared-44.json");
        bytes32[] memory pkKeccak = vm.parseJsonBytes32Array(ref, ".pkKeccak");
        bytes32[] memory blobKeccak = vm.parseJsonBytes32Array(ref, ".blobKeccak");
        assertEq(pkKeccak.length, 17);

        bytes[] memory pks = new bytes[](17);
        pks[0] = Fixtures.hexFile(vm, "mldsa44.pk");
        pks[1] = Fixtures.hexFile(vm, "mldsa44_devsign.pk");
        string memory acvp = Fixtures.jsonFile(vm, "mldsa/sigver-44.json");
        for (uint256 i = 0; i < 15; ++i) {
            pks[i + 2] = _hex(vm.parseJsonString(acvp, string.concat(".tests[", vm.toString(i), "].pk")));
        }
        for (uint256 i = 0; i < 17; ++i) {
            assertEq(keccak256(pks[i]), pkKeccak[i], "pk");
            address blob = v.prepareKey(_inline(pks[i]));
            assertEq(blob.code.length, 20_545);
            assertEq(blob.codehash, blobKeccak[i], "blob == prepare.py(pk)");
        }
    }

    /// @dev NIST ACVP ML-DSA-44 sigVer (external, pure). This verifier binds the empty context, so a
    ///      case must verify iff `testPassed` and its context is empty. The messages are not 32 bytes,
    ///      so they go through the core with the blob `prepareKey` built.
    function test_acvp_sigVer_emptyContextOnly() public {
        string memory acvp = Fixtures.jsonFile(vm, "mldsa/sigver-44.json");
        uint256 n;
        uint256 validWithContext;
        for (uint256 i = 0; i < 15; ++i) {
            string memory t = string.concat(".tests[", vm.toString(i), "]");
            bytes memory pk = _hex(vm.parseJsonString(acvp, string.concat(t, ".pk")));
            bytes memory message = _hex(vm.parseJsonString(acvp, string.concat(t, ".message")));
            bytes memory context = _hex(vm.parseJsonString(acvp, string.concat(t, ".context")));
            bytes memory sig = _hex(vm.parseJsonString(acvp, string.concat(t, ".signature")));
            bool passed = vm.parseJsonBool(acvp, string.concat(t, ".testPassed"));

            address blob = v.prepareKey(_inline(pk));
            bool expected = passed && context.length == 0;
            assertEq(core.verify(blob, message, sig), expected, t);
            if (passed && context.length != 0) ++validWithContext;
            ++n;
        }
        assertEq(n, 15);
        assertEq(validWithContext, 3, "context-bound valid cases are rejected");
    }

    // ---------------------------------------------------------------- malformed keys and signatures

    function test_emptyKey_revertsInvalidKeyLength() public {
        (,, bytes memory sig) = _fixture("mldsa44");
        vm.expectRevert(abi.encodeWithSelector(IQanaryPQVerifier.InvalidKeyLength.selector, 1, 0));
        v.verify("", bytes32(0), sig);
    }

    function test_inlineWrongScheme_revertsUnsupportedScheme() public {
        (bytes memory pk, bytes32 h, bytes memory sig) = _fixture("mldsa44");
        uint8[4] memory bad = [uint8(0), 1, 3, 4];
        for (uint256 i = 0; i < bad.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(IQanaryPQVerifier.UnsupportedScheme.selector, bad[i]));
            v.verify(abi.encodePacked(bad[i], pk), h, sig);
        }
    }

    function test_inlineWrongPkLength_revertsInvalidKeyLength() public {
        (bytes memory pk, bytes32 h, bytes memory sig) = _fixture("mldsa44");
        bytes memory shorter = new bytes(1311);
        vm.expectRevert(abi.encodeWithSelector(IQanaryPQVerifier.InvalidKeyLength.selector, 1312, 1311));
        v.verify(_inline(shorter), h, sig);
        vm.expectRevert(abi.encodeWithSelector(IQanaryPQVerifier.InvalidKeyLength.selector, 1312, 1313));
        v.verify(abi.encodePacked(_inline(pk), uint8(0)), h, sig);
        vm.expectRevert(abi.encodeWithSelector(IQanaryPQVerifier.InvalidKeyLength.selector, 1312, 0));
        v.verify(abi.encodePacked(MLDSA44), h, sig);
        // a 21-byte key is inline, not a pointer
        vm.expectRevert(abi.encodeWithSelector(IQanaryPQVerifier.InvalidKeyLength.selector, 1312, 20));
        v.verify(abi.encodePacked(MLDSA44, address(ks)), h, sig);
    }

    function test_wrongSignatureLength_revertsInvalidSignatureLength() public {
        (bytes memory pk, bytes32 h, bytes memory sig) = _fixture("mldsa44");
        bytes memory key = _inline(pk);
        v.prepareKey(key);
        uint256[4] memory lens = [uint256(0), 2419, 2421, 4840];
        for (uint256 i = 0; i < lens.length; ++i) {
            bytes memory s = new bytes(lens[i]);
            for (uint256 k = 0; k < s.length && k < sig.length; ++k) {
                s[k] = sig[k];
            }
            vm.expectRevert(abi.encodeWithSelector(IQanaryPQVerifier.InvalidSignatureLength.selector, 2420, lens[i]));
            v.verify(key, h, s);
        }
    }

    function test_errorOrder_matchesStylus() public {
        (bytes memory pk, bytes32 h,) = _fixture("mldsa44");
        // scheme before key length before signature length
        vm.expectRevert(abi.encodeWithSelector(IQanaryPQVerifier.UnsupportedScheme.selector, 3));
        v.verify(abi.encodePacked(uint8(3), new bytes(5)), h, "");
        vm.expectRevert(abi.encodeWithSelector(IQanaryPQVerifier.InvalidKeyLength.selector, 1312, 5));
        v.verify(abi.encodePacked(MLDSA44, new bytes(5)), h, "");
        // signature length before the prepared-key check
        vm.expectRevert(abi.encodeWithSelector(IQanaryPQVerifier.InvalidSignatureLength.selector, 2420, 0));
        v.verify(_inline(pk), h, "");
    }

    function test_unpreparedKey_revertsKeyNotPrepared() public {
        (bytes memory pk, bytes32 h, bytes memory sig) = _fixture("mldsa44");
        assertFalse(v.isPrepared(_inline(pk)));
        vm.expectRevert(abi.encodeWithSelector(SolidityMLDSA44Verifier.KeyNotPrepared.selector, keccak256(pk)));
        v.verify(_inline(pk), h, sig);
        v.prepareKey(_inline(pk));
        assertTrue(v.isPrepared(_inline(pk)));
    }

    function test_pointerWithoutCode_revertsInvalidKey() public {
        (,, bytes memory sig) = _fixture("mldsa44");
        vm.expectRevert(IQanaryPQVerifier.InvalidKey.selector);
        v.verify(abi.encodePacked(address(0xBEEF)), bytes32(0), sig);
        vm.expectRevert(IQanaryPQVerifier.InvalidKey.selector);
        v.verify(abi.encodePacked(address(0)), bytes32(0), sig);
    }

    function test_pointerShortOrUnprefixedCode_revertsInvalidKey() public {
        (bytes memory pk,, bytes memory sig) = _fixture("mldsa44");
        address a = address(0xAB);
        vm.etch(a, hex"00");
        vm.expectRevert(IQanaryPQVerifier.InvalidKey.selector);
        v.verify(abi.encodePacked(a), bytes32(0), sig);

        vm.etch(a, abi.encodePacked(hex"60", MLDSA44, pk));
        vm.expectRevert(IQanaryPQVerifier.InvalidKey.selector);
        v.verify(abi.encodePacked(a), bytes32(0), sig);

        // an ordinary contract is not a key pointer either
        vm.expectRevert(IQanaryPQVerifier.InvalidKey.selector);
        v.verify(abi.encodePacked(address(ks)), bytes32(0), sig);
    }

    function test_pointerWrongScheme_revertsUnsupportedScheme() public {
        (bytes memory pk,, bytes memory sig) = _fixture("mldsa44");
        address ptr = ks.store(abi.encodePacked(uint8(3), pk));
        vm.expectRevert(abi.encodeWithSelector(IQanaryPQVerifier.UnsupportedScheme.selector, 3));
        v.verify(abi.encodePacked(ptr), bytes32(0), sig);
        // the bare STOP prefix with a scheme byte and no key
        address bare = address(0xAC);
        vm.etch(bare, abi.encodePacked(hex"00", uint8(1)));
        vm.expectRevert(abi.encodeWithSelector(IQanaryPQVerifier.UnsupportedScheme.selector, 1));
        v.verify(abi.encodePacked(bare), bytes32(0), sig);
    }

    function test_pointerWrongPkLength_revertsInvalidKeyLength() public {
        (bytes memory pk,, bytes memory sig) = _fixture("mldsa44");
        bytes memory longer = abi.encodePacked(pk, uint8(7));
        address ptr = ks.store(_inline(longer));
        vm.expectRevert(abi.encodeWithSelector(IQanaryPQVerifier.InvalidKeyLength.selector, 1312, 1313));
        v.verify(abi.encodePacked(ptr), bytes32(0), sig);
        address bare = address(0xAD);
        vm.etch(bare, abi.encodePacked(hex"00", MLDSA44));
        vm.expectRevert(abi.encodeWithSelector(IQanaryPQVerifier.InvalidKeyLength.selector, 1312, 0));
        v.verify(abi.encodePacked(bare), bytes32(0), sig);
    }

    // ---------------------------------------------------------------- prepareKey

    function test_prepareKey_idempotentAndEmits() public {
        (bytes memory pk,,) = _fixture("mldsa44");
        address expected = _blob(pk);
        vm.expectEmit(address(v));
        emit SolidityMLDSA44Verifier.KeyPrepared(keccak256(pk), expected);
        assertEq(v.prepareKey(_inline(pk)), expected);

        bytes memory ptrKey = abi.encodePacked(_ptr(pk));
        vm.recordLogs();
        uint256 g = gasleft();
        assertEq(v.prepareKey(ptrKey), expected, "pointer form, same blob");
        assertLt(g - gasleft(), 50_000, "second prepare is a lookup");
        assertEq(vm.getRecordedLogs().length, 0, "no second KeyPrepared");
    }

    function test_prepareKey_rejectsMalformedKeys() public {
        (bytes memory pk,,) = _fixture("mldsa44");
        vm.expectRevert(abi.encodeWithSelector(IQanaryPQVerifier.InvalidKeyLength.selector, 1, 0));
        v.prepareKey("");
        vm.expectRevert(abi.encodeWithSelector(IQanaryPQVerifier.UnsupportedScheme.selector, 3));
        v.prepareKey(abi.encodePacked(uint8(3), pk));
        vm.expectRevert(abi.encodeWithSelector(IQanaryPQVerifier.InvalidKeyLength.selector, 1312, 1311));
        v.prepareKey(_inline(new bytes(1311)));
        vm.expectRevert(IQanaryPQVerifier.InvalidKey.selector);
        v.prepareKey(abi.encodePacked(address(0xBEEF)));
    }

    function test_pendingBlob_onlyDuringPrepare() public {
        vm.expectRevert(SolidityMLDSA44Verifier.NotPendingBlob.selector);
        v.pendingBlob();
        vm.prank(address(0));
        vm.expectRevert(SolidityMLDSA44Verifier.NotPendingBlob.selector);
        v.pendingBlob();
    }

    function test_blobAddress_isCreate2OfConstantInitCode() public view {
        bytes32 pkHash = keccak256("pk");
        address expected = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(v), pkHash, v.BLOB_INIT_CODE_HASH()))))
        );
        assertEq(v.blobAddress(pkHash), expected);
        bytes memory init = abi.encodePacked(
            hex"63",
            SolidityMLDSA44Verifier.pendingBlob.selector,
            hex"5f525f5f6004601c335afa6016575f5ffd5b3d5f5f3e3d5ff3"
        );
        assertEq(v.BLOB_INIT_CODE_HASH(), keccak256(init));
    }

    // ---------------------------------------------------------------- QuantumValidator integration

    function _install(QuantumValidator qv, address verifier, address ptr) internal {
        bytes memory data = abi.encode(
            QuantumValidator.InstallData({
                verifier: verifier, keyPtr: ptr, guardians: new bytes[](0), threshold: 0, delay: 0
            })
        );
        vm.prank(ACCOUNT);
        qv.onInstall(data);
    }

    /// @dev Cold `validateUserOp` from ACCOUNT; returns the validation data and the call-frame gas.
    function _validateCold(QuantumValidator qv, address ptr, address blob, bytes32 h, bytes memory sig)
        internal
        returns (uint256 result, uint256 gasUsed)
    {
        PackedUserOperation memory op;
        op.sender = ACCOUNT;
        op.signature = sig;
        _cool(blob);
        vm.cool(address(qv));
        vm.cool(ptr);
        vm.prank(ACCOUNT);
        uint256 g = gasleft();
        result = qv.validateUserOp(op, h);
        gasUsed = g - gasleft();
    }

    function test_validator_devsignUserOp() public {
        bytes32 seed = _seed("validator", 0);
        bytes memory pk = pqKeygen("mldsa44", seed);
        address ptr = _ptr(pk);
        address blob = v.prepareKey(abi.encodePacked(ptr));
        QuantumValidator qv = new QuantumValidator();
        _install(qv, address(v), ptr);

        bytes32 userOpHash = bytes32(vm.randomUint());
        bytes memory sig = pqSign("mldsa44", seed, abi.encodePacked(userOpHash));
        (uint256 r, uint256 g) = _validateCold(qv, ptr, blob, userOpHash, sig);
        assertEq(r, 0, "valid user operation");
        emit log_named_uint("gas: QuantumValidator.validateUserOp, Solidity ML-DSA-44, pointer (cold)", g);

        (r,) = _validateCold(qv, ptr, blob, userOpHash, _flip(sig, 1000));
        assertEq(r, 1, "tampered signature");
        (r,) = _validateCold(qv, ptr, blob, ~userOpHash, sig);
        assertEq(r, 1, "signature over another hash");
    }

    function test_validator_unpreparedKey_fails() public {
        bytes32 seed = _seed("validator", 1);
        bytes memory pk = pqKeygen("mldsa44", seed);
        address ptr = _ptr(pk);
        QuantumValidator qv = new QuantumValidator();
        _install(qv, address(v), ptr);
        bytes32 userOpHash = bytes32(vm.randomUint());
        bytes memory sig = pqSign("mldsa44", seed, abi.encodePacked(userOpHash));
        (uint256 r,) = _validateCold(qv, ptr, _blob(pk), userOpHash, sig);
        assertEq(r, 1, "KeyNotPrepared is a failed validation");
        v.prepareKey(abi.encodePacked(ptr));
        (r,) = _validateCold(qv, ptr, _blob(pk), userOpHash, sig);
        assertEq(r, 0, "valid once prepared");
    }

    /// @dev The account keeps its KeyStore pointer when it changes verifier: `rotateKey(verifier,
    ///      keyPtr)` with the same pointer, here to a second deployment standing in for the Stylus one.
    function test_validator_rotateVerifier_keepsKeyPointer() public {
        bytes32 seed = _seed("validator", 2);
        address ptr = _ptr(pqKeygen("mldsa44", seed));
        v.prepareKey(abi.encodePacked(ptr));
        QuantumValidator qv = new QuantumValidator();
        _install(qv, address(v), ptr);

        SolidityMLDSA44Verifier next = new SolidityMLDSA44Verifier(core, helper);
        next.prepareKey(abi.encodePacked(ptr));
        vm.prank(ACCOUNT);
        qv.rotateKey(address(next), ptr);

        bytes32 userOpHash = bytes32(vm.randomUint());
        PackedUserOperation memory op;
        op.sender = ACCOUNT;
        op.signature = pqSign("mldsa44", seed, abi.encodePacked(userOpHash));
        vm.prank(ACCOUNT);
        assertEq(qv.validateUserOp(op, userOpHash), 0);
        assertEq(qv.configOf(ACCOUNT).verifier, address(next));
    }
}
