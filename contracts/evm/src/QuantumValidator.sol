// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    IERC7579Validator,
    MODULE_TYPE_VALIDATOR,
    VALIDATION_SUCCESS,
    VALIDATION_FAILED
} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {PackedUserOperation} from "@openzeppelin/contracts/interfaces/IERC4337.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title QuantumValidator
/// @notice ERC-7579 validator module that makes a post-quantum public key the root authority of a
///         smart account, with self-service key rotation and time-delayed guardian recovery.
/// @dev The account key is the ERC-7913 signer `verifier ‖ keyPtr`: `verifier` is an ERC-7913
///      signature verifier (e.g. an ML-DSA or Falcon program) and `keyPtr` is a KeyStore pointer
///      whose code is `0x00 ‖ scheme ‖ publicKey`. The verifier receives the 20-byte `keyPtr` as its
///      `key` argument and reads the public key from the pointer's code.
///      Every account-scoped function acts on `msg.sender` (the account); there are no owners or
///      admins. Guardians are ERC-7913 signers (`verifier ‖ key`, longer than 20 bytes) that approve a
///      replacement key over an EIP-712 `Recovery` digest bound to a per-account nonce.
contract QuantumValidator is IERC7579Validator, EIP712 {
    /// @notice The account's root key: an ERC-7913 verifier plus a KeyStore pointer.
    struct Config {
        address verifier;
        address keyPtr;
    }

    /// @notice ABI-encoded payload of `onInstall`. Set `threshold = 0` and pass no guardians to
    ///         install without recovery.
    /// @dev When `onInstall` runs inside ERC-4337 validation (factory `initCode`, enable mode), pass
    ///      no guardians: the guardian list is a dynamic `bytes[]` whose storage is not associated
    ///      with the account under ERC-7562, so bundlers reject it there. Configure guardians with
    ///      `setGuardians` in the execution phase instead (e.g. in the first user operation's callData).
    struct InstallData {
        address verifier;
        address keyPtr;
        bytes[] guardians;
        uint8 threshold;
        uint32 delay;
    }

    /// @notice A guardian-approved key replacement that becomes executable at `eta`.
    struct PendingRecovery {
        address verifier;
        address keyPtr;
        uint48 eta;
    }

    /// @dev Guardian configuration of one account.
    struct GuardianSet {
        bytes[] signers;
        uint8 threshold;
        uint32 delay;
    }

    /// @notice EIP-712 type of the message an account key signs for ERC-1271 checks.
    bytes32 public constant ACCOUNT_MESSAGE_TYPEHASH = keccak256("AccountMessage(address account,bytes32 hash)");

    /// @notice EIP-712 type of the message guardians sign to approve a replacement key.
    bytes32 public constant RECOVERY_TYPEHASH =
        keccak256("Recovery(address account,address verifier,address keyPtr,uint256 nonce)");

    /// @notice Lower bound on the delay between a recovery proposal and its execution.
    uint32 public constant MIN_RECOVERY_DELAY = 1 hours;

    /// @dev Upper bound on the guardian set size, keeping `proposeRecovery` gas bounded.
    uint256 private constant MAX_GUARDIANS = 16;

    /// @dev ERC-1271 failure value.
    bytes4 private constant ERC1271_INVALID = 0xffffffff;

    /// @dev Highest address treated as a (possible) precompile. Verifiers must live above it: a
    ///      precompile such as identity (0x04) echoes the ERC-7913 calldata, whose first word is the
    ///      magic value, and would accept every signature. The bound also covers chain-specific
    ///      precompiles (Arbitrum 0x64-0xff, RIP-7212 P256VERIFY at 0x100).
    uint160 private constant MAX_PRECOMPILE = 0xffff;

    mapping(address account => Config) private _config;
    mapping(address account => GuardianSet) private _guardians;
    mapping(address account => PendingRecovery) private _pending;
    /// @dev Guardian approvals are bound to this nonce. It is incremented by every proposal and by
    ///      every key rotation, guardian change, cancellation, executed recovery and uninstall, and is
    ///      never reset, so approvals that were collected but not submitted die whenever any of these happens.
    mapping(address account => uint256) private _recoveryNonce;

    /// @notice The root key of `account` was set (install, rotation or executed recovery).
    event KeyConfigured(address indexed account, address verifier, address keyPtr);

    /// @notice The guardian set of `account` was replaced.
    event GuardiansSet(address indexed account, uint256 count, uint8 threshold, uint32 delay);

    /// @notice Guardians approved a replacement key for `account`, executable from `eta`.
    event RecoveryProposed(address indexed account, address verifier, address keyPtr, uint48 eta);

    /// @notice A pending recovery of `account` was discarded.
    event RecoveryCancelled(address indexed account);

    /// @notice `onInstall` was called by an account that already has a key configured.
    error AlreadyInitialized(address account);

    /// @notice The operation requires `account` to have installed the module.
    error NotInitialized(address account);

    /// @notice The verifier has no code or lies in the precompile range, or the key pointer holds
    ///         fewer than 2 bytes of code.
    error InvalidKeyConfig();

    /// @notice The guardian set, threshold or delay is malformed, or recovery is not enabled.
    error InvalidGuardianConfig();

    /// @notice Fewer than `threshold` distinct guardians produced a valid approval.
    error InsufficientGuardianSignatures(uint256 valid, uint8 threshold);

    /// @notice The account has no pending recovery.
    error NoPendingRecovery();

    /// @notice The pending recovery cannot be executed before `eta`.
    error RecoveryNotReady(uint48 eta);

    constructor() EIP712("QanaryValidator", "1") {}

    // ------------------------------------------------------------------ ERC-7579 module

    /// @notice Installs the module for the calling account.
    /// @dev `data` is `abi.encode(InstallData)`. The verifier must be deployed code above the
    ///      precompile range. Guardians are optional: `threshold == 0` requires an empty guardian
    ///      list, otherwise `0 < threshold <= guardians.length <= 16`, `delay >= MIN_RECOVERY_DELAY`,
    ///      and every guardian is unique, longer than 20 bytes and prefixed by a valid verifier.
    ///      Without guardians this writes only `_config[msg.sender]` (ERC-7562-associated storage), so
    ///      it is safe during validation. With guardians it is not; see `InstallData`.
    /// @param data The ABI-encoded `InstallData`.
    function onInstall(bytes calldata data) external {
        address account = msg.sender;
        if (isInitialized(account)) revert AlreadyInitialized(account);
        InstallData memory d = abi.decode(data, (InstallData));
        _setKey(account, d.verifier, d.keyPtr);
        if (d.threshold != 0 || d.guardians.length != 0) {
            _setGuardians(account, d.guardians, d.threshold, d.delay);
        }
    }

    /// @notice Removes the calling account's key, guardians and pending recovery.
    /// @dev Increments (never resets) the recovery nonce, so approvals collected before
    ///      uninstalling are unusable after a reinstall.
    function onUninstall(bytes calldata) external {
        address account = msg.sender;
        delete _config[account];
        delete _guardians[account];
        _resetRecovery(account);
    }

    /// @notice Returns whether this module is of type `moduleTypeId`.
    /// @param moduleTypeId An ERC-7579 module type id.
    /// @return True only for the validator type (1).
    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_VALIDATOR;
    }

    /// @notice Returns whether `account` has a key configured.
    /// @param account The smart account.
    /// @return True if the module is installed for `account`.
    function isInitialized(address account) public view returns (bool) {
        return _config[account].verifier != address(0);
    }

    /// @notice Returns the root key of `account`.
    /// @param account The smart account.
    /// @return The configured verifier and key pointer (zero if not installed).
    function configOf(address account) external view returns (Config memory) {
        return _config[account];
    }

    // ------------------------------------------------------------------ validation

    /// @notice Validates `userOp.signature` as a signature of `userOpHash` by the calling account's key.
    /// @dev Reads only `_config[msg.sender]`. Never reverts on a bad signature, a reverting verifier
    ///      or an uninstalled account: those return `VALIDATION_FAILED`.
    /// @param userOp The packed user operation; only its `signature` is read.
    /// @param userOpHash The EntryPoint's hash of `userOp`.
    /// @return `VALIDATION_SUCCESS` (0) or `VALIDATION_FAILED` (1).
    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash) external view returns (uint256) {
        Config memory c = _config[msg.sender];
        if (c.verifier == address(0)) return VALIDATION_FAILED;
        return _isValidSignature(c, userOpHash, userOp.signature) ? VALIDATION_SUCCESS : VALIDATION_FAILED;
    }

    /// @notice ERC-1271 check forwarded by the calling account.
    /// @dev The key must sign `accountDigest(msg.sender, hash)`, not `hash`, so a signature for one
    ///      account can never be replayed on another account that shares the same key. The
    ///      original ERC-1271 caller (first argument) is not used.
    /// @param hash The hash the account was asked to validate.
    /// @param signature The PQ signature over `accountDigest(msg.sender, hash)`.
    /// @return `0x1626ba7e` if valid, `0xffffffff` otherwise.
    function isValidSignatureWithSender(address, bytes32 hash, bytes calldata signature)
        external
        view
        returns (bytes4)
    {
        Config memory c = _config[msg.sender];
        if (c.verifier == address(0)) return ERC1271_INVALID;
        return _isValidSignature(c, accountDigest(msg.sender, hash), signature)
            ? IERC1271.isValidSignature.selector
            : ERC1271_INVALID;
    }

    /// @notice EIP-712 digest an account key signs to approve `hash` for `account` (ERC-1271).
    /// @param account The smart account.
    /// @param hash The application hash.
    /// @return The typed-data digest of `AccountMessage(account, hash)`.
    function accountDigest(address account, bytes32 hash) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(ACCOUNT_MESSAGE_TYPEHASH, account, hash)));
    }

    // ------------------------------------------------------------------ account management

    /// @notice Replaces the calling account's root key, discards any pending recovery and
    ///         invalidates every outstanding guardian approval.
    /// @param verifier The new ERC-7913 verifier (deployed code above the precompile range).
    /// @param keyPtr The new KeyStore pointer.
    function rotateKey(address verifier, address keyPtr) external {
        address account = msg.sender;
        if (!isInitialized(account)) revert NotInitialized(account);
        _setKey(account, verifier, keyPtr);
        _resetRecovery(account);
    }

    /// @notice Replaces the calling account's guardian set, discards any pending recovery and
    ///         invalidates every outstanding guardian approval.
    /// @dev Pass an empty list with `threshold = 0` to disable recovery.
    /// @param guardians ERC-7913 guardian signers (`verifier ‖ key`): unique, longer than 20 bytes,
    ///        and prefixed by a verifier that is deployed code above the precompile range.
    /// @param threshold Approvals required to propose a recovery.
    /// @param delay Seconds between a proposal and its earliest execution (>= `MIN_RECOVERY_DELAY`).
    function setGuardians(bytes[] calldata guardians, uint8 threshold, uint32 delay) external {
        address account = msg.sender;
        if (!isInitialized(account)) revert NotInitialized(account);
        _setGuardians(account, guardians, threshold, delay);
        _resetRecovery(account);
    }

    /// @notice Returns the guardian configuration of `account`.
    /// @param account The smart account.
    /// @return guardians The guardian signers.
    /// @return threshold Approvals required to propose a recovery (0 = recovery disabled).
    /// @return delay Seconds between a proposal and its earliest execution.
    function guardiansOf(address account)
        external
        view
        returns (bytes[] memory guardians, uint8 threshold, uint32 delay)
    {
        GuardianSet storage g = _guardians[account];
        return (g.signers, g.threshold, g.delay);
    }

    // ------------------------------------------------------------------ recovery

    /// @notice EIP-712 digest guardians sign to approve `verifier ‖ keyPtr` as the new key of `account`.
    /// @dev Bound to the account's current recovery nonce, which every proposal, key rotation,
    ///      guardian change, cancellation, executed recovery and uninstall increments.
    /// @param account The smart account being recovered.
    /// @param verifier The proposed ERC-7913 verifier.
    /// @param keyPtr The proposed KeyStore pointer.
    /// @return The typed-data digest of `Recovery(account, verifier, keyPtr, nonce)`.
    function recoveryDigest(address account, address verifier, address keyPtr) public view returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(abi.encode(RECOVERY_TYPEHASH, account, verifier, keyPtr, _recoveryNonce[account]))
            );
    }

    /// @notice Starts a recovery of `account` to a new key, approved by at least `threshold` guardians.
    /// @dev Callable by anyone. `guardianSigs[i]` is guardian `i`'s signature over `recoveryDigest`;
    ///      an empty entry abstains and entries past the guardian count are ignored, so each guardian
    ///      counts at most once. Increments the recovery nonce and overwrites any pending recovery.
    /// @param account The smart account to recover.
    /// @param verifier The proposed ERC-7913 verifier.
    /// @param keyPtr The proposed KeyStore pointer.
    /// @param guardianSigs Guardian signatures aligned to guardian index.
    function proposeRecovery(address account, address verifier, address keyPtr, bytes[] calldata guardianSigs)
        external
    {
        if (!isInitialized(account)) revert NotInitialized(account);
        GuardianSet storage g = _guardians[account];
        uint8 threshold = g.threshold;
        if (threshold == 0) revert InvalidGuardianConfig();
        _requireValidKey(verifier, keyPtr);

        bytes32 digest = recoveryDigest(account, verifier, keyPtr);
        uint256 count = g.signers.length;
        if (guardianSigs.length < count) count = guardianSigs.length;
        uint256 valid = 0;
        for (uint256 i = 0; i < count && valid < threshold; ++i) {
            if (guardianSigs[i].length == 0) continue;
            if (SignatureChecker.isValidSignatureNow(g.signers[i], digest, guardianSigs[i])) ++valid;
        }
        if (valid < threshold) revert InsufficientGuardianSignatures(valid, threshold);

        ++_recoveryNonce[account];
        // casting to 'uint48' is safe because block timestamps stay below 2^48 for millions of years
        // forge-lint: disable-next-line(unsafe-typecast)
        uint48 eta = uint48(block.timestamp) + g.delay;
        _pending[account] = PendingRecovery({verifier: verifier, keyPtr: keyPtr, eta: eta});
        // The only external calls above are the verifiers' STATICCALLs inside SignatureChecker,
        // which cannot modify state or reenter a state-changing path to reorder this log.
        // forge-lint: disable-next-line(reentrancy-events)
        emit RecoveryProposed(account, verifier, keyPtr, eta);
    }

    /// @notice Discards the calling account's pending recovery and invalidates every outstanding
    ///         guardian approval.
    function cancelRecovery() external {
        address account = msg.sender;
        if (_pending[account].eta == 0) revert NoPendingRecovery();
        _resetRecovery(account);
    }

    /// @notice Installs the pending replacement key of `account` once its delay has elapsed.
    /// @dev Callable by anyone. Guardians are left unchanged; outstanding approvals are invalidated.
    /// @param account The smart account being recovered.
    function executeRecovery(address account) external {
        PendingRecovery memory p = _pending[account];
        if (p.eta == 0) revert NoPendingRecovery();
        // Timestamp drift is negligible against a recovery delay of at least one hour.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < p.eta) revert RecoveryNotReady(p.eta);
        delete _pending[account];
        ++_recoveryNonce[account];
        _config[account] = Config({verifier: p.verifier, keyPtr: p.keyPtr});
        emit KeyConfigured(account, p.verifier, p.keyPtr);
    }

    /// @notice Returns the pending recovery of `account` (all zero if none).
    /// @param account The smart account.
    /// @return The pending verifier, key pointer and earliest execution time.
    function pendingRecoveryOf(address account) external view returns (PendingRecovery memory) {
        return _pending[account];
    }

    // ------------------------------------------------------------------ internals

    /// @dev ERC-7913 check of `signature` over `hash` by `c.verifier ‖ c.keyPtr`. A reverting or
    ///      misbehaving verifier yields false: `SignatureChecker` uses a low-level staticcall.
    function _isValidSignature(Config memory c, bytes32 hash, bytes calldata signature) private view returns (bool) {
        return SignatureChecker.isValidSignatureNow(abi.encodePacked(c.verifier, c.keyPtr), hash, signature);
    }

    function _setKey(address account, address verifier, address keyPtr) private {
        _requireValidKey(verifier, keyPtr);
        _config[account] = Config({verifier: verifier, keyPtr: keyPtr});
        emit KeyConfigured(account, verifier, keyPtr);
    }

    function _setGuardians(address account, bytes[] memory guardians, uint8 threshold, uint32 delay) private {
        if (!_isValidGuardianSet(guardians, threshold, delay)) revert InvalidGuardianConfig();
        if (threshold == 0) delay = 0;
        GuardianSet storage g = _guardians[account];
        delete g.signers;
        for (uint256 i = 0; i < guardians.length; ++i) {
            g.signers.push(guardians[i]);
        }
        g.threshold = threshold;
        g.delay = delay;
        emit GuardiansSet(account, guardians.length, threshold, delay);
    }

    /// @dev Invalidates every outstanding guardian approval and discards the pending recovery, if any.
    function _resetRecovery(address account) private {
        ++_recoveryNonce[account];
        if (_pending[account].eta != 0) {
            delete _pending[account];
            emit RecoveryCancelled(account);
        }
    }

    function _requireValidKey(address verifier, address keyPtr) private view {
        if (!_isVerifier(verifier) || keyPtr.code.length < 2) revert InvalidKeyConfig();
    }

    /// @dev A verifier must be deployed code above the precompile range (see `MAX_PRECOMPILE`). An
    ///      address without code would make every check fail (bricking the account); a precompile
    ///      could make every check pass.
    function _isVerifier(address verifier) private view returns (bool) {
        return uint160(verifier) > MAX_PRECOMPILE && verifier.code.length != 0;
    }

    /// @dev `threshold == 0` means "no guardians" and requires an empty list. Otherwise the list
    ///      holds 1..16 unique ERC-7913 signers longer than 20 bytes whose 20-byte prefix passes
    ///      `_isVerifier`, `threshold <= length`, and `delay >= MIN_RECOVERY_DELAY`. Duplicates are
    ///      rejected so no signer counts twice.
    function _isValidGuardianSet(bytes[] memory guardians, uint8 threshold, uint32 delay) private view returns (bool) {
        uint256 n = guardians.length;
        if (threshold == 0) return n == 0;
        if (n > MAX_GUARDIANS || threshold > n || delay < MIN_RECOVERY_DELAY) return false;
        bytes32[] memory ids = new bytes32[](n);
        for (uint256 i = 0; i < n; ++i) {
            if (guardians[i].length <= 20) return false;
            // casting to 'bytes20' is intentional: it takes the 20-byte verifier prefix of `verifier ‖ key`,
            // exactly as SignatureChecker does
            // forge-lint: disable-next-line(unsafe-typecast)
            if (!_isVerifier(address(bytes20(guardians[i])))) return false;
            bytes32 id = keccak256(guardians[i]);
            for (uint256 j = 0; j < i; ++j) {
                if (ids[j] == id) return false;
            }
            ids[i] = id;
        }
        return true;
    }
}
