// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MODULE_TYPE_EXECUTOR} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HotTierExecutor} from "../src/HotTierExecutor.sol";
import {MockCanaryRegistry} from "./mocks/MockCanaryRegistry.sol";
import {TestAccount7579} from "./mocks/TestAccount7579.sol";
import {TestToken} from "./mocks/TestToken.sol";

/// @dev Drives random hot operations, time warps and threat-level raises against one account and
///      records every realised outflow with its timestamp.
contract HotTierHandler is Test {
    struct Outflow {
        uint64 t;
        uint256 amount;
    }

    HotTierExecutor public immutable ex;
    MockCanaryRegistry public immutable reg;
    TestAccount7579 public immutable acct;
    TestToken public immutable usdc;
    TestToken public immutable dai;
    address public immutable hot;
    address public immutable sink;
    uint32 public immutable window;

    uint256 public time;
    uint8 public maxLevelSeen;
    bool public levelDecreased;
    bool public untrackedMoved;
    uint256 public successes;
    uint256 public rejections;

    Outflow[] internal _usdcOut;
    Outflow[] internal _ethOut;

    constructor(
        HotTierExecutor ex_,
        MockCanaryRegistry reg_,
        TestAccount7579 acct_,
        TestToken usdc_,
        TestToken dai_,
        address hot_,
        uint32 window_
    ) {
        ex = ex_;
        reg = reg_;
        acct = acct_;
        usdc = usdc_;
        dai = dai_;
        hot = hot_;
        window = window_;
        sink = makeAddr("sink");
        time = block.timestamp;
    }

    modifier step() {
        vm.warp(time);
        _;
        uint8 lvl = reg.ladderLevel();
        if (lvl < maxLevelSeen) levelDecreased = true;
        if (lvl > maxLevelSeen) maxLevelSeen = lvl;
    }

    function _one(address target, uint256 value, bytes memory data)
        internal
        pure
        returns (HotTierExecutor.Call[] memory c)
    {
        c = new HotTierExecutor.Call[](1);
        c[0] = HotTierExecutor.Call(target, value, data);
    }

    function _try(HotTierExecutor.Call[] memory calls) internal returns (bool ok) {
        vm.prank(hot);
        try ex.execute(address(acct), calls) {
            ok = true;
            successes++;
        } catch {
            rejections++;
        }
    }

    function transferUsdc(uint256 amount) external step {
        amount = bound(amount, 1, 1_200e6);
        uint256 pre = usdc.balanceOf(address(acct));
        if (_try(_one(address(usdc), 0, abi.encodeCall(IERC20.transfer, (sink, amount))))) {
            _usdcOut.push(Outflow(uint64(time), pre - usdc.balanceOf(address(acct))));
        }
    }

    function transferEth(uint256 amount) external step {
        amount = bound(amount, 1, 1.2 ether);
        uint256 pre = address(acct).balance;
        if (_try(_one(sink, amount, ""))) _ethOut.push(Outflow(uint64(time), pre - address(acct).balance));
    }

    function transferBoth(uint256 a, uint256 b) external step {
        a = bound(a, 1, 600e6);
        b = bound(b, 1, 0.6 ether);
        HotTierExecutor.Call[] memory calls = new HotTierExecutor.Call[](2);
        calls[0] = HotTierExecutor.Call(address(usdc), 0, abi.encodeCall(IERC20.transfer, (sink, a)));
        calls[1] = HotTierExecutor.Call(sink, b, "");
        uint256 preU = usdc.balanceOf(address(acct));
        uint256 preE = address(acct).balance;
        if (_try(calls)) {
            _usdcOut.push(Outflow(uint64(time), preU - usdc.balanceOf(address(acct))));
            _ethOut.push(Outflow(uint64(time), preE - address(acct).balance));
        }
    }

    function tryUntracked(uint256 amount, bool viaApprove) external step {
        amount = bound(amount, 1, 1e18);
        bytes memory data = viaApprove
            ? abi.encodeCall(IERC20.approve, (sink, amount))
            : abi.encodeCall(IERC20.transfer, (sink, amount));
        if (_try(_one(address(dai), 0, data))) untrackedMoved = true;
        // approving a tracked token is not allowlisted either
        if (_try(_one(address(usdc), 0, abi.encodeCall(IERC20.approve, (sink, amount))))) untrackedMoved = true;
    }

    function warp(uint256 dt) external step {
        time += bound(dt, 0, 2 * uint256(window));
        vm.warp(time);
    }

    function raiseLevel(uint256 seed) external step {
        if (seed % 6 != 0) return;
        uint8 lvl = reg.ladderLevel();
        if (lvl < 3) reg.setLadderLevel(lvl + 1);
    }

    /// @dev Largest sum of outflows over any closed interval `[t, t + window]` that starts at an outflow.
    function maxWindowSum(bool eth) external view returns (uint256 maxSum) {
        Outflow[] storage o = eth ? _ethOut : _usdcOut;
        uint256 n = o.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 sum;
            uint256 end = uint256(o[i].t) + window;
            for (uint256 j = i; j < n && o[j].t <= end; j++) {
                sum += o[j].amount;
            }
            if (sum > maxSum) maxSum = sum;
        }
    }

    function outflowCount() external view returns (uint256, uint256) {
        return (_usdcOut.length, _ethOut.length);
    }
}

contract HotTierExecutorInvariantTest is Test {
    uint32 internal constant WINDOW = 1 days;
    uint128 internal constant CAP = 1_000e6;
    uint128 internal constant ETH_CAP = 1 ether;
    uint16 internal constant MAX_BPS = 10_000;

    HotTierExecutor internal ex;
    MockCanaryRegistry internal reg;
    TestAccount7579 internal acct;
    TestToken internal usdc;
    TestToken internal dai;
    HotTierHandler internal handler;
    uint256 internal daiStart;

    function setUp() public {
        vm.warp(1_700_000_000);
        ex = new HotTierExecutor();
        reg = new MockCanaryRegistry();
        acct = new TestAccount7579();
        usdc = new TestToken("USD Coin", "USDC", 6);
        dai = new TestToken("Dai", "DAI", 18);
        address hot = makeAddr("hot");

        HotTierExecutor.Setup memory s;
        s.kind = HotTierExecutor.AccountKind.ERC7579;
        s.registry = address(reg);
        s.window = WINDOW;
        s.levelBps = [uint16(MAX_BPS), 5_000, 2_500, 0];
        s.signer = HotTierExecutor.HotSigner(HotTierExecutor.Family.SECP256K1, hot, 0, 0);
        s.assets = new address[](2);
        s.assets[0] = address(usdc);
        s.assets[1] = address(0);
        s.caps = new uint128[](2);
        s.caps[0] = CAP;
        s.caps[1] = ETH_CAP;
        s.allow = new HotTierExecutor.AllowEntry[](0);
        acct.installModuleForTest(MODULE_TYPE_EXECUTOR, address(ex), abi.encode(s));

        usdc.mint(address(acct), 1_000_000e6);
        dai.mint(address(acct), 1_000e18);
        daiStart = dai.balanceOf(address(acct));
        vm.deal(address(acct), 1_000 ether);

        handler = new HotTierHandler(ex, reg, acct, usdc, dai, hot, WINDOW);
        targetContract(address(handler));
    }

    /// @notice Leaky-bucket bound: over any window-length interval, outflow <= capacity + one window of refill.
    function invariant_windowOutflowBounded() public view {
        assertLe(handler.maxWindowSum(false), 2 * uint256(CAP) * MAX_BPS / 10_000, "usdc window outflow");
        assertLe(handler.maxWindowSum(true), 2 * uint256(ETH_CAP) * MAX_BPS / 10_000, "eth window outflow");
    }

    /// @notice The registry threat level only ever increases.
    function invariant_levelMonotonic() public view {
        assertFalse(handler.levelDecreased(), "level decreased");
        assertGe(reg.ladderLevel(), handler.maxLevelSeen());
    }

    /// @notice Untracked assets never leave the account through the executor.
    function invariant_untrackedNeverMoves() public view {
        assertFalse(handler.untrackedMoved(), "untracked call passed");
        assertEq(dai.balanceOf(address(acct)), daiStart, "dai balance");
        assertEq(usdc.allowance(address(acct), handler.sink()), 0, "usdc allowance");
    }

    /// @notice Bucket levels never exceed the configured caps.
    function invariant_availableWithinCap() public view {
        assertLe(ex.available(address(acct), address(usdc)), CAP);
        assertLe(ex.available(address(acct), address(0)), ETH_CAP);
    }
}
