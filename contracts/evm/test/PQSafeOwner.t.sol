// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Safe} from "@safe/Safe.sol";
import {Enum} from "@safe/common/Enum.sol";
import {SafeProxyFactory} from "@safe/proxies/SafeProxyFactory.sol";
import {SafeProxy} from "@safe/proxies/SafeProxy.sol";
import {PQSafeOwner} from "../src/safe/PQSafeOwner.sol";
import {PQSafeOwnerFactory} from "../src/safe/PQSafeOwnerFactory.sol";
import {KeyStore} from "../src/KeyStore.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {SafeSig} from "./helpers/SafeSig.sol";

contract PQSafeOwnerTest is Test {
    bytes4 internal constant MAGIC = 0x1626ba7e;
    bytes4 internal constant LEGACY_MAGIC = 0x20c13b0b;
    bytes4 internal constant INVALID = 0xffffffff;

    MockVerifier internal mv;
    KeyStore internal ks;
    PQSafeOwnerFactory internal factory;
    Safe internal singleton;
    SafeProxyFactory internal proxyFactory;

    address[] internal ptrs;
    PQSafeOwner[] internal owners; // sorted ascending by address

    function setUp() public {
        mv = new MockVerifier();
        ks = new KeyStore();
        factory = new PQSafeOwnerFactory();
        singleton = new Safe();
        proxyFactory = new SafeProxyFactory();
        for (uint256 i = 0; i < 3; i++) {
            address p = ks.store(abi.encodePacked(uint8(1), keccak256(abi.encode("pq", i))));
            ptrs.push(p);
            owners.push(factory.deploy(address(mv), p));
        }
        // sort ascending by owner address (insertion)
        for (uint256 i = 1; i < 3; i++) {
            for (uint256 j = i; j > 0 && address(owners[j]) < address(owners[j - 1]); j--) {
                (owners[j], owners[j - 1]) = (owners[j - 1], owners[j]);
                (ptrs[j], ptrs[j - 1]) = (ptrs[j - 1], ptrs[j]);
            }
        }
    }

    function _sig(address ptr, bytes32 hash) internal pure returns (bytes memory) {
        return abi.encode(abi.encodePacked(ptr), hash);
    }

    function _newSafe(uint256 nonce) internal returns (Safe safe) {
        address[] memory o = new address[](3);
        for (uint256 i = 0; i < 3; i++) o[i] = address(owners[i]);
        bytes memory init = abi.encodeCall(
            Safe.setup, (o, 3, address(0), "", address(0), address(0), 0, payable(address(0)))
        );
        safe = Safe(payable(address(proxyFactory.createProxyWithNonce(address(singleton), init, nonce))));
    }

    function _signAll(Safe safe, address to, uint256 value, uint256 count) internal view returns (bytes memory) {
        bytes memory data = safe.encodeTransactionData(
            to, value, "", Enum.Operation.Call, 0, 0, 0, address(0), address(0), safe.nonce()
        );
        bytes32 h = keccak256(data);
        address[] memory o = new address[](count);
        bytes[] memory s = new bytes[](count);
        for (uint256 i = 0; i < count; i++) {
            o[i] = address(owners[i]);
            s[i] = _sig(ptrs[i], h);
        }
        return SafeSig.contractSignatures(o, s);
    }

    function _exec(Safe safe, address to, uint256 value, bytes memory sigs) internal returns (bool) {
        return safe.execTransaction(to, value, "", Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), sigs);
    }

    function test_isValidSignature_bytes32() public view {
        bytes32 h = keccak256("m");
        assertEq(owners[0].isValidSignature(h, _sig(ptrs[0], h)), MAGIC);
        assertEq(owners[0].isValidSignature(h, _sig(ptrs[1], h)), INVALID);
        assertEq(owners[0].isValidSignature(keccak256("x"), _sig(ptrs[0], h)), INVALID);
    }

    function test_isValidSignature_legacyBytes() public view {
        bytes memory data = hex"deadbeef";
        bytes32 h = keccak256(data);
        assertEq(owners[0].isValidSignature(data, _sig(ptrs[0], h)), LEGACY_MAGIC);
        assertEq(owners[0].isValidSignature(data, _sig(ptrs[0], keccak256("other"))), INVALID);
    }

    function test_verifierRevert_returnsInvalid() public {
        mv.revertOn(abi.encodePacked(ptrs[0]));
        bytes32 h = keccak256("m");
        assertEq(owners[0].isValidSignature(h, _sig(ptrs[0], h)), INVALID);
    }

    function test_safe_3of3_executes() public {
        Safe safe = _newSafe(1);
        address to = address(0xBEEF);
        vm.deal(address(safe), 1 ether);
        bytes memory sigs = _signAll(safe, to, 0.5 ether, 3);
        uint256 g = gasleft();
        assertTrue(_exec(safe, to, 0.5 ether, sigs));
        emit log_named_uint("gas: 3-of-3 PQ execTransaction (mock)", g - gasleft());
        assertEq(to.balance, 0.5 ether);
    }

    function test_safe_twoSignaturesFailThreshold3() public {
        Safe safe = _newSafe(2);
        vm.deal(address(safe), 1 ether);
        bytes memory sigs = _signAll(safe, address(0xBEEF), 1, 2);
        // Two owners' signatures do not satisfy threshold 3 (offset of the missing third is invalid).
        vm.expectRevert("GS021");
        _exec(safe, address(0xBEEF), 1, sigs);
        // A signature blob shorter than threshold * 65 bytes is rejected outright.
        bytes memory shortSigs = new bytes(194);
        for (uint256 i = 0; i < 194; i++) shortSigs[i] = sigs[i];
        vm.expectRevert("GS020");
        _exec(safe, address(0xBEEF), 1, shortSigs);
    }

    function test_safe_replayOnOtherSafeFails() public {
        Safe a = _newSafe(3);
        Safe b = _newSafe(4);
        vm.deal(address(a), 1 ether);
        vm.deal(address(b), 1 ether);
        bytes memory sigsA = _signAll(a, address(0xBEEF), 1, 3);
        vm.expectRevert("GS024");
        _exec(b, address(0xBEEF), 1, sigsA);
        assertTrue(_exec(a, address(0xBEEF), 1, sigsA));
    }

    function test_factory_deterministic() public {
        address p = factory.predict(address(mv), ptrs[0]);
        assertEq(p, address(owners[0]));
        PQSafeOwner again = factory.deploy(address(mv), ptrs[0]);
        assertEq(address(again), p);
        address fresh = address(0x1234);
        address predicted = factory.predict(address(mv), fresh);
        vm.expectEmit(true, true, true, true);
        emit PQSafeOwnerFactory.OwnerDeployed(predicted, address(mv), fresh);
        assertEq(address(factory.deploy(address(mv), fresh)), predicted);
        assertEq(PQSafeOwner(predicted).verifier(), address(mv));
        assertEq(PQSafeOwner(predicted).keyPtr(), fresh);
    }
}
