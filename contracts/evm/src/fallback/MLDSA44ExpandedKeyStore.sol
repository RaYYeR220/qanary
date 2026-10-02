// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MLDSA44KeyExpansion} from "./MLDSA44KeyExpansion.sol";
import {MLDSA44PublicKey} from "./MLDSA44PublicKey.sol";

/// @title MLDSA44ExpandedKeyStore
/// @notice Expands ML-DSA-44 public keys on-chain and stores each expansion as the code of a data
///         contract at a CREATE2 address that depends only on `keccak256(pk)`.
/// @dev The vendored `MLDSA44Verifier` core reads an expanded key (tr, NTT(2^13 t1), ExpandA(rho))
///      from a data contract instead of the raw 1,312-byte key, and cannot tell a genuine expansion
///      from a forged one. `prepare` computes the expansion itself (`MLDSA44KeyExpansion`) and
///      deploys `0x00 || payload` with CREATE2, salt `keccak256(pk)`, under a constant init code
///      that fetches the payload back from this contract (`pendingBlob`). Only this contract can
///      create code at `blobAddress(keccak256(pk))`, and it only does so with the expansion of that
///      very `pk`, so a verifier can derive the blob from the key alone and trust it.
///      Kept apart from `SolidityMLDSA44Verifier` so that the verifier's runtime holds no CREATE2
///      or transient-storage code (ERC-7562), and so that prepared keys outlive a verifier
///      redeployment. Permissionless and idempotent; no owner, no storage.
contract MLDSA44ExpandedKeyStore {
    /// @notice Code size of a prepared blob: the 0x00 prefix plus the 20,544-byte payload.
    uint256 public constant BLOB_SIZE = 20545;

    /// @notice keccak256 of the Keccak-f[1600] helper runtime (`vendor/f1600_170.hex`), the
    ///         constant the vendored `MLDSA44Verifier` core binds its helper to.
    bytes32 public constant F1600_CODEHASH = 0x4afb4435879cdf8e50474c7aab2bc3a679caed432550ad6dba64f509309a817b;

    uint256 private constant PAYLOAD_WORDS = 642; // MLDSA44KeyExpansion.PAYLOAD_LENGTH / 32
    /// @dev Transient slots used while `prepare` deploys a blob: the address the init code runs at,
    ///      then the payload words.
    uint256 private constant T_PENDING = 0;
    uint256 private constant T_PAYLOAD = 1;

    /// @notice The Keccak-f[1600] helper used for SHAKE-128/256 during the expansion.
    address public immutable F1600;
    /// @notice keccak256 of the constant CREATE2 init code of every blob.
    bytes32 public immutable BLOB_INIT_CODE_HASH;

    /// @notice Emitted when `prepare` deploys the expanded key of `pkHash`.
    /// @param pkHash keccak256 of the 1,312-byte public key.
    /// @param blob The data contract holding `0x00 || tr || t1hat || Ahat`.
    event KeyPrepared(bytes32 indexed pkHash, address indexed blob);

    /// @notice The helper's code is not the pinned Keccak-f[1600] runtime.
    error BadHelper();
    /// @notice The CREATE2 deployment of a blob did not produce the expected code.
    error BlobDeployFailed();
    /// @notice `pendingBlob` was called outside a `prepare` deployment.
    error NotPendingBlob();

    /// @param f1600Helper The deployed Keccak-f[1600] helper; its code hash is checked.
    // The code-hash check rejects the zero address (its code hash is 0).
    // forge-lint: disable-next-line(missing-zero-check)
    constructor(address f1600Helper) {
        if (f1600Helper.codehash != F1600_CODEHASH) revert BadHelper();
        F1600 = f1600Helper;
        BLOB_INIT_CODE_HASH = keccak256(blobInitCode());
    }

    /// @notice Expands `key` on-chain and deploys the result at `blobAddress(keccak256(pk))`.
    /// @dev Returns the existing blob if the key is already prepared. Accepts the same key formats
    ///      and reverts with the same key errors as `SolidityMLDSA44Verifier.verify`. Costs about
    ///      9.9M gas: ~5.5M for the expansion and ~4.1M of code deposit for the 20,545-byte blob.
    /// @param key A KeyStore pointer (20 bytes) or an inline `scheme || pk`.
    /// @return blob The data contract holding the expanded key.
    function prepare(bytes calldata key) external returns (address blob) {
        bytes memory pk = MLDSA44PublicKey.fromKey(key);
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
        bytes memory initCode = blobInitCode();
        address deployed;
        assembly ("memory-safe") {
            deployed := create2(0, add(initCode, 32), mload(initCode), pkHash)
            tstore(T_PENDING, 0)
        }
        if (deployed != blob || blob.code.length != BLOB_SIZE) revert BlobDeployFailed();
        // The only external code run above is the pinned helper (STATICCALL) and the blob's init
        // code, which only STATICCALLs back into `pendingBlob`; neither can reenter `prepare`.
        // forge-lint: disable-next-line(reentrancy-events)
        emit KeyPrepared(pkHash, blob);
    }

    /// @notice Returns `0x00 || payload` to the init code of the blob `prepare` is deploying.
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

    /// @notice The CREATE2 address of the blob for the public key with hash `pkHash`.
    /// @param pkHash keccak256 of the 1,312-byte public key.
    /// @return The blob address (it has code only once `prepare` ran for that key).
    function blobAddress(bytes32 pkHash) public view returns (address) {
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), pkHash, BLOB_INIT_CODE_HASH))))
        );
    }

    /// @notice The constant init code of every blob: STATICCALL `pendingBlob()` on the deployer
    ///         (CALLER), revert if that fails, otherwise return the returned bytes as the code.
    /// @dev PUSH4 sel PUSH0 MSTORE PUSH0 PUSH0 PUSH1 4 PUSH1 28 CALLER GAS STATICCALL
    ///      PUSH1 0x16 JUMPI PUSH0 PUSH0 REVERT
    ///      JUMPDEST RETURNDATASIZE PUSH0 PUSH0 RETURNDATACOPY RETURNDATASIZE PUSH0 RETURN
    /// @return The 30-byte init code.
    function blobInitCode() public pure returns (bytes memory) {
        return abi.encodePacked(
            hex"63",
            MLDSA44ExpandedKeyStore.pendingBlob.selector,
            hex"5f525f5f6004601c335afa6016575f5ffd5b3d5f5f3e3d5ff3"
        );
    }
}
