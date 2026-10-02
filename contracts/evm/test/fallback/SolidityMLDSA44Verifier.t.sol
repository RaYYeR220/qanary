// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {PackedUserOperation} from "@openzeppelin/contracts/interfaces/IERC4337.sol";
import {DevSign} from "../utils/DevSign.sol";
import {Fixtures} from "../utils/Fixtures.sol";
import {KeyStore} from "../../src/KeyStore.sol";
import {IQanaryPQVerifier} from "../../src/interfaces/IQanaryPQVerifier.sol";
import {QuantumValidator} from "../../src/QuantumValidator.sol";
import {IMLDSAVerifier} from "../../src/fallback/vendor/IMLDSAVerifier.sol";
import {MLDSA44ExpandedKeyStore} from "../../src/fallback/MLDSA44ExpandedKeyStore.sol";
import {SolidityMLDSA44Verifier} from "../../src/fallback/SolidityMLDSA44Verifier.sol";

/// @notice SolidityMLDSA44Verifier under plain forge: fixtures, live dev-signer signatures (FFI;
///         skipped unless `npm ci` ran in scripts/devsign), NIST ACVP sigVer, the reference
///         expansion of upstream `prepare.py`, malformed inputs, ERC-7562 opcode rules, and
///         QuantumValidator on top.
/// @dev Gas figures are call-frame gas with every touched account cooled (`vm.cool`) first; they
///      exclude intrinsic and calldata gas.
contract SolidityMLDSA44VerifierTest is DevSign {
    bytes4 internal constant MAGIC = 0x024ad318;
    bytes4 internal constant FAIL = 0xffffffff;
    uint8 internal constant MLDSA44 = 2;
    address internal constant ACCOUNT = address(0xA11CE);
    string internal constant HELPER_HEX = "src/fallback/vendor/f1600_170.hex";
    string internal constant CORE_ARTIFACT = "MLDSA44Verifier.sol:MLDSA44Verifier";
    /// @dev Offset of the hint encoding (80 indices + 4 cumulative counts) in a signature.
    uint256 internal constant HINTS = 2336;

    address internal helper;
    IMLDSAVerifier internal core;
    MLDSA44ExpandedKeyStore internal store;
    SolidityMLDSA44Verifier internal v;
    KeyStore internal ks;

    function setUp() public {
        helper = _deployRuntime(_hex(vm.readFile(HELPER_HEX)));
        core = IMLDSAVerifier(vm.deployCode(CORE_ARTIFACT, abi.encode(helper)));
        store = new MLDSA44ExpandedKeyStore(helper);
        v = new SolidityMLDSA44Verifier(core, store);
        ks = new KeyStore();
    }

    // ---------------------------------------------------------------- helpers

    /// @dev Skips the test unless the dev signer runs (node and `npm ci` in scripts/devsign).
    modifier devsign() {
        vm.skip(!_devsignAvailable(), "devsign unavailable: run `npm ci` in scripts/devsign");
        _;
    }

    function _devsignAvailable() internal returns (bool) {
        string[] memory cmd = new string[](5);
        cmd[0] = "node";
        cmd[1] = "../../scripts/devsign/devsign.mjs";
        cmd[2] = "keygen";
        cmd[3] = "mldsa44";
        cmd[4] = vm.toString(bytes32(uint256(1)));
        try vm.tryFfi(cmd) returns (Vm.FfiResult memory r) {
            return r.exitCode == 0 && r.stdout.length == 1312;
        } catch {
            return false;
        }
    }

    function _hex(string memory s) internal pure returns (bytes memory) {
        return vm.parseBytes(string.concat("0x", vm.trim(s)));
    }

    /// @dev Deploys `runtime` verbatim: PUSH2 len DUP1 PUSH1 12 PUSH1 0 CODECOPY PUSH1 0 RETURN.
    function _deployRuntime(bytes memory runtime) internal returns (address a) {
        // casting to 'uint16' is safe because the helper runtime is 21,622 bytes
        // forge-lint: disable-next-line(unsafe-typecast)
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

    /// @dev The prepared `mldsa44` fixture as an inline key.
    function _preparedFixture() internal returns (bytes memory key, bytes32 h, bytes memory sig) {
        bytes memory pk;
        (pk, h, sig) = _fixture("mldsa44");
        key = _inline(pk);
        v.prepareKey(key);
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

    function test_codeSizes_withinEip170() public {
        assertLe(address(v).code.length, 24_576, "adapter");
        assertLe(address(core).code.length, 24_576, "core");
        assertLe(address(store).code.length, 24_576, "store");
        assertLe(helper.code.length, 24_576, "helper");
        assertEq(helper.codehash, store.F1600_CODEHASH(), "helper is the pinned runtime");
        emit log_named_uint("runtime bytes: SolidityMLDSA44Verifier", address(v).code.length);
        emit log_named_uint("runtime bytes: MLDSA44Verifier (core)", address(core).code.length);
        emit log_named_uint("runtime bytes: MLDSA44ExpandedKeyStore", address(store).code.length);
    }

    function test_constructors_rejectBadDependencies() public {
        vm.expectRevert(MLDSA44ExpandedKeyStore.BadHelper.selector);
        new MLDSA44ExpandedKeyStore(address(core));
        vm.expectRevert(MLDSA44ExpandedKeyStore.BadHelper.selector);
        new MLDSA44ExpandedKeyStore(address(0));
        vm.expectRevert(SolidityMLDSA44Verifier.BadCore.selector);
        new SolidityMLDSA44Verifier(IMLDSAVerifier(address(0xC0DE)), store);
        vm.expectRevert(SolidityMLDSA44Verifier.BadKeyStore.selector);
        new SolidityMLDSA44Verifier(core, MLDSA44ExpandedKeyStore(address(0xC0DE)));
    }

    function test_schemes() public view {
        uint8[] memory s = v.schemes();
        assertEq(s.length, 1);
        assertEq(s[0], MLDSA44);
    }

    // ---------------------------------------------------------------- ERC-7562 opcode rules

    /// @dev ERC-7562 OP-011 opcodes, plus storage (the verify path is storage-free by design).
    function _banned(uint8 op) internal pure returns (bool) {
        return op == 0x31 // BALANCE
            || op == 0x32 // ORIGIN
            || op == 0x3a // GASPRICE
            || (op >= 0x40 && op <= 0x45) // BLOCKHASH COINBASE TIMESTAMP NUMBER PREVRANDAO GASLIMIT
            || (op >= 0x47 && op <= 0x4a) // SELFBALANCE BASEFEE BLOBHASH BLOBBASEFEE
            || op == 0x54 || op == 0x55 || op == 0x5c || op == 0x5d // SLOAD SSTORE TLOAD TSTORE
            || op == 0xf0 || op == 0xf5 // CREATE CREATE2
            || op == 0xfe || op == 0xff; // INVALID SELFDESTRUCT
    }

    /// @dev Walks `code` instruction by instruction (skipping PUSH1..PUSH32 immediates) and counts
    ///      ERC-7562 violations: a banned opcode, or GAS not immediately followed by CALL, CALLCODE,
    ///      DELEGATECALL or STATICCALL. With `solc`, the trailing CBOR metadata (length in the last
    ///      two bytes) is excluded and an INVALID that is the final instruction before it (solc's
    ///      code terminator, never jumped to) is allowed.
    function _violations(bytes memory code, bool solc) internal returns (uint256 n) {
        uint256 end = code.length;
        if (solc) end -= (uint256(uint8(code[end - 2])) << 8 | uint8(code[end - 1])) + 2;
        uint256 i;
        while (i < end) {
            uint8 op = uint8(code[i]);
            bool bad = _banned(op);
            if (solc && op == 0xfe && i == end - 1) bad = false;
            if (op == 0x5a) {
                uint8 next = i + 1 < end ? uint8(code[i + 1]) : 0;
                bad = !(next == 0xf1 || next == 0xf2 || next == 0xf4 || next == 0xfa);
            }
            if (bad) {
                emit log_named_uint(
                    string.concat("ERC-7562 violation, opcode ", vm.toString(abi.encodePacked(op)), " at"), i
                );
                ++n;
            }
            i += (op >= 0x60 && op <= 0x7f) ? op - 0x5e : 1;
        }
        assertEq(i, end, "instruction walk ends exactly at the metadata");
    }

    /// @dev Every contract `verify` executes (adapter, core, Keccak helper) is free of the opcodes
    ///      ERC-7562 bans in ERC-4337 validation, and of storage access.
    function test_erc7562_verifyPathHasNoBannedOpcodes() public {
        assertEq(_violations(address(v).code, true), 0, "SolidityMLDSA44Verifier");
        assertEq(_violations(address(core).code, true), 0, "MLDSA44Verifier core");
        assertEq(_violations(helper.code, false), 0, "Keccak-f[1600] helper");
    }

    /// @dev The scanner itself: PUSH immediates are skipped, GAS+CALL passes, other GAS and banned
    ///      opcodes are caught, and the key store (not on the verify path) is caught.
    function test_erc7562_scannerCatchesViolations() public {
        assertEq(_violations(hex"605a5afa00", false), 0, "PUSH1 0x5a; GAS STATICCALL");
        assertEq(_violations(hex"5a5000", false), 1, "GAS POP");
        assertEq(
            _violations(hex"7f5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a42", false),
            1,
            "TIMESTAMP"
        );
        assertEq(_violations(hex"325f545f5d", false), 3, "ORIGIN SLOAD TSTORE");
        assertGt(_violations(address(store).code, true), 0, "store holds CREATE2 and transient storage");
    }

    // ---------------------------------------------------------------- fixtures

    function test_fixture_inline() public {
        (bytes memory pk, bytes32 h, bytes memory sig) = _fixture("mldsa44");
        bytes memory key = _inline(pk);
        uint256 g = gasleft();
        address blob = v.prepareKey(key);
        emit log_named_uint("gas: prepareKey (on-chain expansion + 20,545-byte blob)", g - gasleft());
        assertEq(blob, _blob(pk));
        assertEq(blob, store.blobAddress(keccak256(pk)));
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
        (bytes memory key, bytes32 h, bytes memory sig) = _preparedFixture();
        // c~, z (first, middle, last byte), hint indices, hint counts
        uint256[7] memory at = [uint256(0), 31, 32, 1200, 2335, 2340, 2419];
        for (uint256 i = 0; i < at.length; ++i) {
            assertEq(v.verify(key, h, _flip(sig, at[i])), FAIL, vm.toString(at[i]));
        }
    }

    function test_tamperedHash_returnsFail() public {
        (bytes memory key, bytes32 h, bytes memory sig) = _preparedFixture();
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

    /// @dev Hint encoding (FIPS 204 Alg. 21): indices strictly increasing within a polynomial.
    function test_hints_nonMonotone_returnsFail() public {
        (bytes memory key, bytes32 h, bytes memory sig) = _preparedFixture();
        assertGe(uint8(sig[HINTS + 80]), 2, "fixture: polynomial 0 has two hints");
        bytes memory swapped = bytes.concat(sig);
        (swapped[HINTS], swapped[HINTS + 1]) = (sig[HINTS + 1], sig[HINTS]);
        assertEq(v.verify(key, h, swapped), FAIL, "decreasing indices");
        bytes memory repeated = bytes.concat(sig);
        repeated[HINTS + 1] = sig[HINTS];
        assertEq(v.verify(key, h, repeated), FAIL, "repeated index");
    }

    /// @dev Hint counts are cumulative, non-decreasing and at most omega = 80.
    function test_hints_countAboveOmega_returnsFail() public {
        (bytes memory key, bytes32 h, bytes memory sig) = _preparedFixture();
        bytes memory s = bytes.concat(sig);
        s[HINTS + 83] = bytes1(uint8(81));
        assertEq(v.verify(key, h, s), FAIL, "last count 81");
        s = bytes.concat(sig);
        s[HINTS + 80] = bytes1(uint8(81));
        assertEq(v.verify(key, h, s), FAIL, "first count 81");
        s = bytes.concat(sig);
        s[HINTS + 83] = 0xff;
        assertEq(v.verify(key, h, s), FAIL, "last count 255");
        s = bytes.concat(sig);
        s[HINTS + 81] = bytes1(uint8(sig[HINTS + 80]) - 1);
        assertEq(v.verify(key, h, s), FAIL, "decreasing count");
    }

    /// @dev Unused hint index slots (after the last count) must be zero.
    function test_hints_nonzeroPadding_returnsFail() public {
        (bytes memory key, bytes32 h, bytes memory sig) = _preparedFixture();
        uint256 total = uint8(sig[HINTS + 83]);
        assertLt(total, 80, "fixture: the hint field has padding");
        bytes memory s = bytes.concat(sig);
        s[HINTS + total] = 0x01;
        assertEq(v.verify(key, h, s), FAIL, "first padding byte");
        s = bytes.concat(sig);
        s[HINTS + 79] = 0x01;
        assertEq(v.verify(key, h, s), FAIL, "last padding byte");
    }

    /// @dev z coefficient 0 of polynomial 0 is the 18-bit field `gamma1 - z` at signature byte 32
    ///      (little-endian). FIPS 204 rejects ||z||_inf >= gamma1 - beta = 130,994.
    function test_z_atNormBound_returnsFail() public {
        (bytes memory key, bytes32 h, bytes memory sig) = _preparedFixture();
        uint24[4] memory fields = [
            uint24(78), // z = gamma1 - beta, exactly the (rejected) bound
            uint24(262_066), // z = -(gamma1 - beta)
            uint24(0), // z = gamma1
            uint24(262_143) // z = gamma1 - (2^18 - 1), most negative encodable
        ];
        for (uint256 i = 0; i < fields.length; ++i) {
            bytes memory s = bytes.concat(sig);
            uint24 f = fields[i];
            s[32] = bytes1(uint8(f));
            s[33] = bytes1(uint8(f >> 8));
            s[34] = bytes1((uint8(sig[34]) & 0xfc) | uint8(f >> 16));
            assertEq(v.verify(key, h, s), FAIL, vm.toString(uint256(f)));
        }
    }

    /// forge-config: default.fuzz.runs = 48
    function testFuzz_randomSignature_returnsFail(bytes32 h, bytes32 seed) public {
        (bytes memory key,,) = _preparedFixture();
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
        (bytes memory key, bytes32 h, bytes memory sig) = _preparedFixture();
        pos = bound(pos, 0, sig.length - 1);
        sig[pos] ^= bytes1(mask);
        assertEq(v.verify(key, h, sig), FAIL);
    }

    // ---------------------------------------------------------------- live dev-signer (FFI)

    function test_devsign_roundTrips() public devsign {
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

    function test_devsign_sameKeyManyMessages() public devsign {
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
        (bytes memory key, bytes32 h, bytes memory sig) = _preparedFixture();
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

    // ---------------------------------------------------------------- key preparation

    function test_prepareKey_idempotentAndEmits() public {
        (bytes memory pk,,) = _fixture("mldsa44");
        address expected = _blob(pk);
        vm.expectEmit(address(store));
        emit MLDSA44ExpandedKeyStore.KeyPrepared(keccak256(pk), expected);
        assertEq(v.prepareKey(_inline(pk)), expected);

        bytes memory ptrKey = abi.encodePacked(_ptr(pk));
        vm.recordLogs();
        uint256 g = gasleft();
        assertEq(store.prepare(ptrKey), expected, "pointer form, same blob");
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
        vm.expectRevert(MLDSA44ExpandedKeyStore.NotPendingBlob.selector);
        store.pendingBlob();
        vm.prank(address(0));
        vm.expectRevert(MLDSA44ExpandedKeyStore.NotPendingBlob.selector);
        store.pendingBlob();
    }

    function test_blobAddress_isCreate2OfConstantInitCode() public view {
        bytes32 pkHash = keccak256("pk");
        bytes memory init = abi.encodePacked(
            hex"63",
            MLDSA44ExpandedKeyStore.pendingBlob.selector,
            hex"5f525f5f6004601c335afa6016575f5ffd5b3d5f5f3e3d5ff3"
        );
        assertEq(store.blobInitCode(), init);
        assertEq(store.BLOB_INIT_CODE_HASH(), keccak256(init));
        address expected = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(store), pkHash, keccak256(init)))))
        );
        assertEq(store.blobAddress(pkHash), expected);
        assertEq(v.blobAddress(pkHash), expected);
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

    /// @dev The noble dev-signer fixture: its message stands in for the userOpHash. Runs without FFI.
    function test_validator_fixtureUserOp() public {
        (bytes memory pk, bytes32 userOpHash, bytes memory sig) = _fixture("mldsa44_devsign");
        address ptr = _ptr(pk);
        address blob = v.prepareKey(abi.encodePacked(ptr));
        QuantumValidator qv = new QuantumValidator();
        _install(qv, address(v), ptr);

        (uint256 r, uint256 g) = _validateCold(qv, ptr, blob, userOpHash, sig);
        assertEq(r, 0, "valid user operation");
        emit log_named_uint("gas: QuantumValidator.validateUserOp, Solidity ML-DSA-44, pointer (cold)", g);
        (r,) = _validateCold(qv, ptr, blob, userOpHash, _flip(sig, 1000));
        assertEq(r, 1, "tampered signature");
        (r,) = _validateCold(qv, ptr, blob, ~userOpHash, sig);
        assertEq(r, 1, "signature over another hash");
    }

    function test_validator_devsignUserOp() public devsign {
        bytes32 seed = _seed("validator", 0);
        bytes memory pk = pqKeygen("mldsa44", seed);
        address ptr = _ptr(pk);
        address blob = v.prepareKey(abi.encodePacked(ptr));
        QuantumValidator qv = new QuantumValidator();
        _install(qv, address(v), ptr);

        bytes32 userOpHash = bytes32(vm.randomUint());
        bytes memory sig = pqSign("mldsa44", seed, abi.encodePacked(userOpHash));
        (uint256 r,) = _validateCold(qv, ptr, blob, userOpHash, sig);
        assertEq(r, 0, "valid user operation");
        (r,) = _validateCold(qv, ptr, blob, userOpHash, _flip(sig, 1000));
        assertEq(r, 1, "tampered signature");
        (r,) = _validateCold(qv, ptr, blob, ~userOpHash, sig);
        assertEq(r, 1, "signature over another hash");
    }

    function test_validator_unpreparedKey_fails() public {
        (bytes memory pk, bytes32 userOpHash, bytes memory sig) = _fixture("mldsa44_devsign");
        address ptr = _ptr(pk);
        QuantumValidator qv = new QuantumValidator();
        _install(qv, address(v), ptr);
        (uint256 r,) = _validateCold(qv, ptr, _blob(pk), userOpHash, sig);
        assertEq(r, 1, "KeyNotPrepared is a failed validation");
        v.prepareKey(abi.encodePacked(ptr));
        (r,) = _validateCold(qv, ptr, _blob(pk), userOpHash, sig);
        assertEq(r, 0, "valid once prepared");
    }

    /// @dev The account keeps its KeyStore pointer when it changes verifier: `rotateKey(verifier,
    ///      keyPtr)` with the same pointer, here to a second deployment standing in for the Stylus
    ///      one. It shares the expanded-key store, so the key needs no second preparation.
    function test_validator_rotateVerifier_keepsKeyPointer() public {
        (bytes memory pk, bytes32 userOpHash, bytes memory sig) = _fixture("mldsa44_devsign");
        address ptr = _ptr(pk);
        v.prepareKey(abi.encodePacked(ptr));
        QuantumValidator qv = new QuantumValidator();
        _install(qv, address(v), ptr);

        SolidityMLDSA44Verifier next = new SolidityMLDSA44Verifier(core, store);
        assertTrue(next.isPrepared(abi.encodePacked(ptr)), "prepared keys outlive the verifier");
        vm.prank(ACCOUNT);
        qv.rotateKey(address(next), ptr);

        PackedUserOperation memory op;
        op.sender = ACCOUNT;
        op.signature = sig;
        vm.prank(ACCOUNT);
        assertEq(qv.validateUserOp(op, userOpHash), 0);
        assertEq(qv.configOf(ACCOUNT).verifier, address(next));
    }
}
