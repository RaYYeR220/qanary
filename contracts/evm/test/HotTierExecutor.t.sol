// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {
    IERC7579Module,
    MODULE_TYPE_EXECUTOR,
    MODULE_TYPE_VALIDATOR,
    MODULE_TYPE_FALLBACK
} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Safe} from "@safe/Safe.sol";
import {Enum} from "@safe/common/Enum.sol";
import {ModuleManager} from "@safe/base/ModuleManager.sol";
import {SafeProxyFactory} from "@safe/proxies/SafeProxyFactory.sol";
import {HotTierExecutor} from "../src/HotTierExecutor.sol";
import {QuantumValidator} from "../src/QuantumValidator.sol";
import {KeyStore} from "../src/KeyStore.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {MockCanaryRegistry} from "./mocks/MockCanaryRegistry.sol";
import {TestAccount7579} from "./mocks/TestAccount7579.sol";
import {RevertingToken} from "./mocks/RevertingToken.sol";
import {TestToken} from "./mocks/TestToken.sol";

/// @dev Allowlisted target that tries to re-enter the executor mid-operation.
contract Reenterer {
    function reenter(HotTierExecutor ex, address account) external {
        ex.execute(account, new HotTierExecutor.Call[](0));
    }
}

/// @dev Neutral allowlist target.
contract Pinger {
    uint256 public last;
    address public caller;

    function ping(uint256 x) external payable {
        last = x;
        caller = msg.sender;
    }
}

/// @dev Minimal module of any type; `ping` stands for a function that acts on `msg.sender`.
contract MockModule is IERC7579Module {
    uint256 public immutable moduleType;

    constructor(uint256 t) {
        moduleType = t;
    }

    function onInstall(bytes calldata) external {}
    function onUninstall(bytes calldata) external {}

    function isModuleType(uint256 t) external view returns (bool) {
        return t == moduleType;
    }

    function ping() external {}
}

/// @dev ERC-7579 "account" whose module query reverts.
contract BrokenModuleQueryAccount {
    function isModuleInstalled(uint256, address, bytes calldata) external pure returns (bool) {
        revert("no module query");
    }

    function configure(HotTierExecutor ex, HotTierExecutor.Setup calldata s) external {
        ex.configure(s);
    }
}

contract HotTierExecutorTest is Test {
    uint32 internal constant WINDOW = 1 days;
    uint128 internal constant CAP = 1_000e6;
    uint128 internal constant ETH_CAP = 1 ether;
    address internal constant ETH = address(0);

    HotTierExecutor internal ex;
    MockCanaryRegistry internal reg;
    TestAccount7579 internal acct;
    TestToken internal usdc;
    TestToken internal dai; // never tracked
    address internal hot;
    uint256 internal hotPk;
    address internal bob;

    function setUp() public {
        vm.warp(1_700_000_000);
        ex = new HotTierExecutor();
        reg = new MockCanaryRegistry();
        acct = new TestAccount7579();
        usdc = new TestToken("USD Coin", "USDC", 6);
        dai = new TestToken("Dai", "DAI", 18);
        (hot, hotPk) = makeAddrAndKey("hot");
        bob = makeAddr("bob");
        usdc.mint(address(acct), 10_000e6);
        dai.mint(address(acct), 10_000e18);
        vm.deal(address(acct), 10 ether);
        acct.installModuleForTest(MODULE_TYPE_EXECUTOR, address(ex), abi.encode(_setup()));
    }

    // ------------------------------------------------------------------ helpers

    function _setup() internal view returns (HotTierExecutor.Setup memory s) {
        s.kind = HotTierExecutor.AccountKind.ERC7579;
        s.registry = address(reg);
        s.window = WINDOW;
        s.levelBps = [uint16(10_000), 5_000, 2_500, 0];
        s.signer = HotTierExecutor.HotSigner(HotTierExecutor.Family.SECP256K1, hot, bytes32(0), bytes32(0));
        s.assets = new address[](2);
        s.assets[0] = address(usdc);
        s.assets[1] = ETH;
        s.caps = new uint128[](2);
        s.caps[0] = CAP;
        s.caps[1] = ETH_CAP;
        s.allow = new HotTierExecutor.AllowEntry[](0);
    }

    function _call(address target, uint256 value, bytes memory data)
        internal
        pure
        returns (HotTierExecutor.Call[] memory c)
    {
        c = new HotTierExecutor.Call[](1);
        c[0] = HotTierExecutor.Call(target, value, data);
    }

    function _xfer(address token, address to, uint256 amount) internal pure returns (HotTierExecutor.Call[] memory) {
        return _call(token, 0, abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    function _hot(HotTierExecutor.Call[] memory calls) internal {
        vm.prank(hot);
        ex.execute(address(acct), calls);
    }

    function _expectHotRevert(HotTierExecutor.Call[] memory calls, bytes memory err) internal {
        vm.prank(hot);
        vm.expectRevert(err);
        ex.execute(address(acct), calls);
    }

    function _capExceeded(address asset, uint256 outflow, uint256 avail) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(HotTierExecutor.CapExceeded.selector, asset, outflow, avail);
    }

    function _expectInvalid(HotTierExecutor.Setup memory s) internal {
        vm.prank(makeAddr("fresh"));
        vm.expectRevert(HotTierExecutor.InvalidSetup.selector);
        ex.configure(s);
    }

    function _newAccount(HotTierExecutor.Setup memory s) internal returns (TestAccount7579 a) {
        a = new TestAccount7579();
        a.installModuleForTest(MODULE_TYPE_EXECUTOR, address(ex), abi.encode(s));
    }

    function _sign(uint256 pk, address account, HotTierExecutor.Call[] memory calls, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 d = ex.hotOpDigest(account, calls, ex.nonceOf(account), deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }

    /// @dev WebAuthn assertion over `digest` (UP|UV set), encoded as `abi.encode(WebAuthnAuth)`.
    function _webauthnSig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        bytes memory authData = abi.encodePacked(sha256("localhost"), bytes1(0x05), bytes4(0));
        string memory clientDataJSON = string.concat(
            '{"type":"webauthn.get","challenge":"',
            Base64.encodeURL(abi.encodePacked(digest)),
            '","origin":"http://localhost:3000","crossOrigin":false}'
        );
        (bytes32 r, bytes32 s) = vm.signP256(pk, sha256(abi.encodePacked(authData, sha256(bytes(clientDataJSON)))));
        s = bytes32(Math.min(uint256(s), P256.N - uint256(s)));
        return abi.encode(
            WebAuthn.WebAuthnAuth({
                r: r,
                s: s,
                challengeIndex: 23,
                typeIndex: 1,
                authenticatorData: authData,
                clientDataJSON: clientDataJSON
            })
        );
    }

    function _setPasskey(uint256 pk) internal {
        (uint256 x, uint256 y) = vm.publicKeyP256(pk);
        vm.prank(address(acct));
        ex.setHotSigner(HotTierExecutor.HotSigner(HotTierExecutor.Family.P256, address(0), bytes32(x), bytes32(y)));
    }

    // ------------------------------------------------------------------ configure

    function test_configure_rejectsZeroWindow() public {
        HotTierExecutor.Setup memory s = _setup();
        s.window = 0;
        _expectInvalid(s);
    }

    function test_configure_rejectsLengthMismatch() public {
        HotTierExecutor.Setup memory s = _setup();
        s.caps = new uint128[](1);
        _expectInvalid(s);
    }

    function test_configure_assetLimit() public {
        HotTierExecutor.Setup memory s = _setup();
        s.assets = new address[](9);
        s.caps = new uint128[](9);
        for (uint256 i = 0; i < 9; i++) {
            s.assets[i] = address(uint160(0x1000 + i));
        }
        _expectInvalid(s);
        // exactly MAX_ASSETS is accepted
        s.assets = new address[](8);
        s.caps = new uint128[](8);
        for (uint256 i = 0; i < 8; i++) {
            s.assets[i] = address(uint160(0x1000 + i));
        }
        vm.prank(makeAddr("fresh"));
        ex.configure(s);
        assertEq(ex.trackedAssets(makeAddr("fresh")).length, ex.MAX_ASSETS());
    }

    function test_configure_rejectsDuplicateAsset() public {
        HotTierExecutor.Setup memory s = _setup();
        s.assets[1] = address(usdc);
        _expectInvalid(s);
    }

    function test_configure_rejectsBpsAbove10000() public {
        HotTierExecutor.Setup memory s = _setup();
        s.levelBps = [uint16(10_001), 5_000, 2_500, 0];
        _expectInvalid(s);
    }

    function test_configure_rejectsIncreasingBps() public {
        HotTierExecutor.Setup memory s = _setup();
        s.levelBps = [uint16(10_000), 5_000, 6_000, 0];
        _expectInvalid(s);
        s.levelBps = [uint16(5_000), 10_000, 0, 0];
        _expectInvalid(s);
    }

    function test_configure_rejectsZeroRegistry() public {
        HotTierExecutor.Setup memory s = _setup();
        s.registry = address(0);
        _expectInvalid(s);
    }

    function test_configure_rejectsCodelessRegistry() public {
        HotTierExecutor.Setup memory s = _setup();
        s.registry = makeAddr("eoa-registry");
        _expectInvalid(s);
    }

    function test_configure_rejectsPrecompileRangeRegistry() public {
        HotTierExecutor.Setup memory s = _setup();
        vm.etch(address(0x100), address(reg).code);
        vm.etch(address(0xffff), address(reg).code);
        s.registry = address(0x100);
        _expectInvalid(s);
        s.registry = address(0xffff);
        _expectInvalid(s);
        s.registry = address(0x04); // identity precompile
        _expectInvalid(s);
    }

    function test_configure_rejectsZeroEoa() public {
        HotTierExecutor.Setup memory s = _setup();
        s.signer.eoa = address(0);
        _expectInvalid(s);
    }

    function test_configure_rejectsZeroPubX() public {
        HotTierExecutor.Setup memory s = _setup();
        s.signer = HotTierExecutor.HotSigner(HotTierExecutor.Family.P256, hot, bytes32(0), bytes32(uint256(1)));
        _expectInvalid(s);
        s.signer = HotTierExecutor.HotSigner(HotTierExecutor.Family.P256, hot, bytes32(uint256(1)), 0);
        _expectInvalid(s);
        // P256 does not need an EOA
        s.signer = HotTierExecutor.HotSigner(
            HotTierExecutor.Family.P256, address(0), bytes32(uint256(1)), bytes32(uint256(2))
        );
        vm.expectEmit(address(ex));
        emit HotTierExecutor.HotSignerSet(
            makeAddr("fresh"), HotTierExecutor.Family.P256, address(0), bytes32(uint256(1)), bytes32(uint256(2))
        );
        vm.prank(makeAddr("fresh"));
        ex.configure(s);
    }

    function test_configure_rejectsApprovalClassAllowEntry() public {
        bytes4[5] memory sels = [bytes4(0x095ea7b3), 0x39509351, 0xa22cb465, 0x87517c45, 0xd505accf];
        HotTierExecutor.Setup memory s = _setup();
        s.allow = new HotTierExecutor.AllowEntry[](1);
        for (uint256 i = 0; i < sels.length; i++) {
            s.allow[0] = HotTierExecutor.AllowEntry(address(usdc), sels[i]);
            _expectInvalid(s);
        }
    }

    function test_configure_emitsEventsAndStoresState() public {
        Pinger p = new Pinger();
        HotTierExecutor.Setup memory s = _setup();
        s.allow = new HotTierExecutor.AllowEntry[](1);
        s.allow[0] = HotTierExecutor.AllowEntry(address(p), Pinger.ping.selector);
        address a = makeAddr("fresh");

        vm.expectEmit(address(ex));
        emit HotTierExecutor.CapSet(a, address(usdc), CAP);
        vm.expectEmit(address(ex));
        emit HotTierExecutor.CapSet(a, ETH, ETH_CAP);
        vm.expectEmit(address(ex));
        emit HotTierExecutor.AllowSet(a, address(p), Pinger.ping.selector, true);
        vm.expectEmit(address(ex));
        emit HotTierExecutor.HotSignerSet(a, HotTierExecutor.Family.SECP256K1, hot, 0, 0);
        vm.expectEmit(address(ex));
        emit HotTierExecutor.Configured(a, HotTierExecutor.AccountKind.ERC7579, address(reg));
        vm.prank(a);
        ex.configure(s);

        assertTrue(ex.isInitialized(a));
        address[] memory t = ex.trackedAssets(a);
        assertEq(t.length, 2);
        assertEq(t[0], address(usdc));
        assertEq(t[1], ETH);
        assertTrue(ex.isAllowed(a, address(p), Pinger.ping.selector));
        assertTrue(ex.isAllowed(a, address(usdc), IERC20.transfer.selector)); // implicit: tracked token
        assertFalse(ex.isAllowed(a, address(dai), IERC20.transfer.selector));
        assertFalse(ex.isAllowed(a, address(usdc), IERC20.transferFrom.selector));
        assertEq(ex.available(a, address(usdc)), CAP);
        assertEq(ex.available(a, ETH), ETH_CAP);
        assertEq(ex.available(a, address(dai)), 0);
        assertEq(ex.effectiveBps(a), 10_000);
        assertEq(ex.nonceOf(a), 1); // configuring kills pending signatures
    }

    function test_install_moduleTypeAndInitialized() public view {
        assertTrue(ex.isModuleType(MODULE_TYPE_EXECUTOR));
        assertFalse(ex.isModuleType(MODULE_TYPE_VALIDATOR));
        assertTrue(acct.isModuleInstalled(MODULE_TYPE_EXECUTOR, address(ex), ""));
        assertTrue(ex.isInitialized(address(acct)));
        assertFalse(ex.isInitialized(bob));
    }

    function test_notConfigured() public {
        bytes memory err = abi.encodeWithSelector(HotTierExecutor.NotConfigured.selector, bob);
        vm.startPrank(bob);
        vm.expectRevert(err);
        ex.setAllowed(address(usdc), IERC20.approve.selector, true);
        vm.expectRevert(err);
        ex.setCap(address(usdc), 1);
        vm.expectRevert(err);
        ex.setHotSigner(HotTierExecutor.HotSigner(HotTierExecutor.Family.SECP256K1, hot, 0, 0));
        vm.expectRevert(err);
        ex.execute(bob, _xfer(address(usdc), hot, 1));
        vm.expectRevert(err);
        ex.executeWithSig(bob, _xfer(address(usdc), hot, 1), block.timestamp, "");
        vm.stopPrank();
        vm.expectRevert(err);
        ex.available(bob, address(usdc));
        vm.expectRevert(err);
        ex.effectiveBps(bob);
    }

    function test_setCap_trackedOnlyAndClamps() public {
        vm.prank(address(acct));
        vm.expectRevert(HotTierExecutor.InvalidSetup.selector);
        ex.setCap(address(dai), 1);

        vm.expectEmit(address(ex));
        emit HotTierExecutor.CapSet(address(acct), address(usdc), 100e6);
        vm.prank(address(acct));
        ex.setCap(address(usdc), 100e6);
        assertEq(ex.available(address(acct), address(usdc)), 100e6);
        _expectHotRevert(_xfer(address(usdc), bob, 100e6 + 1), _capExceeded(address(usdc), 100e6 + 1, 100e6));
        _hot(_xfer(address(usdc), bob, 100e6));
        assertEq(usdc.balanceOf(bob), 100e6);
    }

    function test_setCap_checkpointsBucketFirst() public {
        _hot(_xfer(address(usdc), bob, 600e6)); // level 400
        vm.warp(block.timestamp + WINDOW / 2); // refill +500 at the old cap -> 900
        vm.prank(address(acct));
        ex.setCap(address(usdc), 2 * CAP);
        // without the checkpoint the old timestamp would refill at the new rate: 400 + 1000 = 1400
        assertEq(ex.available(address(acct), address(usdc)), 900e6);
        vm.warp(block.timestamp + WINDOW / 4); // +500 at the new cap
        assertEq(ex.available(address(acct), address(usdc)), 1_400e6);
    }

    function test_setAllowed_togglesAndEmits() public {
        Pinger p = new Pinger();
        vm.expectEmit(address(ex));
        emit HotTierExecutor.AllowSet(address(acct), address(p), Pinger.ping.selector, true);
        vm.prank(address(acct));
        ex.setAllowed(address(p), Pinger.ping.selector, true);
        assertTrue(ex.isAllowed(address(acct), address(p), Pinger.ping.selector));
        vm.prank(address(acct));
        ex.setAllowed(address(p), Pinger.ping.selector, false);
        assertFalse(ex.isAllowed(address(acct), address(p), Pinger.ping.selector));
    }

    function test_setAllowed_rejectsApprovalClass() public {
        bytes4[5] memory sels = [bytes4(0x095ea7b3), 0x39509351, 0xa22cb465, 0x87517c45, 0xd505accf];
        for (uint256 i = 0; i < sels.length; i++) {
            vm.prank(address(acct));
            vm.expectRevert(HotTierExecutor.InvalidSetup.selector);
            ex.setAllowed(address(usdc), sels[i], true);
            assertFalse(ex.isAllowed(address(acct), address(usdc), sels[i]));
        }
    }

    function test_isAllowed_mirrorsRunStaticChecks() public {
        vm.startPrank(address(acct));
        ex.setAllowed(address(acct), Pinger.ping.selector, true);
        ex.setAllowed(address(ex), Pinger.ping.selector, true);
        ex.setAllowed(address(0), Pinger.ping.selector, true);
        vm.stopPrank();
        assertFalse(ex.isAllowed(address(acct), address(acct), Pinger.ping.selector));
        assertFalse(ex.isAllowed(address(acct), address(ex), Pinger.ping.selector));
        assertFalse(ex.isAllowed(address(acct), address(0), Pinger.ping.selector));
        assertFalse(ex.isAllowed(address(acct), address(0), IERC20.transfer.selector)); // ETH is tracked
        assertFalse(ex.isAllowed(address(acct), address(usdc), IERC20.approve.selector));
        assertTrue(ex.isAllowed(address(acct), address(usdc), IERC20.transfer.selector));
    }

    function test_setHotSigner_validatesAndRotates() public {
        vm.prank(address(acct));
        vm.expectRevert(HotTierExecutor.InvalidSetup.selector);
        ex.setHotSigner(HotTierExecutor.HotSigner(HotTierExecutor.Family.SECP256K1, address(0), 0, 0));
        vm.prank(address(acct));
        vm.expectRevert(HotTierExecutor.InvalidSetup.selector);
        ex.setHotSigner(HotTierExecutor.HotSigner(HotTierExecutor.Family.P256, address(0), bytes32(uint256(1)), 0));

        address hot2 = makeAddr("hot2");
        vm.expectEmit(address(ex));
        emit HotTierExecutor.HotSignerSet(address(acct), HotTierExecutor.Family.SECP256K1, hot2, 0, 0);
        vm.prank(address(acct));
        ex.setHotSigner(HotTierExecutor.HotSigner(HotTierExecutor.Family.SECP256K1, hot2, 0, 0));

        _expectHotRevert(_xfer(address(usdc), bob, 1), abi.encodeWithSelector(HotTierExecutor.Unauthorized.selector));
        vm.prank(hot2);
        ex.execute(address(acct), _xfer(address(usdc), bob, 1));
        assertEq(usdc.balanceOf(bob), 1);
    }

    // ------------------------------------------------------------------ hot transfers and caps

    function test_hotTransfer_withinCap() public {
        HotTierExecutor.Call[] memory calls = _xfer(address(usdc), bob, 400e6);
        uint256[] memory outflows = new uint256[](2);
        outflows[0] = 400e6;
        vm.expectEmit(address(ex));
        emit HotTierExecutor.HotOpExecuted(address(acct), keccak256(abi.encode(calls)), outflows);
        vm.prank(hot);
        uint256 g = gasleft();
        ex.execute(address(acct), calls);
        emit log_named_uint("gas: hot ERC-20 transfer, ERC-7579 path", g - gasleft());
        assertEq(usdc.balanceOf(bob), 400e6);
        assertEq(usdc.balanceOf(address(acct)), 10_000e6 - 400e6);
        assertEq(ex.available(address(acct), address(usdc)), CAP - 400e6);
        assertEq(ex.available(address(acct), ETH), ETH_CAP);
    }

    function test_hotTransfer_exceedingCap_revertsWithoutStateChange() public {
        _expectHotRevert(_xfer(address(usdc), bob, CAP + 1), _capExceeded(address(usdc), CAP + 1, CAP));
        _hot(_xfer(address(usdc), bob, 300e6));
        _expectHotRevert(_xfer(address(usdc), bob, 701e6), _capExceeded(address(usdc), 701e6, 700e6));
        assertEq(usdc.balanceOf(bob), 300e6);
        assertEq(usdc.balanceOf(address(acct)), 10_000e6 - 300e6);
        assertEq(ex.available(address(acct), address(usdc)), 700e6);
    }

    function test_batch_outflowIsSummed() public {
        HotTierExecutor.Call[] memory calls = new HotTierExecutor.Call[](2);
        calls[0] = _xfer(address(usdc), bob, 600e6)[0];
        calls[1] = _xfer(address(usdc), hot, 600e6)[0];
        _expectHotRevert(calls, _capExceeded(address(usdc), 1_200e6, CAP));

        calls[1] = HotTierExecutor.Call(bob, 0.25 ether, "");
        _hot(calls);
        assertEq(ex.available(address(acct), address(usdc)), CAP - 600e6);
        assertEq(ex.available(address(acct), ETH), ETH_CAP - 0.25 ether);
    }

    function test_leakyBucket_refillsLinearly() public {
        _hot(_xfer(address(usdc), bob, CAP));
        assertEq(ex.available(address(acct), address(usdc)), 0);
        vm.warp(block.timestamp + WINDOW / 2);
        assertApproxEqAbs(ex.available(address(acct), address(usdc)), CAP / 2, 1);
        _hot(_xfer(address(usdc), bob, CAP / 2 - 1));
        assertLe(ex.available(address(acct), address(usdc)), 1);
        _expectHotRevert(
            _xfer(address(usdc), bob, 2), _capExceeded(address(usdc), 2, ex.available(address(acct), address(usdc)))
        );
    }

    function test_leakyBucket_neverExceedsCap() public {
        _hot(_xfer(address(usdc), bob, 10e6));
        vm.warp(block.timestamp + 100 * uint256(WINDOW));
        assertEq(ex.available(address(acct), address(usdc)), CAP);
        _expectHotRevert(_xfer(address(usdc), bob, CAP + 1), _capExceeded(address(usdc), CAP + 1, CAP));
    }

    function testFuzz_leakyBucket_refill(uint256 spent, uint256 elapsed) public {
        spent = bound(spent, 1, CAP);
        elapsed = bound(elapsed, 0, 3 * uint256(WINDOW));
        _hot(_xfer(address(usdc), bob, spent));
        vm.warp(block.timestamp + elapsed);
        uint256 expected = Math.min(CAP, CAP - spent + elapsed * CAP / WINDOW);
        assertEq(ex.available(address(acct), address(usdc)), expected);
    }

    function test_ethOutflow_tracked() public {
        _hot(_call(bob, 0.4 ether, ""));
        assertEq(bob.balance, 0.4 ether);
        assertEq(ex.available(address(acct), ETH), ETH_CAP - 0.4 ether);
        _expectHotRevert(_call(bob, 0.7 ether, ""), _capExceeded(ETH, 0.7 ether, 0.6 ether));
        assertEq(bob.balance, 0.4 ether);
    }

    function test_valueWithoutTrackedEth_reverts() public {
        HotTierExecutor.Setup memory s = _setup();
        s.assets = new address[](1);
        s.assets[0] = address(usdc);
        s.caps = new uint128[](1);
        s.caps[0] = CAP;
        TestAccount7579 a2 = _newAccount(s);
        vm.deal(address(a2), 1 ether);
        bytes memory err = abi.encodeWithSelector(HotTierExecutor.ValueNotTracked.selector);
        vm.prank(hot);
        vm.expectRevert(err);
        ex.execute(address(a2), _call(bob, 1, ""));
        vm.prank(hot);
        vm.expectRevert(err);
        ex.execute(address(a2), _call(address(usdc), 1, abi.encodeCall(IERC20.transfer, (bob, 1))));
        assertEq(address(a2).balance, 1 ether);
    }

    // ------------------------------------------------------------------ allowlist and targets

    function test_approvalClass_neverCallable() public {
        _expectHotRevert(
            _call(address(usdc), 0, abi.encodeCall(IERC20.approve, (bob, 1))),
            abi.encodeWithSelector(HotTierExecutor.CallNotAllowed.selector, address(usdc), IERC20.approve.selector)
        );
        _expectHotRevert(
            _call(address(usdc), 0, abi.encodeWithSelector(0x39509351, bob, 1)),
            abi.encodeWithSelector(HotTierExecutor.CallNotAllowed.selector, address(usdc), bytes4(0x39509351))
        );
        assertEq(usdc.allowance(address(acct), bob), 0);
    }

    function test_allowlistedSelector_passes() public {
        Pinger p = new Pinger();
        vm.prank(address(acct));
        ex.setAllowed(address(p), Pinger.ping.selector, true);
        _hot(_call(address(p), 0.1 ether, abi.encodeCall(Pinger.ping, (42))));
        assertEq(p.last(), 42);
        assertEq(p.caller(), address(acct));
        assertEq(ex.available(address(acct), ETH), ETH_CAP - 0.1 ether);
        assertEq(ex.available(address(acct), address(usdc)), CAP);
        // another selector on the same target is not allowed
        _expectHotRevert(
            _call(address(p), 0, abi.encodeCall(p.last, ())),
            abi.encodeWithSelector(HotTierExecutor.CallNotAllowed.selector, address(p), p.last.selector)
        );
    }

    function test_untrackedTokenTransfer_notAllowed() public {
        _expectHotRevert(
            _xfer(address(dai), bob, 1),
            abi.encodeWithSelector(HotTierExecutor.CallNotAllowed.selector, address(dai), IERC20.transfer.selector)
        );
    }

    function test_forbiddenTargets() public {
        bytes memory data = abi.encodeCall(IERC20.transfer, (bob, 1));
        address[3] memory targets = [address(acct), address(ex), address(0)];
        for (uint256 i = 0; i < 3; i++) {
            _expectHotRevert(
                _call(targets[i], 0, data), abi.encodeWithSelector(HotTierExecutor.ForbiddenTarget.selector, targets[i])
            );
        }
        // forbidden even when allowlisted
        vm.prank(address(acct));
        ex.setAllowed(address(acct), bytes4(0x9517e29f), true); // installModule
        _expectHotRevert(
            _call(address(acct), 0, hex"9517e29f"),
            abi.encodeWithSelector(HotTierExecutor.ForbiddenTarget.selector, address(acct))
        );
    }

    function test_shortCalldata_notAllowed() public {
        _expectHotRevert(
            _call(address(usdc), 0, hex"a9cb"),
            abi.encodeWithSelector(HotTierExecutor.CallNotAllowed.selector, address(usdc), bytes4(0))
        );
    }

    function test_emptyCalldata_onlyWithValue() public {
        _expectHotRevert(
            _call(bob, 0, ""), abi.encodeWithSelector(HotTierExecutor.CallNotAllowed.selector, bob, bytes4(0))
        );
        _hot(_call(bob, 1, ""));
        assertEq(bob.balance, 1);
        assertEq(ex.available(address(acct), address(usdc)), CAP);
    }

    function test_execute_unauthorizedCaller() public {
        vm.prank(bob);
        vm.expectRevert(HotTierExecutor.Unauthorized.selector);
        ex.execute(address(acct), _xfer(address(usdc), bob, 1));
    }

    function test_execute_rejectsPasskeyFamily() public {
        _setPasskey(uint256(keccak256("passkey")) % P256.N);
        _expectHotRevert(_xfer(address(usdc), bob, 1), abi.encodeWithSelector(HotTierExecutor.Unauthorized.selector));
    }

    function test_reentrancy_blocked() public {
        Reenterer r = new Reenterer();
        vm.prank(address(acct));
        ex.setAllowed(address(r), Reenterer.reenter.selector, true);
        _expectHotRevert(
            _call(address(r), 0, abi.encodeCall(Reenterer.reenter, (ex, address(acct)))),
            abi.encodeWithSelector(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector)
        );
    }

    // ------------------------------------------------------------------ account modules are never targets

    function test_moduleTarget_validatorRotateKeyForbidden() public {
        MockVerifier mv = new MockVerifier();
        KeyStore ks = new KeyStore();
        QuantumValidator v = new QuantumValidator();
        address keyPtr = ks.store(abi.encodePacked(uint8(1), bytes32("pk")));
        acct.installModuleForTest(
            MODULE_TYPE_VALIDATOR,
            address(v),
            abi.encode(
                QuantumValidator.InstallData({
                    verifier: address(mv), keyPtr: keyPtr, guardians: new bytes[](0), threshold: 0, delay: 0
                })
            )
        );
        address newPtr = ks.store(abi.encodePacked(uint8(1), bytes32("attacker")));
        vm.startPrank(address(acct));
        ex.setAllowed(address(v), QuantumValidator.rotateKey.selector, true);
        ex.setAllowed(address(v), IERC7579Module.onUninstall.selector, true);
        vm.stopPrank();
        bytes memory err = abi.encodeWithSelector(HotTierExecutor.ForbiddenTarget.selector, address(v));
        bytes memory proof = abi.encode(abi.encodePacked(newPtr), v.rotationDigest(address(acct), address(mv), newPtr));
        _expectHotRevert(
            _call(address(v), 0, abi.encodeCall(QuantumValidator.rotateKey, (address(mv), newPtr, proof))), err
        );
        _expectHotRevert(_call(address(v), 0, abi.encodeCall(IERC7579Module.onUninstall, (""))), err);
        _expectHotRevert(_call(address(v), 1, ""), err);
        assertEq(v.configOf(address(acct)).keyPtr, keyPtr);
    }

    function test_moduleTarget_executorAndFallbackForbidden() public {
        MockModule exe = new MockModule(MODULE_TYPE_EXECUTOR);
        MockModule fb = new MockModule(MODULE_TYPE_FALLBACK);
        MockModule plain = new MockModule(MODULE_TYPE_EXECUTOR); // not installed
        acct.installModuleForTest(MODULE_TYPE_EXECUTOR, address(exe), "");
        acct.installModuleForTest(MODULE_TYPE_FALLBACK, address(fb), abi.encodePacked(MockModule.ping.selector));
        vm.startPrank(address(acct));
        ex.setAllowed(address(exe), MockModule.ping.selector, true);
        ex.setAllowed(address(fb), MockModule.ping.selector, true);
        ex.setAllowed(address(plain), MockModule.ping.selector, true);
        vm.stopPrank();
        bytes memory ping = abi.encodeCall(MockModule.ping, ());
        _expectHotRevert(
            _call(address(exe), 0, ping), abi.encodeWithSelector(HotTierExecutor.ForbiddenTarget.selector, address(exe))
        );
        _expectHotRevert(
            _call(address(fb), 0, ping), abi.encodeWithSelector(HotTierExecutor.ForbiddenTarget.selector, address(fb))
        );
        _hot(_call(address(plain), 0, ping));
    }

    function test_moduleQueryRevert_failsClosed() public {
        BrokenModuleQueryAccount b = new BrokenModuleQueryAccount();
        usdc.mint(address(b), 100e6);
        b.configure(ex, _setup());
        vm.prank(hot);
        vm.expectRevert(bytes("no module query"));
        ex.execute(address(b), _xfer(address(usdc), bob, 1));
        assertEq(usdc.balanceOf(bob), 0);
    }

    // ------------------------------------------------------------------ canary registry

    function test_ladder1_halvesCap_clampsFullBucket() public {
        reg.setLadderLevel(1);
        assertEq(ex.effectiveBps(address(acct)), 5_000);
        // the bucket was full at CAP; it is clamped to CAP/2 immediately
        assertEq(ex.available(address(acct), address(usdc)), CAP / 2);
        _expectHotRevert(_xfer(address(usdc), bob, CAP / 2 + 1), _capExceeded(address(usdc), CAP / 2 + 1, CAP / 2));
        _hot(_xfer(address(usdc), bob, CAP / 2));
        assertEq(ex.available(address(acct), address(usdc)), 0);
        vm.warp(block.timestamp + 10 * uint256(WINDOW));
        assertEq(ex.available(address(acct), address(usdc)), CAP / 2);
    }

    function test_ladder3_frozen() public {
        reg.setLadderLevel(3);
        assertEq(ex.effectiveBps(address(acct)), 0);
        assertEq(ex.available(address(acct), address(usdc)), 0);
        _expectHotRevert(
            _xfer(address(usdc), bob, 1), abi.encodeWithSelector(HotTierExecutor.HotTierFrozen.selector, 3)
        );
    }

    function test_ladderBeyondTable_frozen() public {
        reg.setLadderLevel(4);
        assertEq(ex.effectiveBps(address(acct)), 0);
        _expectHotRevert(
            _xfer(address(usdc), bob, 1), abi.encodeWithSelector(HotTierExecutor.HotTierFrozen.selector, 4)
        );
    }

    function test_familyBroken_killsHotTier() public {
        reg.setFamilyBroken(1, true); // P-256 broken: irrelevant for an ECDSA hot key
        _hot(_xfer(address(usdc), bob, 1));
        reg.setFamilyBroken(0, true);
        assertEq(ex.effectiveBps(address(acct)), 0);
        _expectHotRevert(
            _xfer(address(usdc), bob, 1), abi.encodeWithSelector(HotTierExecutor.ClassicalFamilyBroken.selector, 0)
        );
    }

    function test_registryReverting_failsClosed() public {
        reg.setReverting(true);
        _expectHotRevert(
            _xfer(address(usdc), bob, 1), abi.encodeWithSelector(MockCanaryRegistry.MockRegistryRevert.selector)
        );
        assertEq(usdc.balanceOf(bob), 0);
    }

    function test_revertingBalanceOf_failsClosed() public {
        RevertingToken rt = new RevertingToken();
        HotTierExecutor.Setup memory s = _setup();
        s.assets[1] = address(rt);
        TestAccount7579 a2 = _newAccount(s);
        usdc.mint(address(a2), 100e6);
        vm.prank(hot);
        vm.expectRevert(RevertingToken.BalanceOfDisabled.selector);
        ex.execute(address(a2), _xfer(address(usdc), bob, 1e6));
        assertEq(usdc.balanceOf(bob), 0);
    }

    // ------------------------------------------------------------------ executeWithSig

    function test_hotOpDigest_isEip712() public view {
        HotTierExecutor.Call[] memory calls = _xfer(address(usdc), bob, 1);
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("QanaryHotTier"),
                keccak256("1"),
                block.chainid,
                address(ex)
            )
        );
        assertEq(
            ex.HOT_OP_TYPEHASH(), keccak256("HotOp(address account,bytes32 callsHash,uint256 nonce,uint256 deadline)")
        );
        bytes32 structHash =
            keccak256(abi.encode(ex.HOT_OP_TYPEHASH(), address(acct), keccak256(abi.encode(calls)), 7, 123));
        assertEq(
            ex.hotOpDigest(address(acct), calls, 7, 123), keccak256(abi.encodePacked("\x19\x01", domain, structHash))
        );
    }

    function test_executeWithSig_ecdsa_andReplay() public {
        HotTierExecutor.Call[] memory calls = _xfer(address(usdc), bob, 100e6);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(hotPk, address(acct), calls, deadline);
        uint256 n0 = ex.nonceOf(address(acct));
        vm.prank(makeAddr("relayer"));
        ex.executeWithSig(address(acct), calls, deadline, sig);
        assertEq(usdc.balanceOf(bob), 100e6);
        assertEq(ex.nonceOf(address(acct)), n0 + 1);
        vm.expectRevert(HotTierExecutor.Unauthorized.selector);
        ex.executeWithSig(address(acct), calls, deadline, sig);
        assertEq(usdc.balanceOf(bob), 100e6);
    }

    function test_executeWithSig_wrongSigner() public {
        (, uint256 evilPk) = makeAddrAndKey("evil");
        HotTierExecutor.Call[] memory calls = _xfer(address(usdc), bob, 1);
        bytes memory sig = _sign(evilPk, address(acct), calls, block.timestamp);
        vm.expectRevert(HotTierExecutor.Unauthorized.selector);
        ex.executeWithSig(address(acct), calls, block.timestamp, sig);
    }

    function test_executeWithSig_tamperedCallsOrMalformed() public {
        bytes memory sig = _sign(hotPk, address(acct), _xfer(address(usdc), bob, 1), block.timestamp);
        vm.expectRevert(HotTierExecutor.Unauthorized.selector);
        ex.executeWithSig(address(acct), _xfer(address(usdc), bob, 2), block.timestamp, sig);
        vm.expectRevert(HotTierExecutor.Unauthorized.selector);
        ex.executeWithSig(address(acct), _xfer(address(usdc), bob, 1), block.timestamp, hex"1234");
    }

    function test_executeWithSig_expired() public {
        HotTierExecutor.Call[] memory calls = _xfer(address(usdc), bob, 1);
        uint256 deadline = block.timestamp;
        bytes memory sig = _sign(hotPk, address(acct), calls, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(HotTierExecutor.Expired.selector);
        ex.executeWithSig(address(acct), calls, deadline, sig);
        vm.warp(deadline);
        ex.executeWithSig(address(acct), calls, deadline, sig); // deadline is inclusive
        assertEq(usdc.balanceOf(bob), 1);
    }

    function test_executeWithSig_webauthn() public {
        uint256 pk = uint256(keccak256("passkey")) % P256.N;
        _setPasskey(pk);
        HotTierExecutor.Call[] memory calls = _xfer(address(usdc), bob, 50e6);
        uint256 deadline = block.timestamp + 5 minutes;
        uint256 n0 = ex.nonceOf(address(acct));
        bytes memory sig = _webauthnSig(pk, ex.hotOpDigest(address(acct), calls, n0, deadline));
        uint256 g = gasleft();
        ex.executeWithSig(address(acct), calls, deadline, sig);
        emit log_named_uint("gas: hot ERC-20 transfer, WebAuthn P-256 (Solidity fallback)", g - gasleft());
        assertEq(usdc.balanceOf(bob), 50e6);
        assertEq(ex.nonceOf(address(acct)), n0 + 1);
        // replay: the nonce moved, the challenge no longer matches
        vm.expectRevert(HotTierExecutor.Unauthorized.selector);
        ex.executeWithSig(address(acct), calls, deadline, sig);
    }

    function test_executeWithSig_webauthnWrongKeyOrBrokenFamily() public {
        uint256 pk = uint256(keccak256("passkey")) % P256.N;
        _setPasskey(pk);
        HotTierExecutor.Call[] memory calls = _xfer(address(usdc), bob, 1);
        bytes32 digest = ex.hotOpDigest(address(acct), calls, ex.nonceOf(address(acct)), block.timestamp);
        bytes memory bad = _webauthnSig(uint256(keccak256("other")) % P256.N, digest);
        vm.expectRevert(HotTierExecutor.Unauthorized.selector);
        ex.executeWithSig(address(acct), calls, block.timestamp, bad);

        reg.setFamilyBroken(1, true);
        bytes memory good = _webauthnSig(pk, digest);
        vm.expectRevert(abi.encodeWithSelector(HotTierExecutor.ClassicalFamilyBroken.selector, 1));
        ex.executeWithSig(address(acct), calls, block.timestamp, good);
    }

    function test_setHotSigner_killsPendingSignatures() public {
        HotTierExecutor.Call[] memory calls = _xfer(address(usdc), bob, 1);
        bytes memory sig = _sign(hotPk, address(acct), calls, block.timestamp);
        // re-setting the same key is the "revoke all pending signatures" action
        vm.prank(address(acct));
        ex.setHotSigner(HotTierExecutor.HotSigner(HotTierExecutor.Family.SECP256K1, hot, 0, 0));
        vm.expectRevert(HotTierExecutor.Unauthorized.selector);
        ex.executeWithSig(address(acct), calls, block.timestamp, sig);
    }

    // ------------------------------------------------------------------ Safe module path

    function _safeSig(Safe safe, uint256 pk, address to, bytes memory data) internal view returns (bytes memory) {
        uint256 nonce = safe.nonce();
        bytes32 h = safe.getTransactionHash(to, 0, data, Enum.Operation.Call, 0, 0, 0, address(0), address(0), nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, h);
        return abi.encodePacked(r, s, v);
    }

    function _safeExec(Safe safe, uint256 pk, address to, bytes memory data) internal {
        bytes memory sig = _safeSig(safe, pk, to, data);
        assertTrue(
            safe.execTransaction(to, 0, data, Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), sig)
        );
    }

    /// @dev 1-of-1 Safe 1.4.1 (EOA owner) with the executor enabled and configured via owner-signed txs.
    function _safeWithExecutor() internal returns (Safe safe, uint256 ownerPk) {
        address owner;
        (owner, ownerPk) = makeAddrAndKey("safe-owner");
        address[] memory owners = new address[](1);
        owners[0] = owner;
        safe = Safe(
            payable(address(
                    new SafeProxyFactory()
                        .createProxyWithNonce(
                            address(new Safe()),
                            abi.encodeCall(
                                Safe.setup, (owners, 1, address(0), "", address(0), address(0), 0, payable(address(0)))
                            ),
                            0
                        )
                ))
        );
        usdc.mint(address(safe), 5_000e6);
        vm.deal(address(safe), 2 ether);

        _safeExec(safe, ownerPk, address(safe), abi.encodeCall(ModuleManager.enableModule, (address(ex))));
        HotTierExecutor.Setup memory s = _setup();
        s.kind = HotTierExecutor.AccountKind.SAFE;
        _safeExec(safe, ownerPk, address(ex), abi.encodeCall(HotTierExecutor.configure, (s)));
    }

    function test_safe_hotTransferAndCap() public {
        (Safe safe,) = _safeWithExecutor();
        assertTrue(safe.isModuleEnabled(address(ex)));
        assertTrue(ex.isInitialized(address(safe)));

        vm.prank(hot);
        uint256 g = gasleft();
        ex.execute(address(safe), _xfer(address(usdc), bob, 400e6));
        emit log_named_uint("gas: hot ERC-20 transfer, Safe module path", g - gasleft());
        assertEq(usdc.balanceOf(bob), 400e6);
        assertEq(ex.available(address(safe), address(usdc)), CAP - 400e6);

        vm.prank(hot);
        vm.expectRevert(_capExceeded(address(usdc), 601e6, 600e6));
        ex.execute(address(safe), _xfer(address(usdc), bob, 601e6));

        vm.prank(hot);
        ex.execute(address(safe), _call(bob, 0.5 ether, ""));
        assertEq(ex.available(address(safe), ETH), ETH_CAP - 0.5 ether);

        vm.prank(hot);
        vm.expectRevert(abi.encodeWithSelector(HotTierExecutor.ForbiddenTarget.selector, address(safe)));
        ex.execute(address(safe), _call(address(safe), 0, abi.encodeCall(ModuleManager.enableModule, (bob))));

        // an inner call that fails makes Safe return false
        vm.prank(hot);
        vm.expectRevert(abi.encodeWithSelector(HotTierExecutor.ModuleCallFailed.selector, 0));
        ex.execute(address(safe), _xfer(address(usdc), address(0), 1));
        assertEq(usdc.balanceOf(bob), 400e6);
    }

    function test_safe_enabledModuleTargetForbidden() public {
        (Safe safe, uint256 ownerPk) = _safeWithExecutor();
        Pinger other = new Pinger(); // stands in for any other enabled Safe module
        _safeExec(safe, ownerPk, address(safe), abi.encodeCall(ModuleManager.enableModule, (address(other))));
        _safeExec(
            safe,
            ownerPk,
            address(ex),
            abi.encodeCall(HotTierExecutor.setAllowed, (address(other), Pinger.ping.selector, true))
        );
        vm.prank(hot);
        vm.expectRevert(abi.encodeWithSelector(HotTierExecutor.ForbiddenTarget.selector, address(other)));
        ex.execute(address(safe), _call(address(other), 0, abi.encodeCall(Pinger.ping, (1))));
        // once disabled it is an ordinary allowlisted target again
        _safeExec(
            safe,
            ownerPk,
            address(safe),
            abi.encodeCall(ModuleManager.disableModule, (address(0x1), address(other))) // `other` heads the list
        );
        vm.prank(hot);
        ex.execute(address(safe), _call(address(other), 0, abi.encodeCall(Pinger.ping, (1))));
        assertEq(other.last(), 1);
    }

    // ------------------------------------------------------------------ uninstall / reconfigure

    function test_uninstall_bumpsGenerationAndKillsPendingSignatures() public {
        Pinger p = new Pinger();
        vm.prank(address(acct));
        ex.setAllowed(address(p), Pinger.ping.selector, true);
        HotTierExecutor.Call[] memory calls = _xfer(address(usdc), bob, 1);
        ex.executeWithSig(address(acct), calls, block.timestamp, _sign(hotPk, address(acct), calls, block.timestamp));
        bytes memory pending = _sign(hotPk, address(acct), calls, block.timestamp); // signed, not submitted
        uint256 n0 = ex.nonceOf(address(acct));

        vm.prank(address(acct));
        acct.uninstallModule(MODULE_TYPE_EXECUTOR, address(ex), "");
        assertFalse(ex.isInitialized(address(acct)));
        assertEq(ex.trackedAssets(address(acct)).length, 0);
        assertFalse(ex.isAllowed(address(acct), address(p), Pinger.ping.selector));
        _expectHotRevert(calls, abi.encodeWithSelector(HotTierExecutor.NotConfigured.selector, address(acct)));

        acct.installModuleForTest(MODULE_TYPE_EXECUTOR, address(ex), abi.encode(_setup()));
        assertFalse(ex.isAllowed(address(acct), address(p), Pinger.ping.selector));
        _expectHotRevert(
            _call(address(p), 0, abi.encodeCall(Pinger.ping, (1))),
            abi.encodeWithSelector(HotTierExecutor.CallNotAllowed.selector, address(p), Pinger.ping.selector)
        );
        assertGt(ex.nonceOf(address(acct)), n0);
        vm.expectRevert(HotTierExecutor.Unauthorized.selector);
        ex.executeWithSig(address(acct), calls, block.timestamp, pending);
    }

    function test_reconfigure_replacesState() public {
        Pinger p = new Pinger();
        vm.prank(address(acct));
        ex.setAllowed(address(p), Pinger.ping.selector, true);
        HotTierExecutor.Setup memory s = _setup();
        s.assets = new address[](1);
        s.assets[0] = address(dai);
        s.caps = new uint128[](1);
        s.caps[0] = 5e18;
        vm.prank(address(acct));
        ex.configure(s);
        assertFalse(ex.isAllowed(address(acct), address(p), Pinger.ping.selector));
        assertEq(ex.available(address(acct), address(usdc)), 0);
        assertEq(ex.available(address(acct), address(dai)), 5e18);
        _expectHotRevert(
            _xfer(address(usdc), bob, 1),
            abi.encodeWithSelector(HotTierExecutor.CallNotAllowed.selector, address(usdc), IERC20.transfer.selector)
        );
        _hot(_xfer(address(dai), bob, 5e18));
        assertEq(dai.balanceOf(bob), 5e18);
    }
}
