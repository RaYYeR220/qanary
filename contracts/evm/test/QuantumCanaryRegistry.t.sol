// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {CanaryTargets} from "../src/canary/CanaryTargets.sol";
import {QuantumCanaryRegistry} from "../src/canary/QuantumCanaryRegistry.sol";
import {DrillRegistryFactory} from "../src/canary/DrillRegistryFactory.sol";
import {IQuantumCanaryRegistry} from "../src/interfaces/IQuantumCanaryRegistry.sol";
import {ILadderVerifier} from "../src/interfaces/ILadderVerifier.sol";
import {MockLadderVerifier} from "./mocks/MockLadderVerifier.sol";
import {TestToken} from "./mocks/TestToken.sol";
import {ControlledToken} from "./mocks/ControlledToken.sol";

/// @dev Claimant contract that re-enters `claim` when its ETH bounty arrives.
contract ReentrantClaimant {
    IQuantumCanaryRegistry public immutable registry;
    bool public swallow;
    uint8 public innerTarget;
    bytes public innerProof;
    bytes public innerError;

    constructor(IQuantumCanaryRegistry r) {
        registry = r;
    }

    function arm(bool swallow_, uint8 target, bytes calldata proof) external {
        swallow = swallow_;
        innerTarget = target;
        innerProof = proof;
    }

    function claim(uint8 target, bytes calldata proof) external {
        registry.claim(target, proof);
    }

    receive() external payable {
        if (!swallow) {
            registry.claim(innerTarget, innerProof);
            return;
        }
        try registry.claim(innerTarget, innerProof) {}
        catch (bytes memory err) {
            innerError = err;
        }
    }
}

/// @dev Claimant contract that can refuse ETH, and can re-enter `withdrawOwed` when ETH arrives.
contract ToggleClaimant {
    error Rejected();

    IQuantumCanaryRegistry public immutable registry;
    bool public accept;
    bool public reenter;
    bytes public innerError;

    constructor(IQuantumCanaryRegistry r) {
        registry = r;
    }

    function set(bool accept_, bool reenter_) external {
        accept = accept_;
        reenter = reenter_;
    }

    function claim(uint8 target, bytes calldata proof) external {
        registry.claim(target, proof);
    }

    function withdraw() external {
        registry.withdrawOwed();
    }

    receive() external payable {
        if (!accept) revert Rejected();
        if (reenter) {
            try registry.withdrawOwed() {}
            catch (bytes memory err) {
                innerError = err;
            }
        }
    }
}

contract QuantumCanaryRegistryTest is Test {
    // Drill keys, published in deployments/canary-targets.json ("drill").
    uint256 internal constant K1_KEY = 0x14558aab84810af4717cd449817d3687d5ce9cec641599b5dd77f8862102baeb;
    uint256 internal constant P256_KEY = 0x6c9c525b49f1c3c271e4b6c9f9f0643315b0545e994d5982ef4f5892efcb1296;
    bytes32 internal constant K1_X = 0x9a3ba9ecf721934d10d559bf8a24f949ca283105450ec73f5e4202decbc3e8fa;
    bytes32 internal constant K1_Y = 0x5f46ad247d6d7bce03f810ea522e9734aee4c071d1434304167fef83ab5b4559;
    uint256 internal constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    uint256 internal constant TOKEN_BOUNTY = 1_000e6;
    uint256 internal constant ETH_BOUNTY = 1 ether;

    MockLadderVerifier internal ladder;
    TestToken internal token;
    QuantumCanaryRegistry internal reg;
    address internal alice;
    address internal bob;
    address internal funder;

    function setUp() public {
        ladder = new MockLadderVerifier();
        token = new TestToken("USD Coin", "USDC", 6);
        reg = new QuantumCanaryRegistry(ladder, token, CanaryTargets.drill(), true);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        funder = makeAddr("funder");
        token.mint(funder, 100 * TOKEN_BOUNTY);
        vm.deal(funder, 100 ether);
    }

    // ------------------------------------------------------------------ helpers

    function _ladderKey(CanaryTargets.Targets memory t, uint8 target) internal pure returns (bytes32, bytes32) {
        if (target == 0) return (t.l1x, t.l1y);
        if (target == 1) return (t.l2x, t.l2y);
        return (t.l3x, t.l3y);
    }

    /// @dev Proof by the target key over `r`'s claim message for `claimant`.
    function _proof(QuantumCanaryRegistry r, uint8 target, address claimant) internal returns (bytes memory) {
        bytes32 m = r.claimMessage(target, claimant);
        if (target == 3) {
            (uint8 v, bytes32 sr, bytes32 ss) = vm.sign(K1_KEY, m);
            if (uint256(ss) > SECP256K1_N / 2) {
                ss = bytes32(SECP256K1_N - uint256(ss));
                v = v == 27 ? 28 : 27;
            }
            return abi.encode(v, sr, ss);
        }
        if (target == 4) {
            (bytes32 pr, bytes32 ps) = vm.signP256(P256_KEY, m);
            if (uint256(ps) > P256.N / 2) ps = bytes32(P256.N - uint256(ps));
            return abi.encode(pr, ps);
        }
        (bytes32 qx, bytes32 qy) = _ladderKey(r.targets(), target);
        bytes32 lr = keccak256(abi.encode("r", address(r), target, claimant));
        bytes32 ls = keccak256(abi.encode("s", address(r), target, claimant));
        ladder.accept(target + 1, qx, qy, m, lr, ls);
        return abi.encode(lr, ls);
    }

    function _fund(IQuantumCanaryRegistry r, uint8 target) internal {
        vm.startPrank(funder);
        token.approve(address(r), TOKEN_BOUNTY);
        r.fund(target, TOKEN_BOUNTY);
        r.fundETH{value: ETH_BOUNTY}(target);
        vm.stopPrank();
    }

    function _claim(uint8 target, address claimant) internal {
        bytes memory proof = _proof(reg, target, claimant);
        vm.prank(claimant);
        reg.claim(target, proof);
    }

    function _claimAndCheck(uint8 target, uint8 expectedLevel) internal {
        _fund(reg, target);
        bytes memory proof = _proof(reg, target, alice);
        uint8 previous = reg.ladderLevel();
        uint256 tokenBefore = token.balanceOf(alice);
        uint256 ethBefore = alice.balance;

        vm.expectEmit(address(reg));
        emit IQuantumCanaryRegistry.Claimed(target, alice, TOKEN_BOUNTY, ETH_BOUNTY);
        if (expectedLevel > previous) {
            vm.expectEmit(address(reg));
            emit IQuantumCanaryRegistry.LevelRaised(previous, expectedLevel);
        }
        if (target >= 3) {
            vm.expectEmit(address(reg));
            emit IQuantumCanaryRegistry.FamilyBroken(target - 3);
        }
        vm.prank(alice);
        reg.claim(target, proof);

        assertTrue(reg.claimed(target), "claimed");
        assertEq(reg.ladderLevel(), expectedLevel, "level");
        assertEq(token.balanceOf(alice) - tokenBefore, TOKEN_BOUNTY, "token paid");
        assertEq(alice.balance - ethBefore, ETH_BOUNTY, "eth paid");
        (uint256 tokenLeft, uint256 ethLeft) = reg.bounty(target);
        assertEq(tokenLeft, 0, "token bounty cleared");
        assertEq(ethLeft, 0, "eth bounty cleared");
        _assertOwed(reg, alice, 0, 0);
    }

    function _assertOwed(IQuantumCanaryRegistry r, address who, uint256 tokenAmount, uint256 ethAmount) internal view {
        assertEq(r.owedToken(who), tokenAmount, "owed token");
        assertEq(r.owedEth(who), ethAmount, "owed eth");
    }

    /// @dev Registry over a token the issuer can pause/blacklist, with `target` funded by `funder`.
    function _controlled(uint8 target, uint256 tokenAmount, uint256 ethAmount)
        internal
        returns (QuantumCanaryRegistry r, ControlledToken ct)
    {
        ct = new ControlledToken();
        r = new QuantumCanaryRegistry(ladder, ct, CanaryTargets.drill(), true);
        ct.mint(funder, tokenAmount);
        vm.startPrank(funder);
        ct.approve(address(r), tokenAmount);
        if (tokenAmount != 0) r.fund(target, tokenAmount);
        if (ethAmount != 0) r.fundETH{value: ethAmount}(target);
        vm.stopPrank();
    }

    function _countLevelRaised(Vm.Log[] memory logs) internal view returns (uint256 n) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(reg) && logs[i].topics[0] == IQuantumCanaryRegistry.LevelRaised.selector) {
                ++n;
            }
        }
    }

    // ------------------------------------------------------------------ targets & message

    function test_drillKeys_matchPublishedTargets() public {
        CanaryTargets.Targets memory t = CanaryTargets.drill();
        Vm.Wallet memory w = vm.createWallet(K1_KEY);
        assertEq(w.addr, t.k1);
        assertEq(bytes32(w.publicKeyX), K1_X);
        assertEq(bytes32(w.publicKeyY), K1_Y);
        (uint256 px, uint256 py) = vm.publicKeyP256(P256_KEY);
        assertEq(bytes32(px), t.r1x);
        assertEq(bytes32(py), t.r1y);
    }

    function test_constructor_exposesTargetsAndDrillFlag() public {
        assertEq(keccak256(abi.encode(reg.targets())), keccak256(abi.encode(CanaryTargets.drill())));
        assertTrue(reg.isDrill());
        assertEq(address(reg.ladder()), address(ladder));
        assertEq(address(reg.bountyToken()), address(token));
        assertEq(reg.ladderLevel(), 0);

        QuantumCanaryRegistry live = new QuantumCanaryRegistry(ladder, token, CanaryTargets.nums(), false);
        assertEq(keccak256(abi.encode(live.targets())), keccak256(abi.encode(CanaryTargets.nums())));
        assertFalse(live.isDrill());
    }

    function test_claimMessage_matchesSpec() public view {
        for (uint8 t; t < 5; ++t) {
            bytes32 expected =
                keccak256(abi.encode(keccak256("QANARY_CLAIM_V1"), block.chainid, address(reg), t, alice));
            assertEq(reg.claimMessage(t, alice), expected);
        }
        assertTrue(reg.claimMessage(0, alice) != reg.claimMessage(0, bob));
        assertTrue(reg.claimMessage(0, alice) != reg.claimMessage(1, alice));
    }

    // ------------------------------------------------------------------ successful claims

    function test_claim_L1_raisesLevelTo1() public {
        _claimAndCheck(0, 1);
        assertFalse(reg.familyBroken(0));
        assertFalse(reg.familyBroken(1));
    }

    function test_claim_L2_raisesLevelTo2() public {
        _claimAndCheck(1, 2);
        assertFalse(reg.familyBroken(0));
        assertFalse(reg.familyBroken(1));
    }

    function test_claim_L3_raisesLevelTo3() public {
        _claimAndCheck(2, 3);
        assertFalse(reg.familyBroken(0));
        assertFalse(reg.familyBroken(1));
    }

    function test_claim_K1_raisesLevelTo3_breaksSecp256k1() public {
        _claimAndCheck(3, 3);
        assertTrue(reg.familyBroken(0));
        assertFalse(reg.familyBroken(1));
    }

    function test_claim_R1_raisesLevelTo3_breaksP256() public {
        _claimAndCheck(4, 3);
        assertFalse(reg.familyBroken(0));
        assertTrue(reg.familyBroken(1));
    }

    function test_claim_fullLadder() public {
        _claimAndCheck(0, 1);
        _claimAndCheck(1, 2);
        _claimAndCheck(2, 3);
        _claimAndCheck(3, 3);
        _claimAndCheck(4, 3);
        assertTrue(reg.familyBroken(0));
        assertTrue(reg.familyBroken(1));
        assertEq(token.balanceOf(address(reg)), 0);
        assertEq(address(reg).balance, 0);
    }

    function test_claim_withoutBounty_stillRaisesSignal() public {
        bytes memory proof = _proof(reg, 3, alice);
        vm.expectEmit(address(reg));
        emit IQuantumCanaryRegistry.Claimed(3, alice, 0, 0);
        vm.prank(alice);
        reg.claim(3, proof);
        assertEq(reg.ladderLevel(), 3);
        assertTrue(reg.familyBroken(0));
    }

    function test_claim_L1AfterL3_keepsLevel3() public {
        _claim(2, alice);
        assertEq(reg.ladderLevel(), 3);
        vm.recordLogs();
        _claim(0, bob);
        assertEq(_countLevelRaised(vm.getRecordedLogs()), 0, "no LevelRaised");
        assertEq(reg.ladderLevel(), 3);
        assertTrue(reg.claimed(0));
    }

    function test_claim_R1AfterK1_keepsLevel_setsSecondFamily() public {
        _claim(3, alice);
        vm.recordLogs();
        _claim(4, alice);
        assertEq(_countLevelRaised(vm.getRecordedLogs()), 0, "no LevelRaised");
        assertEq(reg.ladderLevel(), 3);
        assertTrue(reg.familyBroken(0));
        assertTrue(reg.familyBroken(1));
    }

    function testFuzz_claim_levelNeverDecreases(uint256 seed) public {
        uint8[5] memory order = [0, 1, 2, 3, 4];
        for (uint256 i = 4; i > 0; --i) {
            uint256 j = uint256(keccak256(abi.encode(seed, i))) % (i + 1);
            (order[i], order[j]) = (order[j], order[i]);
        }
        uint8 expected;
        for (uint256 i; i < 5; ++i) {
            uint8 t = order[i];
            uint8 level = t < 3 ? t + 1 : 3;
            if (level > expected) expected = level;
            _claim(t, alice);
            assertEq(reg.ladderLevel(), expected);
        }
        assertTrue(reg.familyBroken(0));
        assertTrue(reg.familyBroken(1));
    }

    // ------------------------------------------------------------------ binding: claimant, registry, chain

    function test_claim_frontRunByOtherSender_reverts() public {
        for (uint8 t; t < 5; ++t) {
            bytes memory proof = _proof(reg, t, alice);
            vm.prank(bob);
            vm.expectRevert(IQuantumCanaryRegistry.InvalidProof.selector);
            reg.claim(t, proof);
        }
    }

    function test_claim_proofForOtherRegistry_reverts() public {
        QuantumCanaryRegistry other = new QuantumCanaryRegistry(ladder, token, CanaryTargets.drill(), true);
        for (uint8 t; t < 5; ++t) {
            bytes memory proof = _proof(reg, t, alice);
            vm.prank(alice);
            vm.expectRevert(IQuantumCanaryRegistry.InvalidProof.selector);
            other.claim(t, proof);
            vm.prank(alice);
            reg.claim(t, proof); // valid where it was made for
        }
    }

    function test_claim_proofForOtherChain_reverts() public {
        uint256 home = block.chainid;
        for (uint8 t; t < 5; ++t) {
            bytes memory proof = _proof(reg, t, alice);
            vm.chainId(42161);
            vm.prank(alice);
            vm.expectRevert(IQuantumCanaryRegistry.InvalidProof.selector);
            reg.claim(t, proof);
            vm.chainId(home);
            vm.prank(alice);
            reg.claim(t, proof);
        }
    }

    /// @dev Plain ECDSA over a caller-chosen digest is forgeable for any key: with e ≡ 0 the pair
    ///      (r, s) = (Qx, Qx) verifies (u1 = 0, u2 = 1). The registry fixes the digest itself.
    function test_claim_zeroDigestForgery_rejected() public {
        CanaryTargets.Targets memory t = reg.targets();
        for (uint8 i; i < 3; ++i) {
            (bytes32 qx, bytes32 qy) = _ladderKey(t, i);
            assertTrue(ladder.verify(i + 1, qx, qy, bytes32(0), qx, qx), "ladder forgery precondition");
            vm.prank(alice);
            vm.expectRevert(IQuantumCanaryRegistry.InvalidProof.selector);
            reg.claim(i, abi.encode(qx, qx));
        }

        // secp256k1: with e = 0, ecrecover(0, v, Qx, n - Qx) recovers -R = Q for the right parity.
        uint8 v = uint256(K1_Y) & 1 == 1 ? 27 : 28;
        bytes32 s = bytes32(SECP256K1_N - uint256(K1_X));
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(bytes32(0), v, K1_X, s);
        assertEq(uint8(err), uint8(ECDSA.RecoverError.NoError), "k1 forgery precondition");
        assertEq(recovered, t.k1, "k1 forgery precondition");
        vm.prank(alice);
        vm.expectRevert(IQuantumCanaryRegistry.InvalidProof.selector);
        reg.claim(3, abi.encode(v, K1_X, s));

        // P-256: (Qx, Qx) verifies over digest 0 (Qx < n/2 for the drill key, so low-s holds).
        assertTrue(P256.verify(bytes32(0), t.r1x, t.r1x, t.r1x, t.r1y), "r1 forgery precondition");
        vm.prank(alice);
        vm.expectRevert(IQuantumCanaryRegistry.InvalidProof.selector);
        reg.claim(4, abi.encode(t.r1x, t.r1x));

        assertEq(reg.ladderLevel(), 0);
        assertFalse(reg.familyBroken(0));
        assertFalse(reg.familyBroken(1));
    }

    // ------------------------------------------------------------------ rejected claims

    function test_claim_twice_reverts() public {
        _claim(0, alice);
        for (uint8 t = 1; t < 5; ++t) {
            _claim(t, alice);
        }
        for (uint8 t; t < 5; ++t) {
            bytes memory proof = _proof(reg, t, bob);
            vm.prank(bob);
            vm.expectRevert(abi.encodeWithSelector(IQuantumCanaryRegistry.AlreadyClaimed.selector, t));
            reg.claim(t, proof);
        }
    }

    function test_claim_invalidTarget_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(IQuantumCanaryRegistry.InvalidTarget.selector, 5));
        reg.claim(5, abi.encode(bytes32(uint256(1)), bytes32(uint256(1))));
        vm.expectRevert(abi.encodeWithSelector(IQuantumCanaryRegistry.InvalidTarget.selector, 255));
        reg.claim(255, "");
    }

    function test_claim_malformedProof_reverts() public {
        bytes memory k1 = _proof(reg, 3, alice);
        (uint8 v, bytes32 r, bytes32 s) = abi.decode(k1, (uint8, bytes32, bytes32));
        bytes[6] memory bad = [
            bytes(""),
            abi.encode(r, s, s),
            bytes.concat(abi.encode(r), bytes16(s)),
            abi.encode(r, s),
            abi.encode(uint256(v) + 256, r, s), // truncates to the valid v if cast blindly
            bytes.concat(k1, bytes1(0))
        ];
        uint8[6] memory targets = [0, 1, 4, 3, 3, 3];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(alice);
            vm.expectRevert(IQuantumCanaryRegistry.InvalidProof.selector);
            reg.claim(targets[i], bad[i]);
        }
        vm.prank(alice);
        reg.claim(3, k1);
    }

    function test_claim_K1_zeroRecovery_reverts() public {
        bytes32 m = reg.claimMessage(3, alice);
        (, bytes32 r, bytes32 s) = abi.decode(_proof(reg, 3, alice), (uint8, bytes32, bytes32));
        assertEq(ecrecover(m, 29, r, s), address(0));
        assertEq(ecrecover(m, 27, bytes32(0), s), address(0));
        bytes[3] memory zero =
            [abi.encode(uint8(29), r, s), abi.encode(uint8(27), bytes32(0), s), abi.encode(uint8(0), r, s)];
        for (uint256 i; i < zero.length; ++i) {
            vm.prank(alice);
            vm.expectRevert(IQuantumCanaryRegistry.InvalidProof.selector);
            reg.claim(3, zero[i]);
        }
    }

    function test_claim_K1_highS_reverts() public {
        bytes32 m = reg.claimMessage(3, alice);
        bytes memory proof = _proof(reg, 3, alice);
        (uint8 v, bytes32 r, bytes32 s) = abi.decode(proof, (uint8, bytes32, bytes32));
        uint8 vHigh = v == 27 ? 28 : 27;
        bytes32 sHigh = bytes32(SECP256K1_N - uint256(s));
        assertEq(ecrecover(m, vHigh, r, sHigh), reg.targets().k1, "raw ecrecover accepts high s");
        vm.prank(alice);
        vm.expectRevert(IQuantumCanaryRegistry.InvalidProof.selector);
        reg.claim(3, abi.encode(vHigh, r, sHigh));
        vm.prank(alice);
        reg.claim(3, proof);
    }

    function test_claim_R1_zeroOrHighRS_reverts() public {
        (bytes32 r, bytes32 s) = abi.decode(_proof(reg, 4, alice), (bytes32, bytes32));
        bytes[3] memory bad =
            [abi.encode(bytes32(0), s), abi.encode(r, bytes32(0)), abi.encode(r, bytes32(P256.N - uint256(s)))];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(alice);
            vm.expectRevert(IQuantumCanaryRegistry.InvalidProof.selector);
            reg.claim(4, bad[i]);
        }
    }

    function test_claim_liveTargets_rejectDrillKeys() public {
        QuantumCanaryRegistry live = new QuantumCanaryRegistry(ladder, token, CanaryTargets.nums(), false);
        bytes[2] memory proofs = [_proof(live, 3, alice), _proof(live, 4, alice)];
        for (uint8 i; i < 2; ++i) {
            vm.prank(alice);
            vm.expectRevert(IQuantumCanaryRegistry.InvalidProof.selector);
            live.claim(3 + i, proofs[i]);
        }
    }

    // ------------------------------------------------------------------ funding

    function test_fund_accumulates() public {
        address other = makeAddr("other");
        token.mint(other, TOKEN_BOUNTY);
        vm.deal(other, 1 ether);

        vm.startPrank(funder);
        token.approve(address(reg), 300e6);
        vm.expectEmit(address(reg));
        emit IQuantumCanaryRegistry.Funded(0, funder, 300e6, 0);
        reg.fund(0, 300e6);
        vm.expectEmit(address(reg));
        emit IQuantumCanaryRegistry.Funded(0, funder, 0, 2 ether);
        reg.fundETH{value: 2 ether}(0);
        vm.stopPrank();

        vm.startPrank(other);
        token.approve(address(reg), 200e6);
        reg.fund(0, 200e6);
        reg.fundETH{value: 0.5 ether}(4);
        vm.stopPrank();

        (uint256 tok0, uint256 eth0) = reg.bounty(0);
        assertEq(tok0, 500e6);
        assertEq(eth0, 2 ether);
        (uint256 tok4, uint256 eth4) = reg.bounty(4);
        assertEq(tok4, 0);
        assertEq(eth4, 0.5 ether);
        assertEq(token.balanceOf(address(reg)), 500e6);
        assertEq(address(reg).balance, 2.5 ether);

        uint256 before = token.balanceOf(alice);
        _claim(0, alice);
        assertEq(token.balanceOf(alice) - before, 500e6);
        assertEq(alice.balance, 2 ether);
        assertEq(address(reg).balance, 0.5 ether);
    }

    function test_fund_claimedTarget_reverts() public {
        _claim(1, alice);
        vm.startPrank(funder);
        token.approve(address(reg), TOKEN_BOUNTY);
        vm.expectRevert(abi.encodeWithSelector(IQuantumCanaryRegistry.AlreadyClaimed.selector, 1));
        reg.fund(1, TOKEN_BOUNTY);
        vm.expectRevert(abi.encodeWithSelector(IQuantumCanaryRegistry.AlreadyClaimed.selector, 1));
        reg.fundETH{value: 1 ether}(1);
        vm.stopPrank();
    }

    function test_fund_invalidTarget_reverts() public {
        vm.startPrank(funder);
        token.approve(address(reg), TOKEN_BOUNTY);
        vm.expectRevert(abi.encodeWithSelector(IQuantumCanaryRegistry.InvalidTarget.selector, 5));
        reg.fund(5, TOKEN_BOUNTY);
        vm.expectRevert(abi.encodeWithSelector(IQuantumCanaryRegistry.InvalidTarget.selector, 5));
        reg.fundETH{value: 1 ether}(5);
        vm.stopPrank();
    }

    function test_plainEthTransfer_reverts() public {
        vm.prank(funder);
        (bool ok,) = address(reg).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_noBountyToken_ethOnly() public {
        QuantumCanaryRegistry ethOnly =
            new QuantumCanaryRegistry(ladder, IERC20(address(0)), CanaryTargets.drill(), true);
        vm.startPrank(funder);
        vm.expectRevert(IQuantumCanaryRegistry.TokenBountiesDisabled.selector);
        ethOnly.fund(3, 1);
        ethOnly.fundETH{value: ETH_BOUNTY}(3);
        vm.stopPrank();

        bytes memory proof = _proof(ethOnly, 3, alice);
        vm.expectEmit(address(ethOnly));
        emit IQuantumCanaryRegistry.Claimed(3, alice, 0, ETH_BOUNTY);
        vm.prank(alice);
        ethOnly.claim(3, proof);
        assertEq(alice.balance, ETH_BOUNTY);
        assertTrue(ethOnly.familyBroken(0));
    }

    // ------------------------------------------------------------------ reentrancy

    function test_reentrantClaim_swallowed_outerSucceeds() public {
        ReentrantClaimant attacker = new ReentrantClaimant(reg);
        _fund(reg, 0);
        attacker.arm(true, 1, _proof(reg, 1, address(attacker)));
        attacker.claim(0, _proof(reg, 0, address(attacker)));

        assertEq(
            attacker.innerError(),
            abi.encodeWithSelector(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector)
        );
        assertTrue(reg.claimed(0));
        assertFalse(reg.claimed(1));
        assertEq(reg.ladderLevel(), 1);
        assertEq(address(attacker).balance, ETH_BOUNTY);
        assertEq(token.balanceOf(address(attacker)), TOKEN_BOUNTY);

        attacker.claim(1, attacker.innerProof()); // outside the payout the same proof is fine
        assertEq(reg.ladderLevel(), 2);
    }

    function test_reentrantClaim_bubbled_signalStands_ethDeferred() public {
        ReentrantClaimant attacker = new ReentrantClaimant(reg);
        _fund(reg, 0);
        attacker.arm(false, 1, _proof(reg, 1, address(attacker)));
        bytes memory proof = _proof(reg, 0, address(attacker));
        vm.expectEmit(address(reg));
        emit IQuantumCanaryRegistry.PayoutDeferred(address(attacker), 0, ETH_BOUNTY);
        attacker.claim(0, proof);

        assertTrue(reg.claimed(0));
        assertFalse(reg.claimed(1));
        assertEq(reg.ladderLevel(), 1);
        assertEq(token.balanceOf(address(attacker)), TOKEN_BOUNTY);
        assertEq(address(attacker).balance, 0);
        _assertOwed(reg, address(attacker), 0, ETH_BOUNTY);

        // Its receive hook still re-enters `claim`, now inside `withdrawOwed`: the pull fails, the credit stays.
        vm.prank(address(attacker));
        vm.expectRevert(IQuantumCanaryRegistry.EthWithdrawFailed.selector);
        reg.withdrawOwed();
        _assertOwed(reg, address(attacker), 0, ETH_BOUNTY);
        assertFalse(reg.claimed(1));
    }

    function test_withdrawOwed_reentry_paysOnce() public {
        ToggleClaimant c = new ToggleClaimant(reg);
        _fund(reg, 4);
        c.claim(4, _proof(reg, 4, address(c)));
        _assertOwed(reg, address(c), 0, ETH_BOUNTY);

        c.set(true, true);
        c.withdraw();
        assertEq(c.innerError(), abi.encodeWithSelector(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector));
        assertEq(address(c).balance, ETH_BOUNTY);
        assertEq(address(reg).balance, 0);
        _assertOwed(reg, address(c), 0, 0);
    }

    // ------------------------------------------------------------------ payout never gates the signal

    function test_claim_tokenPaused_signalStands_tokenDeferred() public {
        (QuantumCanaryRegistry r, ControlledToken ct) = _controlled(3, TOKEN_BOUNTY, ETH_BOUNTY);
        ct.setPaused(true);
        bytes memory proof = _proof(r, 3, alice);

        vm.expectEmit(address(r));
        emit IQuantumCanaryRegistry.Claimed(3, alice, TOKEN_BOUNTY, ETH_BOUNTY);
        vm.expectEmit(address(r));
        emit IQuantumCanaryRegistry.PayoutDeferred(alice, TOKEN_BOUNTY, 0);
        vm.prank(alice);
        r.claim(3, proof);

        assertTrue(r.claimed(3));
        assertEq(r.ladderLevel(), 3);
        assertTrue(r.familyBroken(0));
        assertEq(alice.balance, ETH_BOUNTY, "eth still pushed");
        assertEq(ct.balanceOf(alice), 0);
        _assertOwed(r, alice, TOKEN_BOUNTY, 0);

        vm.prank(alice);
        vm.expectRevert(ControlledToken.TokenPaused.selector);
        r.withdrawOwed();
        _assertOwed(r, alice, TOKEN_BOUNTY, 0);

        ct.setPaused(false);
        vm.expectEmit(address(r));
        emit IQuantumCanaryRegistry.OwedWithdrawn(alice, TOKEN_BOUNTY, 0);
        vm.prank(alice);
        r.withdrawOwed();
        assertEq(ct.balanceOf(alice), TOKEN_BOUNTY);
        assertEq(ct.balanceOf(address(r)), 0);
        _assertOwed(r, alice, 0, 0);

        vm.prank(alice);
        vm.expectRevert(IQuantumCanaryRegistry.NothingOwed.selector);
        r.withdrawOwed();
    }

    function test_claim_claimantBlacklisted_signalStands_tokenDeferred() public {
        (QuantumCanaryRegistry r, ControlledToken ct) = _controlled(4, TOKEN_BOUNTY, 0);
        ct.setBlocked(alice, true);
        bytes memory proof = _proof(r, 4, alice);
        vm.prank(alice);
        r.claim(4, proof);

        assertTrue(r.claimed(4));
        assertEq(r.ladderLevel(), 3);
        assertTrue(r.familyBroken(1));
        _assertOwed(r, alice, TOKEN_BOUNTY, 0);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ControlledToken.Blacklisted.selector, alice));
        r.withdrawOwed();

        ct.setBlocked(alice, false);
        vm.prank(alice);
        r.withdrawOwed();
        assertEq(ct.balanceOf(alice), TOKEN_BOUNTY);
    }

    /// @dev `fund` is permissionless: a 1-unit bounty must not hand the token issuer a veto over the alarm.
    function test_claim_dustBountyOnFrozenRegistry_signalStands() public {
        (QuantumCanaryRegistry r, ControlledToken ct) = _controlled(0, 1, 0);
        ct.setBlocked(address(r), true);
        bytes memory proof = _proof(r, 0, alice);
        vm.prank(alice);
        r.claim(0, proof);
        assertTrue(r.claimed(0));
        assertEq(r.ladderLevel(), 1);
        _assertOwed(r, alice, 1, 0);
    }

    function test_claim_ethRejected_signalStands_ethDeferred() public {
        ToggleClaimant c = new ToggleClaimant(reg);
        _fund(reg, 4);
        bytes memory proof = _proof(reg, 4, address(c));

        vm.expectEmit(address(reg));
        emit IQuantumCanaryRegistry.PayoutDeferred(address(c), 0, ETH_BOUNTY);
        c.claim(4, proof);

        assertTrue(reg.claimed(4));
        assertTrue(reg.familyBroken(1));
        assertEq(reg.ladderLevel(), 3);
        assertEq(token.balanceOf(address(c)), TOKEN_BOUNTY, "token still pushed");
        assertEq(address(c).balance, 0);
        _assertOwed(reg, address(c), 0, ETH_BOUNTY);

        vm.expectRevert(IQuantumCanaryRegistry.EthWithdrawFailed.selector);
        c.withdraw();
        _assertOwed(reg, address(c), 0, ETH_BOUNTY);

        c.set(true, false);
        vm.expectEmit(address(reg));
        emit IQuantumCanaryRegistry.OwedWithdrawn(address(c), 0, ETH_BOUNTY);
        c.withdraw();
        assertEq(address(c).balance, ETH_BOUNTY);
        _assertOwed(reg, address(c), 0, 0);
    }

    function test_withdrawOwed_nothingOwed_reverts() public {
        vm.prank(alice);
        vm.expectRevert(IQuantumCanaryRegistry.NothingOwed.selector);
        reg.withdrawOwed();
    }

    // ------------------------------------------------------------------ canonical targets

    function test_constructor_nonDrillRequiresNumsTargets() public {
        vm.expectRevert(QuantumCanaryRegistry.NonCanonicalTargets.selector);
        new QuantumCanaryRegistry(ladder, token, CanaryTargets.drill(), false);

        CanaryTargets.Targets memory t = CanaryTargets.nums();
        t.k1 = address(1);
        vm.expectRevert(QuantumCanaryRegistry.NonCanonicalTargets.selector);
        new QuantumCanaryRegistry(ladder, token, t, false);

        t = CanaryTargets.nums();
        t.r1y = bytes32(uint256(t.r1y) ^ 1);
        vm.expectRevert(QuantumCanaryRegistry.NonCanonicalTargets.selector);
        new QuantumCanaryRegistry(ladder, token, t, false);

        // Drill registries may carry any keys; a live one carries exactly the NUMS set.
        assertTrue(new QuantumCanaryRegistry(ladder, token, t, true).isDrill());
        assertFalse(new QuantumCanaryRegistry(ladder, token, CanaryTargets.nums(), false).isDrill());
    }

    // ------------------------------------------------------------------ fee-on-transfer funding

    function test_fund_creditsMeasuredDelta() public {
        ControlledToken ct = new ControlledToken();
        QuantumCanaryRegistry r = new QuantumCanaryRegistry(ladder, ct, CanaryTargets.drill(), true);
        ct.setFeeBps(100); // 1% burned per transfer
        ct.mint(funder, 1_000e6);

        vm.startPrank(funder);
        ct.approve(address(r), 1_000e6);
        vm.expectEmit(address(r));
        emit IQuantumCanaryRegistry.Funded(2, funder, 990e6, 0);
        r.fund(2, 1_000e6);
        vm.stopPrank();

        (uint256 tok,) = r.bounty(2);
        assertEq(tok, 990e6);
        assertEq(ct.balanceOf(address(r)), 990e6);

        bytes memory proof = _proof(r, 2, alice);
        vm.prank(alice);
        r.claim(2, proof);
        assertEq(ct.balanceOf(alice), 980.1e6);
        assertEq(ct.balanceOf(address(r)), 0);
        _assertOwed(r, alice, 0, 0);
    }

    // ------------------------------------------------------------------ drill factory

    function test_factory_createsDrillRegistry() public {
        DrillRegistryFactory factory = new DrillRegistryFactory(ladder, token);
        assertEq(address(factory.ladder()), address(ladder));
        assertEq(address(factory.bountyToken()), address(token));

        address predicted = vm.computeCreateAddress(address(factory), vm.getNonce(address(factory)));
        vm.expectEmit(address(factory));
        emit DrillRegistryFactory.DrillCreated(predicted, alice);
        vm.prank(alice);
        QuantumCanaryRegistry drill = factory.create();
        assertEq(address(drill), predicted);

        assertTrue(drill.isDrill());
        assertEq(keccak256(abi.encode(drill.targets())), keccak256(abi.encode(CanaryTargets.drill())));
        assertEq(address(drill.ladder()), address(ladder));
        assertEq(address(drill.bountyToken()), address(token));
        assertEq(drill.ladderLevel(), 0);

        vm.prank(bob);
        QuantumCanaryRegistry second = factory.create();
        assertTrue(address(second) != address(drill));

        // Drills rehearse real claims with the published keys.
        for (uint8 t; t < 5; ++t) {
            bytes memory proof = _proof(drill, t, alice);
            vm.prank(alice);
            drill.claim(t, proof);
        }
        assertEq(drill.ladderLevel(), 3);
        assertTrue(drill.familyBroken(0) && drill.familyBroken(1));
        assertEq(second.ladderLevel(), 0);
    }
}
