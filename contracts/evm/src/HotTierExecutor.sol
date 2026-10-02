// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    IERC7579Module,
    IERC7579Execution,
    MODULE_TYPE_EXECUTOR,
    Execution
} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {
    ERC7579Utils,
    Mode,
    ModeSelector,
    ModePayload
} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IQuantumCanaryRegistry} from "./interfaces/IQuantumCanaryRegistry.sol";
import {ISafe} from "./interfaces/ISafe.sol";

/// @title HotTierExecutor
/// @notice ERC-7579 executor (and Safe module) that lets a classical hot key — an ECDSA EOA or a
///         WebAuthn/P-256 passkey — move funds out of a post-quantum treasury account within hard
///         limits: an allowlist of (target, selector) pairs, per-asset leaky-bucket outflow caps
///         measured from real balance differences, and a quantum-canary threat level that scales the
///         caps down, freezes the hot tier, or kills it once the hot key's curve family is broken.
/// @dev Every account-scoped setter acts on `msg.sender` (the account, authorised by its
///      post-quantum key); there are no owners or admins. Everything fails closed: an unconfigured
///      account, a reverting registry or a reverting `balanceOf` on a tracked asset reverts the whole
///      operation. Outflows are the net decrease of each tracked asset's balance across the batch;
///      assets that are not tracked can only leave through explicitly allowlisted calls.
contract HotTierExecutor is IERC7579Module, EIP712, ReentrancyGuardTransient {
    /// @notice Curve family of the hot key, matching the canary registry's family ids.
    enum Family {
        SECP256K1,
        P256
    }

    /// @notice How the executor dispatches calls into the account.
    enum AccountKind {
        ERC7579,
        SAFE
    }

    /// @notice The hot key: an EOA for `SECP256K1`, an uncompressed P-256 public key for `P256`.
    struct HotSigner {
        Family family;
        address eoa;
        bytes32 pubX;
        bytes32 pubY;
    }

    /// @notice One explicitly allowed (target, selector) pair.
    struct AllowEntry {
        address target;
        bytes4 selector;
    }

    /// @notice Full configuration of an account. `levelBps[l]` scales every cap at canary ladder
    ///         level `l` and must be non-increasing; `address(0)` in `assets` tracks native ETH.
    struct Setup {
        AccountKind kind;
        address registry;
        uint32 window;
        uint16[4] levelBps;
        HotSigner signer;
        address[] assets;
        uint128[] caps;
        AllowEntry[] allow;
    }

    /// @notice One call of a hot operation.
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    /// @notice Leaky bucket of one tracked asset. `available` refills linearly to the effective cap
    ///         (`cap * bps / 10000`) over `window` seconds.
    struct Bucket {
        uint128 cap;
        uint128 available;
        uint64 updatedAt;
    }

    /// @dev Stored configuration of one account.
    struct Config {
        IQuantumCanaryRegistry registry;
        AccountKind kind;
        uint32 window;
        uint16[4] levelBps;
        HotSigner signer;
        address[] assets;
    }

    /// @notice EIP-712 type of a hot operation signed by the hot key.
    bytes32 public constant HOT_OP_TYPEHASH =
        keccak256("HotOp(address account,bytes32 callsHash,uint256 nonce,uint256 deadline)");

    /// @notice Upper bound on tracked assets per account (bounds the balance snapshots).
    uint256 public constant MAX_ASSETS = 8;

    /// @dev Basis-point denominator.
    uint256 private constant BPS = 10_000;

    /// @dev Number of ladder levels with a configurable scale; higher levels freeze the hot tier.
    uint256 private constant LEVELS = 4;

    /// @dev Highest address treated as a (possible) precompile; the registry must live above it.
    uint160 private constant MAX_PRECOMPILE = 0xffff;

    mapping(address account => Config) private _config;
    /// @dev Bumped by every (re)configuration and uninstall; allowlist entries are scoped to it.
    mapping(address account => uint256) private _generation;
    /// @dev Signed-operation nonce. Never reset, so signatures die across uninstall/reinstall.
    mapping(address account => uint256) private _nonce;
    mapping(address account => mapping(address asset => bool)) private _tracked;
    mapping(address account => mapping(address asset => Bucket)) private _buckets;
    mapping(
        address account => mapping(uint256 generation => mapping(address target => mapping(bytes4 selector => bool)))
    ) private _allowed;

    /// @notice `account` was (re)configured.
    event Configured(address indexed account, AccountKind kind, address registry);
    /// @notice An allowlist entry of `account` was set or cleared.
    event AllowSet(address indexed account, address indexed target, bytes4 indexed selector, bool allowed);
    /// @notice The cap of a tracked asset of `account` was set.
    event CapSet(address indexed account, address indexed asset, uint128 cap);
    /// @notice The hot key of `account` was set.
    event HotSignerSet(address indexed account, Family family, address eoa);
    /// @notice A hot operation ran; `outflows[i]` is the net outflow of `trackedAssets(account)[i]`.
    event HotOpExecuted(address indexed account, bytes32 indexed callsHash, uint256[] outflows);

    /// @notice `account` has no configuration.
    error NotConfigured(address account);
    /// @notice The configuration violates a rule (window, lengths, duplicates, bps, registry, signer, untracked asset).
    error InvalidSetup();
    /// @notice The caller or signature is not the account's hot key.
    error Unauthorized();
    /// @notice The signed operation's deadline has passed.
    error Expired();
    /// @notice The canary registry reports the hot key's curve family as broken.
    error ClassicalFamilyBroken(uint8 family);
    /// @notice The current ladder level scales the hot tier to zero.
    error HotTierFrozen(uint8 level);
    /// @notice Calls to the account itself, this executor or `address(0)` are never allowed.
    error ForbiddenTarget(address target);
    /// @notice The (target, selector) pair is not allowed.
    error CallNotAllowed(address target, bytes4 selector);
    /// @notice A call sends native value but ETH (`address(0)`) is not a tracked asset.
    error ValueNotTracked();
    /// @notice The net outflow of `asset` exceeds what its bucket currently holds.
    error CapExceeded(address asset, uint256 outflow, uint256 available);
    /// @notice The Safe reported failure for call `index`.
    error ModuleCallFailed(uint256 index);

    constructor() EIP712("QanaryHotTier", "1") {}

    // ------------------------------------------------------------------ ERC-7579 module

    /// @notice Configures the calling account. `data` is `abi.encode(Setup)`; see `configure`.
    /// @param data The ABI-encoded `Setup`.
    function onInstall(bytes calldata data) external nonReentrant {
        _configure(msg.sender, abi.decode(data, (Setup)));
    }

    /// @notice Deletes the calling account's configuration and buckets and invalidates its allowlist.
    function onUninstall(bytes calldata) external nonReentrant {
        _wipe(msg.sender);
    }

    /// @notice Returns whether this module is of type `moduleTypeId`.
    /// @param moduleTypeId An ERC-7579 module type id.
    /// @return True only for the executor type (2).
    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_EXECUTOR;
    }

    /// @notice Returns whether `account` is configured.
    /// @param account The smart account.
    /// @return True if `account` has a configuration.
    function isInitialized(address account) public view returns (bool) {
        return address(_config[account].registry) != address(0);
    }

    // ------------------------------------------------------------------ account configuration

    /// @notice (Re)configures the calling account, replacing any previous configuration: buckets
    ///         start full and earlier allowlist entries stop applying.
    /// @dev Rules: `window > 0`; `assets.length == caps.length <= MAX_ASSETS`; no duplicate
    ///      assets; `levelBps[i] <= 10000` and non-increasing; `registry` is deployed code above the
    ///      precompile range; a SECP256K1 signer needs `eoa != 0`, a P256 signer `pubX != 0`.
    /// @param s The new configuration.
    function configure(Setup calldata s) external nonReentrant {
        _configure(msg.sender, s);
    }

    /// @notice Sets or clears an allowlist entry of the calling account (current generation).
    /// @param target The call target.
    /// @param selector The function selector.
    /// @param allowed Whether hot operations may call `selector` on `target`.
    function setAllowed(address target, bytes4 selector, bool allowed) external nonReentrant {
        address account = msg.sender;
        _requireConfigured(account);
        _allowed[account][_generation[account]][target][selector] = allowed;
        emit AllowSet(account, target, selector, allowed);
    }

    /// @notice Sets the cap of a tracked asset of the calling account. The bucket keeps its level,
    ///         clamped to the new cap.
    /// @param asset A tracked asset (`address(0)` for ETH).
    /// @param cap The new cap at full scale (10000 bps).
    function setCap(address asset, uint128 cap) external nonReentrant {
        address account = msg.sender;
        _requireConfigured(account);
        if (!_tracked[account][asset]) revert InvalidSetup();
        Bucket storage b = _buckets[account][asset];
        b.cap = cap;
        if (b.available > cap) b.available = cap;
        emit CapSet(account, asset, cap);
    }

    /// @notice Replaces the hot key of the calling account.
    /// @param signer The new hot key.
    function setHotSigner(HotSigner calldata signer) external nonReentrant {
        address account = msg.sender;
        _requireConfigured(account);
        _requireValidSigner(signer);
        _config[account].signer = signer;
        emit HotSignerSet(account, signer.family, signer.eoa);
    }

    // ------------------------------------------------------------------ hot operations

    /// @notice Runs `calls` from `account`, sent directly by its SECP256K1 hot EOA.
    /// @param account The configured account.
    /// @param calls The calls to execute as one batch.
    function execute(address account, Call[] calldata calls) external nonReentrant {
        Config storage c = _requireConfigured(account);
        if (c.signer.family != Family.SECP256K1 || msg.sender != c.signer.eoa) revert Unauthorized();
        _run(account, c, calls);
    }

    /// @notice Runs `calls` from `account` authorised by a hot-key signature over `hotOpDigest`
    ///         (any relayer may submit). SECP256K1: a 65-byte ECDSA signature. P256:
    ///         `abi.encode(WebAuthn.WebAuthnAuth)` whose challenge is the 32-byte digest (UP and UV required).
    /// @param account The configured account.
    /// @param calls The calls to execute as one batch.
    /// @param deadline Last timestamp (inclusive) at which the signature is valid.
    /// @param sig The hot-key signature.
    function executeWithSig(address account, Call[] calldata calls, uint256 deadline, bytes calldata sig)
        external
        nonReentrant
    {
        if (block.timestamp > deadline) revert Expired();
        Config storage c = _requireConfigured(account);
        uint256 nonce = _nonce[account];
        bytes32 digest = _hotOpDigest(account, calls, nonce, deadline);
        if (!_isValidHotSig(c.signer, digest, sig)) revert Unauthorized();
        _nonce[account] = nonce + 1;
        _run(account, c, calls);
    }

    // ------------------------------------------------------------------ views

    /// @notice EIP-712 digest of a hot operation.
    /// @param account The account.
    /// @param calls The calls.
    /// @param nonce The account's signed-operation nonce.
    /// @param deadline The signature deadline.
    /// @return The digest the hot key signs.
    function hotOpDigest(address account, Call[] calldata calls, uint256 nonce, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return _hotOpDigest(account, calls, nonce, deadline);
    }

    /// @notice The next signed-operation nonce of `account`.
    /// @param account The account.
    /// @return The nonce the next `executeWithSig` must be signed over.
    function nonceOf(address account) external view returns (uint256) {
        return _nonce[account];
    }

    /// @notice What `account` can move of `asset` right now, after refill at the current threat level.
    /// @param account A configured account.
    /// @param asset The asset (`address(0)` for ETH).
    /// @return The current bucket level (0 if untracked, frozen or the family is broken).
    function available(address account, address asset) external view returns (uint256) {
        Config storage c = _requireConfigured(account);
        if (!_tracked[account][asset]) return 0;
        return _refilled(_buckets[account][asset], _effectiveBps(c), c.window);
    }

    /// @notice Whether a call to `target` with `selector` passes the allowlist stage of a hot op:
    ///         explicitly allowlisted in the current generation, or `transfer` on a tracked token.
    /// @param account The account.
    /// @param target The call target.
    /// @param selector The function selector.
    /// @return True if allowed.
    function isAllowed(address account, address target, bytes4 selector) external view returns (bool) {
        if (!isInitialized(account)) return false;
        return _isAllowed(account, _generation[account], target, selector);
    }

    /// @notice The tracked assets of `account`, in `HotOpExecuted.outflows` order.
    /// @param account The account.
    /// @return The tracked assets (`address(0)` is ETH).
    function trackedAssets(address account) external view returns (address[] memory) {
        return _config[account].assets;
    }

    /// @notice The cap scale of `account` at the current threat level.
    /// @param account A configured account.
    /// @return Basis points applied to every cap; 0 if frozen or the hot key's family is broken.
    function effectiveBps(address account) external view returns (uint16) {
        return _effectiveBps(_requireConfigured(account));
    }

    // ------------------------------------------------------------------ internals

    function _configure(address account, Setup memory s) private {
        uint256 n = s.assets.length;
        if (s.window == 0 || n != s.caps.length || n > MAX_ASSETS || !_isRegistry(s.registry)) {
            revert InvalidSetup();
        }
        for (uint256 i = 0; i < LEVELS; ++i) {
            if (s.levelBps[i] > BPS || (i != 0 && s.levelBps[i] > s.levelBps[i - 1])) revert InvalidSetup();
        }
        _requireValidSigner(s.signer);

        _wipe(account);
        uint256 gen = _generation[account];
        Config storage c = _config[account];
        c.registry = IQuantumCanaryRegistry(s.registry);
        c.kind = s.kind;
        c.window = s.window;
        c.levelBps = s.levelBps;
        c.signer = s.signer;
        for (uint256 i = 0; i < n; ++i) {
            address asset = s.assets[i];
            if (_tracked[account][asset]) revert InvalidSetup();
            _tracked[account][asset] = true;
            c.assets.push(asset);
            _buckets[account][asset] = Bucket(s.caps[i], s.caps[i], uint64(block.timestamp));
            emit CapSet(account, asset, s.caps[i]);
        }
        for (uint256 i = 0; i < s.allow.length; ++i) {
            AllowEntry memory e = s.allow[i];
            _allowed[account][gen][e.target][e.selector] = true;
            emit AllowSet(account, e.target, e.selector, true);
        }
        emit HotSignerSet(account, s.signer.family, s.signer.eoa);
        emit Configured(account, s.kind, s.registry);
    }

    /// @dev Deletes config, buckets and tracked flags and bumps the generation (orphaning the allowlist).
    function _wipe(address account) private {
        address[] storage assets = _config[account].assets;
        for (uint256 i = 0; i < assets.length; ++i) {
            delete _buckets[account][assets[i]];
            delete _tracked[account][assets[i]];
        }
        delete _config[account];
        ++_generation[account];
    }

    function _run(address account, Config storage c, Call[] calldata calls) private {
        uint16 bps = _requireLiveBps(c);
        uint256 gen = _generation[account];
        for (uint256 i = 0; i < calls.length; ++i) {
            Call calldata call = calls[i];
            address target = call.target;
            if (target == account || target == address(this) || target == address(0)) revert ForbiddenTarget(target);
            if (call.value != 0 && !_tracked[account][address(0)]) revert ValueNotTracked();
            uint256 len = call.data.length;
            if (len == 0) continue;
            if (len < 4) revert CallNotAllowed(target, bytes4(0));
            bytes4 selector = bytes4(call.data[:4]);
            if (!_isAllowed(account, gen, target, selector)) revert CallNotAllowed(target, selector);
        }

        address[] memory assets = c.assets;
        uint256 n = assets.length;
        uint256[] memory outflows = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) {
            outflows[i] = _balanceOf(account, assets[i]);
        }
        _dispatch(account, c.kind, calls);
        uint32 window = c.window;
        for (uint256 i = 0; i < n; ++i) {
            uint256 pre = outflows[i];
            uint256 post = _balanceOf(account, assets[i]);
            outflows[i] = pre > post ? pre - post : 0;
            if (outflows[i] != 0) _debit(account, assets[i], outflows[i], bps, window);
        }
        emit HotOpExecuted(account, keccak256(abi.encode(calls)), outflows);
    }

    function _dispatch(address account, AccountKind kind, Call[] calldata calls) private {
        uint256 n = calls.length;
        if (kind == AccountKind.ERC7579) {
            Execution[] memory executions = new Execution[](n);
            for (uint256 i = 0; i < n; ++i) {
                executions[i] = Execution(calls[i].target, calls[i].value, calls[i].data);
            }
            IERC7579Execution(account)
                .executeFromExecutor(
                    Mode.unwrap(
                        ERC7579Utils.encodeMode(
                            ERC7579Utils.CALLTYPE_BATCH,
                            ERC7579Utils.EXECTYPE_DEFAULT,
                            ModeSelector.wrap(bytes4(0)),
                            ModePayload.wrap(bytes22(0))
                        )
                    ),
                    ERC7579Utils.encodeBatch(executions)
                );
        } else {
            for (uint256 i = 0; i < n; ++i) {
                if (!ISafe(account).execTransactionFromModule(calls[i].target, calls[i].value, calls[i].data, 0)) {
                    revert ModuleCallFailed(i);
                }
            }
        }
    }

    function _debit(address account, address asset, uint256 outflow, uint16 bps, uint32 window) private {
        Bucket storage b = _buckets[account][asset];
        uint256 refilled = _refilled(b, bps, window);
        if (outflow > refilled) revert CapExceeded(asset, outflow, refilled);
        // refilled <= cap * bps / 10000 <= type(uint128).max
        b.available = uint128(refilled - outflow);
        b.updatedAt = uint64(block.timestamp);
    }

    /// @dev Bucket level after refill at `bps`; a level above the effective cap is clamped to it.
    function _refilled(Bucket storage b, uint16 bps, uint32 window) private view returns (uint256) {
        uint256 eff = uint256(b.cap) * bps / BPS;
        uint256 level = b.available;
        if (level > eff) level = eff;
        level += (block.timestamp - b.updatedAt) * eff / window;
        return level > eff ? eff : level;
    }

    /// @dev Reverts if the hot key's family is broken or the current level scales the tier to zero.
    function _requireLiveBps(Config storage c) private view returns (uint16 bps) {
        uint8 family = uint8(c.signer.family);
        if (c.registry.familyBroken(family)) revert ClassicalFamilyBroken(family);
        uint8 level = c.registry.ladderLevel();
        if (level < LEVELS) bps = c.levelBps[level];
        if (bps == 0) revert HotTierFrozen(level);
    }

    function _effectiveBps(Config storage c) private view returns (uint16) {
        if (c.registry.familyBroken(uint8(c.signer.family))) return 0;
        uint8 level = c.registry.ladderLevel();
        return level < LEVELS ? c.levelBps[level] : 0;
    }

    function _isAllowed(address account, uint256 gen, address target, bytes4 selector) private view returns (bool) {
        return
            _allowed[account][gen][target][selector]
                || (selector == IERC20.transfer.selector && _tracked[account][target]);
    }

    /// @dev A reverting or malformed `balanceOf` bubbles: the operation fails closed.
    function _balanceOf(address account, address asset) private view returns (uint256) {
        return asset == address(0) ? account.balance : IERC20(asset).balanceOf(account);
    }

    function _hotOpDigest(address account, Call[] calldata calls, uint256 nonce, uint256 deadline)
        private
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(HOT_OP_TYPEHASH, account, keccak256(abi.encode(calls)), nonce, deadline))
        );
    }

    /// @dev ECDSA errors (bad length, high s, bad v) count as invalid. A P256 `sig` that is not a
    ///      well-formed `abi.encode(WebAuthnAuth)` reverts in `abi.decode` (fail closed).
    function _isValidHotSig(HotSigner storage signer, bytes32 digest, bytes calldata sig) private view returns (bool) {
        if (signer.family == Family.SECP256K1) {
            (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(digest, sig);
            return err == ECDSA.RecoverError.NoError && recovered == signer.eoa;
        }
        return
            WebAuthn.verify(
                abi.encodePacked(digest), abi.decode(sig, (WebAuthn.WebAuthnAuth)), signer.pubX, signer.pubY
            );
    }

    function _requireConfigured(address account) private view returns (Config storage c) {
        c = _config[account];
        if (address(c.registry) == address(0)) revert NotConfigured(account);
    }

    function _requireValidSigner(HotSigner memory s) private pure {
        if (s.family == Family.SECP256K1 ? s.eoa == address(0) : s.pubX == bytes32(0)) revert InvalidSetup();
    }

    function _isRegistry(address registry) private view returns (bool) {
        return uint160(registry) > MAX_PRECOMPILE && registry.code.length != 0;
    }
}
