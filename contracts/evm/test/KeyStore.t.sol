// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {KeyStore} from "../src/KeyStore.sol";

contract KeyStoreTest is Test {
    KeyStore internal ks;
    bytes internal blob;

    function setUp() public {
        ks = new KeyStore();
        blob = abi.encodePacked(uint8(2), new bytes(1312));
    }

    function test_storeDeploysStopPrefixedCode() public {
        bytes memory blob = abi.encodePacked(uint8(2), new bytes(1312));
        address p = ks.store(blob);
        assertEq(p.code, abi.encodePacked(bytes1(0x00), blob));
        assertEq(p, ks.pointerOf(blob));
    }

    function test_storeIsIdempotent() public {
        address a = ks.store(blob);
        address b = ks.store(blob);
        assertEq(a, b);
    }

    function test_readStripsPrefix() public {
        assertEq(ks.read(ks.store(blob)), blob);
    }

    function test_emptyBlobReverts() public {
        vm.expectRevert(KeyStore.EmptyBlob.selector);
        ks.store("");
    }

    function testFuzz_roundTrip(bytes calldata b) public {
        vm.assume(b.length > 0 && b.length < 24000);
        assertEq(ks.read(ks.store(b)), b);
    }
}
