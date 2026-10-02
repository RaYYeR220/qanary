// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ILadderVerifier} from "../interfaces/ILadderVerifier.sol";
import {IQuantumCanaryRegistry} from "../interfaces/IQuantumCanaryRegistry.sol";
import {CanaryTargets} from "./CanaryTargets.sol";

/// @title QuantumCanaryRegistry
/// @notice Ownerless, one-way quantum tripwire. Bounties sit on public keys whose private keys nobody
///         knows: a ladder of smaller curves (L1 secp160r1, L2 P-192, L3 P-224, checked by the Stylus
///         ladder verifier) and the production curves (K1 secp256k1 via `ecrecover`, R1 P-256 via the
///         RIP-7212 precompile with a Solidity fallback). A signature by a target key over the
///         registry's claim message proves its discrete log was recovered: the claim raises the ladder
///         level (L1 → 1, L2 → 2, L3/K1/R1 → 3) or marks the curve family broken, forever, and pays the
///         target's bounty to the claimant.
/// @dev The signed digest is always `claimMessage(target, msg.sender)`, computed here and bound to this
///      chain, this registry, the target and the claimant, so a proof cannot be front-run or replayed.
///      Verifiers never see a caller-chosen digest: plain ECDSA over a free digest is forgeable for any
///      key (e ≡ 0, r = s = Qx mod n). Claims are deduplicated by target, never by signature bytes.
///      The signal never depends on a payout: a token push that fails (issuer pause or blacklist, any
///      token revert) or an ETH push the claimant rejects is credited to `owedToken` / `owedEth` and
///      pulled later with `withdrawOwed`, so neither a token issuer nor a dust bounty can veto a claim.
///      There is no owner, no admin and no way to un-claim or lower the level.
contract QuantumCanaryRegistry is IQuantumCanaryRegistry, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /// @notice A non-drill registry must guard exactly the nothing-up-my-sleeve keys `CanaryTargets.nums()`.
    error NonCanonicalTargets();

    struct Bounty {
        uint256 token;
        uint256 eth;
    }

    /// @notice Domain tag of the claim message.
    bytes32 public constant CLAIM_DOMAIN = keccak256("QANARY_CLAIM_V1");

    uint8 private constant TARGET_K1 = 3;
    uint8 private constant TARGET_R1 = 4;
    uint8 private constant MAX_LEVEL = 3;

    /// @notice Stylus ECDSA verifier for the ladder curves (L1–L3).
    ILadderVerifier public immutable ladder;
    /// @notice ERC-20 used for token bounties; `address(0)` disables them (ETH bounties still work).
    IERC20 public immutable bountyToken;

    bool private immutable _drill;
    bytes32 private immutable _l1x;
    bytes32 private immutable _l1y;
    bytes32 private immutable _l2x;
    bytes32 private immutable _l2y;
    bytes32 private immutable _l3x;
    bytes32 private immutable _l3y;
    address private immutable _k1;
    bytes32 private immutable _r1x;
    bytes32 private immutable _r1y;

    /// @inheritdoc IQuantumCanaryRegistry
    uint8 public override ladderLevel;
    uint8 private _claimedBits;
    uint8 private _brokenBits;
    mapping(uint8 target => Bounty) private _bounties;
    /// @inheritdoc IQuantumCanaryRegistry
    mapping(address claimant => uint256) public override owedToken;
    /// @inheritdoc IQuantumCanaryRegistry
    mapping(address claimant => uint256) public override owedEth;

    /// @param ladder_ Ladder verifier for targets 0–2.
    /// @param bountyToken_ Bounty ERC-20, or `address(0)` for ETH-only bounties.
    /// @param t Guarded keys: exactly `CanaryTargets.nums()` unless `drill_` (e.g. `CanaryTargets.drill()`).
    /// @param drill_ Marks a drill registry whose keys are public.
    constructor(ILadderVerifier ladder_, IERC20 bountyToken_, CanaryTargets.Targets memory t, bool drill_) {
        if (!drill_ && keccak256(abi.encode(t)) != keccak256(abi.encode(CanaryTargets.nums()))) {
            revert NonCanonicalTargets();
        }
        ladder = ladder_;
        bountyToken = bountyToken_;
        _drill = drill_;
        _l1x = t.l1x;
        _l1y = t.l1y;
        _l2x = t.l2x;
        _l2y = t.l2y;
        _l3x = t.l3x;
        _l3y = t.l3y;
        _k1 = t.k1;
        _r1x = t.r1x;
        _r1y = t.r1y;
    }

    // ------------------------------------------------------------------ claims

    /// @inheritdoc IQuantumCanaryRegistry
    /// @dev `proof` is `abi.encode(r, s)` for targets 0, 1, 2 and 4 and `abi.encode(v, r, s)` for target 3,
    ///      where K1 accepts only `v ∈ {27, 28}`; any other length or `v`, a high-s K1/R1 signature or a
    ///      failed check is `InvalidProof`. State and events are final before any payout; a failed push is
    ///      credited (see `withdrawOwed`) and reported by `PayoutDeferred`, never reverted.
    function claim(uint8 target, bytes calldata proof) external nonReentrant {
        _requireOpen(target);
        if (!_verify(target, claimMessage(target, msg.sender), proof)) revert InvalidProof();

        _claimedBits |= uint8(1) << target;
        Bounty memory b = _bounties[target];
        delete _bounties[target];
        // The only external call above is the verifiers' STATICCALL (ladder `verify` is `view`; ecrecover
        // and P-256 are precompiles), which cannot reenter a state-changing path to reorder these logs.
        // forge-lint: disable-next-line(reentrancy-events)
        emit Claimed(target, msg.sender, b.token, b.eth);

        uint8 level = target < TARGET_K1 ? target + 1 : MAX_LEVEL;
        uint8 previous = ladderLevel;
        if (level > previous) {
            ladderLevel = level;
            // forge-lint: disable-next-line(reentrancy-events)
            emit LevelRaised(previous, level);
        }
        if (target >= TARGET_K1) {
            uint8 family = target - TARGET_K1;
            _brokenBits |= uint8(1) << family;
            // forge-lint: disable-next-line(reentrancy-events)
            emit FamilyBroken(family);
        }

        // Pushes run under `nonReentrant`; the credits below are the only writes after them.
        uint256 deferredToken = 0;
        uint256 deferredEth = 0;
        if (b.token != 0 && !bountyToken.trySafeTransfer(msg.sender, b.token)) {
            deferredToken = b.token;
            owedToken[msg.sender] += deferredToken;
        }
        if (b.eth != 0) {
            (bool ok,) = msg.sender.call{value: b.eth}("");
            if (!ok) {
                deferredEth = b.eth;
                owedEth[msg.sender] += deferredEth;
            }
        }
        // forge-lint: disable-next-line(reentrancy-events)
        if (deferredToken != 0 || deferredEth != 0) emit PayoutDeferred(msg.sender, deferredToken, deferredEth);
    }

    /// @inheritdoc IQuantumCanaryRegistry
    function withdrawOwed() external nonReentrant {
        uint256 tokenAmount = owedToken[msg.sender];
        uint256 ethAmount = owedEth[msg.sender];
        if (tokenAmount == 0 && ethAmount == 0) revert NothingOwed();
        owedToken[msg.sender] = 0;
        owedEth[msg.sender] = 0;
        emit OwedWithdrawn(msg.sender, tokenAmount, ethAmount);

        if (tokenAmount != 0) bountyToken.safeTransfer(msg.sender, tokenAmount);
        if (ethAmount != 0) {
            (bool ok,) = msg.sender.call{value: ethAmount}("");
            if (!ok) revert EthWithdrawFailed();
        }
    }

    /// @inheritdoc IQuantumCanaryRegistry
    function claimMessage(uint8 target, address claimant) public view returns (bytes32) {
        return keccak256(abi.encode(CLAIM_DOMAIN, block.chainid, address(this), target, claimant));
    }

    // ------------------------------------------------------------------ bounties

    /// @inheritdoc IQuantumCanaryRegistry
    /// @dev Pulls `amount` of the bounty token from `msg.sender` (approval required) and credits the
    ///      registry's measured balance increase, so fee-on-transfer tokens never overstate a bounty.
    function fund(uint8 target, uint256 amount) external nonReentrant {
        if (address(bountyToken) == address(0)) revert TokenBountiesDisabled();
        _requireOpen(target);
        uint256 before = bountyToken.balanceOf(address(this));
        bountyToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = bountyToken.balanceOf(address(this)) - before;
        _bounties[target].token += received;
        // Under `nonReentrant`, the token call above cannot reenter a state-changing path to reorder this log.
        // forge-lint: disable-next-line(reentrancy-events)
        emit Funded(target, msg.sender, received, 0);
    }

    /// @inheritdoc IQuantumCanaryRegistry
    function fundETH(uint8 target) external payable {
        _requireOpen(target);
        _bounties[target].eth += msg.value;
        emit Funded(target, msg.sender, 0, msg.value);
    }

    /// @inheritdoc IQuantumCanaryRegistry
    function bounty(uint8 target) external view returns (uint256 tokenAmount, uint256 ethAmount) {
        Bounty storage b = _bounties[target];
        return (b.token, b.eth);
    }

    // ------------------------------------------------------------------ views

    /// @inheritdoc IQuantumCanaryRegistry
    function familyBroken(uint8 family) external view returns (bool) {
        return (_brokenBits >> family) & 1 != 0;
    }

    /// @inheritdoc IQuantumCanaryRegistry
    function claimed(uint8 target) public view returns (bool) {
        return (_claimedBits >> target) & 1 != 0;
    }

    /// @inheritdoc IQuantumCanaryRegistry
    function targets() external view returns (CanaryTargets.Targets memory) {
        return CanaryTargets.Targets({
            l1x: _l1x, l1y: _l1y, l2x: _l2x, l2y: _l2y, l3x: _l3x, l3y: _l3y, k1: _k1, r1x: _r1x, r1y: _r1y
        });
    }

    /// @inheritdoc IQuantumCanaryRegistry
    function isDrill() external view returns (bool) {
        return _drill;
    }

    // ------------------------------------------------------------------ internals

    function _requireOpen(uint8 target) private view {
        if (target > TARGET_R1) revert InvalidTarget(target);
        if (claimed(target)) revert AlreadyClaimed(target);
    }

    /// @dev Checks `proof` against the target key over the registry-computed digest `m` only.
    function _verify(uint8 target, bytes32 m, bytes calldata proof) private view returns (bool) {
        if (target == TARGET_K1) {
            if (proof.length != 96) return false;
            (uint256 v, bytes32 kr, bytes32 ks) = abi.decode(proof, (uint256, bytes32, bytes32));
            if (v > type(uint8).max) return false;
            // casting to 'uint8' is safe because `v` was range-checked above
            // forge-lint: disable-next-line(unsafe-typecast)
            (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(m, uint8(v), kr, ks);
            return err == ECDSA.RecoverError.NoError && signer == _k1;
        }
        if (proof.length != 64) return false;
        (bytes32 r, bytes32 s) = abi.decode(proof, (bytes32, bytes32));
        if (target == TARGET_R1) return P256.verify(m, r, s, _r1x, _r1y);
        if (target == 0) return ladder.verify(1, _l1x, _l1y, m, r, s);
        if (target == 1) return ladder.verify(2, _l2x, _l2y, m, r, s);
        return ladder.verify(3, _l3x, _l3y, m, r, s);
    }
}
