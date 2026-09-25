// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title KeyStore
/// @notice Content-addressed, SSTORE2-style store for post-quantum public keys.
/// @dev Each blob is deployed as the runtime code of a throwaway contract, prefixed with a
///      single STOP (0x00) byte so the deployed "contract" can never be executed. Readers
///      (Stylus verifiers) fetch keys via EXTCODECOPY instead of SLOAD, which is far cheaper
///      for large, write-once blobs such as post-quantum public keys.
contract KeyStore {
    /// @notice Emitted when a blob is deployed to a fresh pointer.
    /// @param pointer The address holding `0x00 ‖ blob` as its code.
    /// @param scheme The first byte of `blob`, identifying the PQ scheme.
    /// @param blobHash `keccak256(blob)`, also the CREATE2 salt.
    event KeyStored(address indexed pointer, uint8 indexed scheme, bytes32 indexed blobHash);

    /// @notice `store` was called with a zero-length blob.
    error EmptyBlob();

    /// @notice The CREATE2 deployment of the runtime code failed.
    error DeployFailed();

    /// @dev Creation-code prefix that copies `0x00 ‖ blob` from the tail of the init code into
    ///      memory and returns it as the runtime code:
    ///        PUSH4 <size>  DUP1  PUSH1 0x0E  PUSH1 0x00  CODECOPY  PUSH1 0x00  RETURN
    ///      `<size>` is `blob.length + 1` (the STOP byte plus the blob). The literal `0x0E`
    ///      (14) is the byte length of this prefix itself, i.e. the offset in the init code
    ///      where the `0x00 ‖ blob` payload begins.
    bytes9 private constant CREATION_CODE_SUFFIX = 0x80600E6000396000F3;

    /// @notice Deploys `blob` as `0x00 ‖ blob` at its content-derived address, unless a
    ///         contract is already deployed there.
    /// @dev blob = scheme(1) ‖ publicKey. Deploys code 0x00 ‖ blob via CREATE2(salt =
    ///      keccak256(blob)). Idempotent: a second `store` of the same blob is a no-op that
    ///      returns the existing pointer.
    /// @param blob The scheme byte followed by the public key bytes.
    /// @return pointer The address holding `0x00 ‖ blob` as its code.
    function store(bytes calldata blob) external returns (address pointer) {
        if (blob.length == 0) revert EmptyBlob();

        bytes32 salt = keccak256(blob);
        bytes memory initCode = _initCode(blob);
        pointer = _computeAddress(salt, keccak256(initCode));

        if (pointer.code.length != 0) {
            return pointer;
        }

        address deployed;
        assembly ("memory-safe") {
            deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
        }
        if (deployed == address(0)) revert DeployFailed();

        // The CREATE2 init code above is a fixed CODECOPY/RETURN sequence with no calls to
        // external or attacker-controlled code, so it cannot reenter `store` to reorder this log.
        // forge-lint: disable-next-line(reentrancy-events)
        emit KeyStored(deployed, uint8(blob[0]), salt);
        return deployed;
    }

    /// @notice Predicts the address `store(blob)` would deploy to (or already has).
    /// @param blob The scheme byte followed by the public key bytes.
    /// @return The predicted (or existing) pointer address.
    function pointerOf(bytes calldata blob) external view returns (address) {
        bytes32 salt = keccak256(blob);
        return _computeAddress(salt, keccak256(_initCode(blob)));
    }

    /// @notice Reads back the blob stored at `pointer`, stripping the leading STOP byte.
    /// @param pointer The address returned by a prior `store` call.
    /// @return blob The scheme byte followed by the public key bytes.
    function read(address pointer) external view returns (bytes memory blob) {
        uint256 codeSize = pointer.code.length;
        uint256 blobLength = codeSize - 1;
        blob = new bytes(blobLength);
        assembly ("memory-safe") {
            extcodecopy(pointer, add(blob, 0x20), 1, blobLength)
        }
    }

    /// @dev Builds the CREATE2 init code that returns `0x00 ‖ blob` as runtime code.
    function _initCode(bytes memory blob) private pure returns (bytes memory) {
        // casting to 'uint32' is safe because calldata this size (~4 GiB) exceeds any
        // reachable block gas limit long before the length could overflow uint32
        // forge-lint: disable-next-line(unsafe-typecast)
        uint32 size = uint32(blob.length + 1);
        return abi.encodePacked(bytes1(0x63), size, CREATION_CODE_SUFFIX, bytes1(0x00), blob);
    }

    /// @dev Computes the CREATE2 address for this contract as deployer.
    function _computeAddress(bytes32 salt, bytes32 initCodeHash) private view returns (address) {
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash))))
        );
    }
}
