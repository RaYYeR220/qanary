// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DevSign} from "../utils/DevSign.sol";
import {Fixtures} from "../utils/Fixtures.sol";
import {KeyStore} from "../../src/KeyStore.sol";
import {IQanaryPQVerifier} from "../../src/interfaces/IQanaryPQVerifier.sol";
import {ILadderVerifier} from "../../src/interfaces/ILadderVerifier.sol";

/// @notice End-to-end tests of the Stylus verifiers (real WASM under arbos-forge) with live
///         dev-signer keys and signatures. Run with `scripts/stylus-test.sh`.
/// @dev Gas figures are call-frame gas measured around a cold call (`vm.cool` on the program and
///      the key pointer); they exclude intrinsic and calldata gas. Tests marked `pointerReads` need
///      `STYLUS_POINTER_TESTS=true` (see `DevSign.pointerReads`).
contract StylusVerifiersTest is DevSign {
    bytes4 internal constant MAGIC = 0x024ad318;
    bytes4 internal constant FAIL = 0xffffffff;

    uint8 internal constant FNDSA512 = 1;
    uint8 internal constant MLDSA44 = 2;
    uint8 internal constant MLDSA65 = 3;
    uint8 internal constant FALCON512 = 4;

    address internal mldsa44;
    address internal mldsa65;
    address internal falcon;
    address internal ladder;
    KeyStore internal ks;

    function setUp() public {
        if (!stylusEnabled()) return;
        (mldsa44, mldsa65, falcon, ladder) = deployVerifiers();
        ks = new KeyStore();
    }

    // ---------------------------------------------------------------- helpers

    function _seed(string memory scheme) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("qanary-devsign/", scheme));
    }

    /// @dev Fresh devsign key and a signature over a random 32-byte hash.
    function _signed(string memory scheme) internal returns (bytes memory pk, bytes32 h, bytes memory sig) {
        bytes32 seed = _seed(scheme);
        pk = pqKeygen(scheme, seed);
        h = bytes32(vm.randomUint());
        sig = pqSign(scheme, seed, abi.encodePacked(h));
    }

    /// @dev Cold `verify` call; requires success and returns the verdict and the call-frame gas.
    function _verify(address v, bytes memory key, bytes32 h, bytes memory sig)
        internal
        returns (bytes4 result, uint256 gasUsed)
    {
        bytes memory data = abi.encodeCall(IQanaryPQVerifier.verify, (key, h, sig));
        vm.cool(v);
        if (key.length == 20) vm.cool(address(bytes20(key)));
        uint256 g = gasleft();
        (bool ok, bytes memory ret) = v.staticcall(data);
        gasUsed = g - gasleft();
        assertTrue(ok, "verify reverted");
        result = abi.decode(ret, (bytes4));
    }

    function _expectVerifyRevert(address v, bytes memory key, bytes memory expected) internal view {
        bytes memory data = abi.encodeCall(IQanaryPQVerifier.verify, (key, bytes32(0), new bytes(0)));
        (bool ok, bytes memory ret) = v.staticcall(data);
        assertFalse(ok, "verify did not revert");
        assertEq(ret, expected, "revert data");
    }

    function _inline(string memory scheme, uint8 id, address v) internal {
        (bytes memory pk, bytes32 h, bytes memory sig) = _signed(scheme);
        bytes memory key = abi.encodePacked(id, pk);
        (bytes4 r, uint256 g) = _verify(v, key, h, sig);
        assertEq(r, MAGIC, "valid signature, inline key");
        emit log_named_uint(string.concat("gas: ", scheme, " verify, inline key"), g);

        sig[sig.length / 2] ^= 0x01;
        (r, g) = _verify(v, key, h, sig);
        assertEq(r, FAIL, "flipped signature byte");
        emit log_named_uint(string.concat("gas: ", scheme, " verify, inline key, invalid signature"), g);
    }

    function _pointer(string memory scheme, uint8 id, address v) internal {
        (bytes memory pk, bytes32 h, bytes memory sig) = _signed(scheme);
        address ptr = ks.store(abi.encodePacked(id, pk));
        (bytes4 r, uint256 g) = _verify(v, abi.encodePacked(ptr), h, sig);
        assertEq(r, MAGIC, "valid signature, KeyStore pointer");
        emit log_named_uint(string.concat("gas: ", scheme, " verify, KeyStore pointer"), g);

        (r,) = _verify(v, abi.encodePacked(ptr), ~h, sig);
        assertEq(r, FAIL, "other hash, KeyStore pointer");
    }

    // ---------------------------------------------------------------- inline keys

    function test_mldsa44_inline() public stylusOnly {
        _inline("mldsa44", MLDSA44, mldsa44);
    }

    function test_mldsa65_inline() public stylusOnly {
        _inline("mldsa65", MLDSA65, mldsa65);
    }

    function test_falcon512_inline() public stylusOnly {
        _inline("falcon512", FALCON512, falcon);
    }

    function _fndsaFixture() internal view returns (bytes memory key, bytes32 h, bytes memory sig) {
        key = abi.encodePacked(FNDSA512, Fixtures.hexFile(vm, "fndsa512.pk"));
        h = bytes32(Fixtures.hexFile(vm, "fndsa512.msg"));
        sig = Fixtures.hexFile(vm, "fndsa512.sig");
    }

    /// @dev The Falcon program also verifies FN-DSA-512 (scheme 1) on the context-free path.
    function test_fndsa512_inline() public stylusOnly {
        (bytes memory key, bytes32 h, bytes memory sig) = _fndsaFixture();
        (bytes4 r, uint256 g) = _verify(falcon, key, h, sig);
        assertEq(r, MAGIC, "FN-DSA fixture, inline key");
        emit log_named_uint("gas: fndsa512 verify, inline key", g);

        (r,) = _verify(falcon, key, ~h, sig);
        assertEq(r, FAIL, "FN-DSA fixture, other hash");
    }

    function _unsupportedInline(address v, uint8 supportedA, uint8 supportedB) internal view {
        for (uint8 s = 0; s <= 5; ++s) {
            if (s == supportedA || s == supportedB) continue;
            _expectVerifyRevert(
                v,
                abi.encodePacked(s, new bytes(1312)),
                abi.encodeWithSelector(IQanaryPQVerifier.UnsupportedScheme.selector, s)
            );
        }
    }

    function test_wrongScheme_inline_revertsUnsupportedScheme() public stylusOnly {
        _unsupportedInline(mldsa44, MLDSA44, MLDSA44);
        _unsupportedInline(mldsa65, MLDSA65, MLDSA65);
        _unsupportedInline(falcon, FNDSA512, FALCON512);
    }

    // ---------------------------------------------------------------- KeyStore pointers

    function test_mldsa44_pointer() public stylusOnly pointerReads {
        _pointer("mldsa44", MLDSA44, mldsa44);
    }

    function test_mldsa65_pointer() public stylusOnly pointerReads {
        _pointer("mldsa65", MLDSA65, mldsa65);
    }

    function test_falcon512_pointer() public stylusOnly pointerReads {
        _pointer("falcon512", FALCON512, falcon);
    }

    function test_fndsa512_pointer() public stylusOnly pointerReads {
        (bytes memory key, bytes32 h, bytes memory sig) = _fndsaFixture();
        address ptr = ks.store(key);
        (bytes4 r, uint256 g) = _verify(falcon, abi.encodePacked(ptr), h, sig);
        assertEq(r, MAGIC, "FN-DSA fixture, KeyStore pointer");
        emit log_named_uint("gas: fndsa512 verify, KeyStore pointer", g);
    }

    function _unsupportedPointer(address v, uint8 supportedA, uint8 supportedB) internal {
        for (uint8 s = 0; s <= 5; ++s) {
            if (s == supportedA || s == supportedB) continue;
            _expectVerifyRevert(
                v,
                abi.encodePacked(ks.store(abi.encodePacked(s, new bytes(1312)))),
                abi.encodeWithSelector(IQanaryPQVerifier.UnsupportedScheme.selector, s)
            );
        }
    }

    function test_wrongScheme_pointer_revertsUnsupportedScheme() public stylusOnly pointerReads {
        _unsupportedPointer(mldsa44, MLDSA44, MLDSA44);
        _unsupportedPointer(mldsa65, MLDSA65, MLDSA65);
        _unsupportedPointer(falcon, FNDSA512, FALCON512);
    }

    function test_badPointer_revertsInvalidKey() public stylusOnly pointerReads {
        address eoa = makeAddr("eoa");
        vm.deal(eoa, 1 ether);
        address empty = address(0xE111D7);
        bytes memory expected = abi.encodeWithSelector(IQanaryPQVerifier.InvalidKey.selector);
        address[3] memory verifiers = [mldsa44, mldsa65, falcon];
        for (uint256 i = 0; i < verifiers.length; ++i) {
            _expectVerifyRevert(verifiers[i], abi.encodePacked(eoa), expected);
            _expectVerifyRevert(verifiers[i], abi.encodePacked(empty), expected);
            // deployed code that does not start with the STOP byte: the KeyStore and a Stylus program
            _expectVerifyRevert(verifiers[i], abi.encodePacked(address(ks)), expected);
            _expectVerifyRevert(verifiers[i], abi.encodePacked(ladder), expected);
        }
    }

    // ---------------------------------------------------------------- ladder

    function _ladder(uint8 curve, string memory file) internal {
        string memory json = Fixtures.jsonFile(vm, string.concat("ladder/", file, ".json"));
        assertTrue(vm.parseJsonBool(json, ".vectors[0].valid"), "vector 0 is valid");
        bytes32 qx = vm.parseJsonBytes32(json, ".vectors[0].qx");
        bytes32 qy = vm.parseJsonBytes32(json, ".vectors[0].qy");
        bytes32 digest = vm.parseJsonBytes32(json, ".vectors[0].digest");
        bytes32 r = vm.parseJsonBytes32(json, ".vectors[0].r");
        bytes32 s = vm.parseJsonBytes32(json, ".vectors[0].s");

        ILadderVerifier lv = ILadderVerifier(ladder);
        vm.cool(ladder);
        uint256 g = gasleft();
        bool ok = lv.verify(curve, qx, qy, digest, r, s);
        g -= gasleft();
        assertTrue(ok, string.concat(file, ": valid vector"));
        emit log_named_uint(string.concat("gas: ladder verify, ", file), g);

        // ECDSA keeps only the leftmost bits of the digest (as many as the order has), so tamper the top bit
        assertFalse(
            lv.verify(curve, qx, qy, digest ^ bytes32(uint256(1) << 255), r, s),
            string.concat(file, ": tampered digest")
        );
        assertFalse(lv.verify(curve, qx, qy, digest, r, s ^ bytes32(uint256(1))), string.concat(file, ": tampered s"));
    }

    function test_ladder_vectors() public stylusOnly {
        _ladder(1, "secp160r1");
        _ladder(2, "p192");
        _ladder(3, "p224");
    }
}
