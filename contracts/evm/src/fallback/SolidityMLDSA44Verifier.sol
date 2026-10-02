// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IQanaryPQVerifier} from "../interfaces/IQanaryPQVerifier.sol";
import {IMLDSAVerifier} from "evm-ml-dsa-verifier/IMLDSAVerifier.sol";
import {MLDSA44KeyExpansion} from "./MLDSA44KeyExpansion.sol";

/// @title SolidityMLDSA44Verifier
/// @notice ERC-7913 ML-DSA-44 verifier in plain EVM code, for chains where the Stylus verifiers
///         cannot be activated. Same ABI, errors, key formats and semantics as the Stylus
///         `mldsa44-verifier`: FIPS 204 pure ML-DSA-44 with an empty context over the 32-byte
///         `hash` as the message (what AWS KMS `ML_DSA_SHAKE_256` with `MessageType: RAW` and
///         noble-post-quantum `ml_dsa44.sign(msg, sk)` produce). An account moves to the Stylus
///         verifier later by rotating to it with the same key pointer.
/// @dev Verification runs on the Fireblocks `MLDSA44Verifier` core (lib/evm-ml-dsa-verifier,
///      see `src/fallback/README.md`), which reads an expanded key (tr, NTT(t1), ExpandA(rho))
///      from a data contract instead of the raw 1,312-byte key. Expanding a key on-chain costs
///      about 5.5M gas, so it happens once per key: `prepareKey` runs the expansion on-chain
///      (`MLDSA44KeyExpansion`) and deploys `0x00 || payload` with CREATE2 at
///      `blobAddress(keccak256(pk))`, under a constant init code that fetches the payload from
///      this contract. Only this contract can create code at that address and it only does so
///      with the expansion of that very `pk`, so `verify` can derive the blob from the key alone
///      (no storage read, which keeps ERC-4337 validation within the ERC-7562 rules) and trust it.
///      `prepareKey` is permissionless and idempotent.
///
///      `verify` flow, in the Stylus verifier's order: parse `key` (20 bytes = KeyStore pointer
///      whose code is `0x00 || scheme || pk`, otherwise inline `scheme || pk`), check the scheme,
///      the public-key length and the signature length, then require the prepared blob and ask the
///      core. A key that was never prepared reverts with `KeyNotPrepared`.
contract SolidityMLDSA44Verifier is IQanaryPQVerifier {
    /// @notice The only scheme id this verifier accepts (ML-DSA-44).
    uint8 public constant SCHEME = 2;
    /// @notice Encoded ML-DSA-44 public-key length.
    uint256 public constant PK_LENGTH = 1312;
    /// @notice ML-DSA-44 signature length.
    uint256 public constant SIGNATURE_LENGTH = 2420;
    /// @notice Code size of a prepared blob: the 0x00 prefix plus the 20,544-byte payload.
    uint256 public constant BLOB_SIZE = 20545;

    /// @dev keccak256 of the Keccak-f[1600] helper runtime (lib/evm-ml-dsa-verifier/helpers/
    ///      f1600_170.hex), the constant `MLDSA44Verifier.F1600_CODEHASH` binds the core to.
    bytes32 public constant F1600_CODEHASH = 0x4afb4435879cdf8e50474c7aab2bc3a679caed432550ad6dba64f509309a817b;

    bytes4 private constant MAGIC = 0x024ad318;
    bytes4 private constant FAIL = 0xffffffff;
    uint256 private constant PAYLOAD_WORDS = 642; // MLDSA44KeyExpansion.PAYLOAD_LENGTH / 32
    /// @dev Transient slots used while `prepareKey` deploys a blob: the blob address the init code
    ///      runs at, then the payload words.
    uint256 private constant T_PENDING = 0;
    uint256 private constant T_PAYLOAD = 1;

    /// @notice The Fireblocks ML-DSA-44 core: `verify(pkBlob, message, signature) -> bool`.
    IMLDSAVerifier public immutable CORE;
    /// @notice The Keccak-f[1600] helper used for the on-chain key expansion.
    address public immutable F1600;
    /// @notice keccak256 of the constant CREATE2 init code of every prepared blob.
    bytes32 public immutable BLOB_INIT_CODE_HASH;

    /// @notice Emitted when `prepareKey` deploys the expanded key of `pkHash`.
    /// @param pkHash keccak256 of the 1,312-byte public key.
    /// @param blob The data contract holding `0x00 || tr || t1hat || Ahat`.
    event KeyPrepared(bytes32 indexed pkHash, address indexed blob);

    /// @notice The public key is well formed but `prepareKey` was never called for it.
    /// @param pkHash keccak256 of the 1,312-byte public key.
    error KeyNotPrepared(bytes32 pkHash);
    /// @notice The helper's code is not the pinned Keccak-f[1600] runtime.
    error BadHelper();
    /// @notice The core address has no code.
    error BadCore();
    /// @notice The CREATE2 deployment of a blob did not produce the expected code.
    error BlobDeployFailed();
    /// @notice `pendingBlob` was called outside a `prepareKey` deployment.
    error NotPendingBlob();

    /// @param core The deployed Fireblocks `MLDSA44Verifier` (bound to `f1600Helper`).
    /// @param f1600Helper The deployed Keccak-f[1600] helper; its code hash is checked.
    // The code-hash check rejects the zero address (its code hash is 0).
    // forge-lint: disable-next-line(missing-zero-check)
    constructor(IMLDSAVerifier core, address f1600Helper) {
        if (f1600Helper.codehash != F1600_CODEHASH) revert BadHelper();
        if (address(core).code.length == 0) revert BadCore();
        CORE = core;
        F1600 = f1600Helper;
        BLOB_INIT_CODE_HASH = keccak256(_blobInitCode());
    }

    // ---------------------------------------------------------------- ERC-7913

    /// @inheritdoc IQanaryPQVerifier
    /// @dev Reverts with `InvalidKeyLength`, `InvalidKey`, `UnsupportedScheme` or
    ///      `InvalidSignatureLength` on malformed input and with `KeyNotPrepared` for a key without
    ///      a blob; a well-formed signature that does not verify returns 0xffffffff.
    function verify(bytes calldata key, bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        bytes32 pkHash = keccak256(_publicKey(key));
        if (signature.length != SIGNATURE_LENGTH) revert InvalidSignatureLength(SIGNATURE_LENGTH, signature.length);
        address blob = blobAddress(pkHash);
        if (blob.code.length != BLOB_SIZE) revert KeyNotPrepared(pkHash);
        return CORE.verify(blob, abi.encodePacked(hash), signature) ? MAGIC : FAIL;
    }

    /// @inheritdoc IQanaryPQVerifier
    function schemes() external pure returns (uint8[] memory s) {
        s = new uint8[](1);
        s[0] = SCHEME;
    }

    // ---------------------------------------------------------------- key preparation

    /// @notice Expands `key` on-chain and deploys the result at `blobAddress(keccak256(pk))`.
    /// @dev Permissionless and idempotent: returns the existing blob if the key is already prepared.
    ///      Accepts the same key formats and reverts with the same errors as `verify`. Costs about
    ///      9.9M gas: ~5.5M for the expansion and ~4.1M of code deposit for the 20,545-byte blob.
    /// @param key A KeyStore pointer (20 bytes) or an inline `scheme || pk`.
    /// @return blob The data contract holding the expanded key.
    function prepareKey(bytes calldata key) external returns (address blob) {
        bytes memory pk = _publicKey(key);
        bytes32 pkHash = keccak256(pk);
        blob = blobAddress(pkHash);
        if (blob.code.length != 0) return blob;
        if (F1600.codehash != F1600_CODEHASH) revert BadHelper();

        bytes memory payload = MLDSA44KeyExpansion.expand(pk, F1600);
        assembly ("memory-safe") {
            tstore(T_PENDING, blob)
            let src := add(payload, 32)
            for { let i := 0 } lt(i, PAYLOAD_WORDS) { i := add(i, 1) } {
                tstore(add(T_PAYLOAD, i), mload(add(src, shl(5, i))))
            }
        }
        bytes memory initCode = _blobInitCode();
        address deployed;
        assembly ("memory-safe") {
            deployed := create2(0, add(initCode, 32), mload(initCode), pkHash)
            tstore(T_PENDING, 0)
        }
        if (deployed != blob || blob.code.length != BLOB_SIZE) revert BlobDeployFailed();
        // The only external code run above is the pinned helper (STATICCALL) and the blob's init
        // code, which only STATICCALLs back into `pendingBlob`; neither can reenter `prepareKey`.
        // forge-lint: disable-next-line(reentrancy-events)
        emit KeyPrepared(pkHash, blob);
    }

    /// @notice Returns `0x00 || payload` to the init code of the blob `prepareKey` is deploying.
    /// @dev Raw (not ABI-encoded) return data; only the pending blob address may call it.
    function pendingBlob() external view {
        address pending;
        assembly ("memory-safe") {
            pending := tload(T_PENDING)
        }
        if (pending == address(0) || msg.sender != pending) revert NotPendingBlob();
        assembly ("memory-safe") {
            let out := mload(0x40)
            mstore8(out, 0)
            let dst := add(out, 1)
            for { let i := 0 } lt(i, PAYLOAD_WORDS) { i := add(i, 1) } {
                mstore(add(dst, shl(5, i)), tload(add(T_PAYLOAD, i)))
            }
            return(out, BLOB_SIZE)
        }
    }

    /// @notice The CREATE2 address of the prepared blob for the public key with hash `pkHash`.
    /// @param pkHash keccak256 of the 1,312-byte public key.
    /// @return The blob address (it has code only once `prepareKey` ran for that key).
    function blobAddress(bytes32 pkHash) public view returns (address) {
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), pkHash, BLOB_INIT_CODE_HASH))))
        );
    }

    /// @notice Whether `key` is well formed and prepared, i.e. `verify` will not revert on it for a
    ///         2,420-byte signature.
    /// @param key A KeyStore pointer (20 bytes) or an inline `scheme || pk`; reverts like `verify`
    ///        when malformed.
    /// @return True if the expanded key is deployed.
    function isPrepared(bytes calldata key) external view returns (bool) {
        return blobAddress(keccak256(_publicKey(key))).code.length == BLOB_SIZE;
    }

    // ---------------------------------------------------------------- internals

    /// @dev Parses an ERC-7913 key exactly like the Stylus verifiers (`qanary_pq::parse_key`,
    ///      `parse_pointer_code`, then the scheme dispatch and the ML-DSA-44 length check) and
    ///      returns the 1,312-byte public key.
    function _publicKey(bytes calldata key) private view returns (bytes memory pk) {
        uint256 len = key.length;
        if (len == 0) revert InvalidKeyLength(1, 0);
        uint8 scheme;
        if (len == 20) {
            // casting to 'bytes20' is safe because `key` is exactly 20 bytes here
            // forge-lint: disable-next-line(unsafe-typecast)
            address ptr = address(bytes20(key));
            uint256 size = ptr.code.length;
            if (size < 2) revert InvalidKey();
            uint256 head;
            assembly ("memory-safe") {
                mstore(0, 0)
                extcodecopy(ptr, 30, 0, 2)
                head := mload(0)
            }
            if (head >> 8 != 0) revert InvalidKey();
            // casting to 'uint8' is safe because `head` holds exactly two code bytes
            // forge-lint: disable-next-line(unsafe-typecast)
            scheme = uint8(head);
            if (scheme != SCHEME) revert UnsupportedScheme(scheme);
            if (size - 2 != PK_LENGTH) revert InvalidKeyLength(PK_LENGTH, size - 2);
            pk = new bytes(PK_LENGTH);
            assembly ("memory-safe") {
                extcodecopy(ptr, add(pk, 32), 2, PK_LENGTH)
            }
        } else {
            scheme = uint8(key[0]);
            if (scheme != SCHEME) revert UnsupportedScheme(scheme);
            if (len - 1 != PK_LENGTH) revert InvalidKeyLength(PK_LENGTH, len - 1);
            pk = key[1:];
        }
    }

    /// @dev Constant init code of every blob: STATICCALL `pendingBlob()` on the deployer
    ///      (CALLER), revert if that fails, otherwise return the returned bytes as the code.
    ///        PUSH4 sel PUSH0 MSTORE PUSH0 PUSH0 PUSH1 4 PUSH1 28 CALLER GAS STATICCALL
    ///        PUSH1 0x16 JUMPI PUSH0 PUSH0 REVERT
    ///        JUMPDEST RETURNDATASIZE PUSH0 PUSH0 RETURNDATACOPY RETURNDATASIZE PUSH0 RETURN
    function _blobInitCode() private pure returns (bytes memory) {
        return abi.encodePacked(
            hex"63",
            SolidityMLDSA44Verifier.pendingBlob.selector,
            hex"5f525f5f6004601c335afa6016575f5ffd5b3d5f5f3e3d5ff3"
        );
    }
}
