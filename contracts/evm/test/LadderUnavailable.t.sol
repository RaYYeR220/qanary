// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CanaryTargets} from "../src/canary/CanaryTargets.sol";
import {DrillRegistryFactory} from "../src/canary/DrillRegistryFactory.sol";
import {LadderUnavailableVerifier} from "../src/canary/LadderUnavailable.sol";
import {QuantumCanaryRegistry} from "../src/canary/QuantumCanaryRegistry.sol";
import {ILadderVerifier} from "../src/interfaces/ILadderVerifier.sol";

/// @notice The ladder stand-in for chains without the Stylus ladder: every check reverts, so L1–L3
///         claims fail closed while K1 and R1 claims still trip the registry.
contract LadderUnavailableTest is Test {
    /// @dev d = SHA-256("QANARY-DRILL-V1/secp256k1") mod n, the published drill K1 key.
    uint256 internal constant DRILL_K1 = 0x14558aab84810af4717cd449817d3687d5ce9cec641599b5dd77f8862102baeb;

    LadderUnavailableVerifier internal ladder;
    QuantumCanaryRegistry internal drill;
    address internal claimant = makeAddr("claimant");

    function setUp() public {
        ladder = new LadderUnavailableVerifier();
        DrillRegistryFactory factory = new DrillRegistryFactory(ladder, IERC20(address(0)));
        drill = factory.create();
    }

    function test_verify_alwaysReverts() public {
        vm.expectRevert(LadderUnavailableVerifier.LadderUnavailable.selector);
        ladder.verify(
            1, bytes32(uint256(1)), bytes32(uint256(2)), bytes32(uint256(3)), bytes32(uint256(4)), bytes32(uint256(5))
        );
        vm.expectRevert(LadderUnavailableVerifier.LadderUnavailable.selector);
        ladder.verify(0, 0, 0, 0, 0, 0);
    }

    function testFuzz_verify_alwaysReverts(uint8 curve, bytes32 qx, bytes32 qy, bytes32 digest, bytes32 r, bytes32 s)
        public
    {
        vm.expectRevert(LadderUnavailableVerifier.LadderUnavailable.selector);
        ladder.verify(curve, qx, qy, digest, r, s);
    }

    function test_ladderClaims_failClosed() public {
        CanaryTargets.Targets memory t = drill.targets();
        for (uint8 target = 0; target < 3; ++target) {
            // the e ≡ 0 forgery shape, which a real ECDSA verifier would accept for a free digest
            bytes memory proof = abi.encode(t.l1x, t.l1x);
            vm.prank(claimant);
            vm.expectRevert(LadderUnavailableVerifier.LadderUnavailable.selector);
            drill.claim(target, proof);
            assertFalse(drill.claimed(target));
        }
        assertEq(drill.ladderLevel(), 0);
    }

    function test_k1Claim_stillTrips() public {
        bytes32 m = drill.claimMessage(3, claimant);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(DRILL_K1, m);
        vm.prank(claimant);
        drill.claim(3, abi.encode(v, r, s));
        assertTrue(drill.familyBroken(0));
        assertEq(drill.ladderLevel(), 3);
    }

    function test_canonicalRegistry_acceptsStub() public {
        QuantumCanaryRegistry live = new QuantumCanaryRegistry(
            ILadderVerifier(address(ladder)), IERC20(address(0)), CanaryTargets.nums(), false
        );
        assertEq(address(live.ladder()), address(ladder));
        assertFalse(live.isDrill());
    }
}
