// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

/// @notice arbos-forge cheatcode: activates a Stylus WASM program and returns its address.
/// @dev `artifactPath` is relative to the forge project root (`contracts/evm`).
interface IStylusVm {
    function deployStylusCode(string calldata artifactPath) external returns (address);
}

/// @title DevSign
/// @notice Base contract of the Stylus integration suite (`test/stylus`): deploys the real Stylus
///         verifiers and produces live post-quantum keys and signatures with `scripts/devsign`.
/// @dev The suite needs arbos-forge and node, so it only runs when `STYLUS_TESTS=true`
///      (`scripts/stylus-test.sh`). Under plain `forge test`, `setUp` must return early when
///      `stylusEnabled()` is false and every test carries `stylusOnly`, which skips it.
abstract contract DevSign is Test {
    string private constant DEVSIGN = "../../scripts/devsign/devsign.mjs";
    string private constant WASM_DIR = "stylus-wasm/";

    /// @dev Skips the test unless the Stylus suite is enabled.
    modifier stylusOnly() {
        vm.skip(!stylusEnabled());
        _;
    }

    /// @dev Skips tests in which a Stylus verifier reads a KeyStore pointer (the `account_code`
    ///      hostio) unless `STYLUS_POINTER_TESTS=true`. arbos-foundry v0.1.1 prices that hostio at
    ///      `700 * maxCodeSize / 24576` gas while forge lifts the max code size to `usize::MAX` for
    ///      tests, so every pointer read runs out of gas there. Nitro charges 700 (+ account access);
    ///      arbos-revm a5b5232 and later do too. Enable these tests with an arbos-forge built on it.
    modifier pointerReads() {
        vm.skip(
            !vm.envOr("STYLUS_POINTER_TESTS", false),
            "Stylus key-pointer read: needs STYLUS_POINTER_TESTS=true and a fixed arbos-forge (scripts/stylus-test.sh)"
        );
        _;
    }

    /// @return Whether `STYLUS_TESTS=true` is set (arbos-forge run).
    function stylusEnabled() internal view returns (bool) {
        return vm.envOr("STYLUS_TESTS", false);
    }

    /// @notice Derives the public key for `seed` with the dev signer.
    /// @param scheme `mldsa44`, `mldsa65` or `falcon512` (round-3, padded 666-byte signatures).
    /// @param seed 32-byte key seed.
    /// @return pk The encoded public key (without the scheme byte).
    function pqKeygen(string memory scheme, bytes32 seed) internal returns (bytes memory pk) {
        string[] memory cmd = new string[](5);
        cmd[0] = "node";
        cmd[1] = DEVSIGN;
        cmd[2] = "keygen";
        cmd[3] = scheme;
        cmd[4] = vm.toString(seed);
        pk = vm.ffi(cmd);
        require(pk.length != 0, "devsign keygen failed");
    }

    /// @notice Signs `message` with the key derived from `seed` (deterministic, empty context).
    /// @param scheme `mldsa44`, `mldsa65` or `falcon512`.
    /// @param seed 32-byte key seed.
    /// @param message The signed bytes (a 32-byte hash for the ERC-7913 path).
    /// @return sig The signature.
    function pqSign(string memory scheme, bytes32 seed, bytes memory message) internal returns (bytes memory sig) {
        string[] memory cmd = new string[](6);
        cmd[0] = "node";
        cmd[1] = DEVSIGN;
        cmd[2] = "sign";
        cmd[3] = scheme;
        cmd[4] = vm.toString(seed);
        cmd[5] = vm.toString(message);
        sig = vm.ffi(cmd);
        require(sig.length != 0, "devsign sign failed");
    }

    /// @notice Deploys the four Stylus programs built by `scripts/build-wasm.sh`.
    function deployVerifiers() internal returns (address mldsa44, address mldsa65, address falcon512, address ladder) {
        mldsa44 = _deployStylus("mldsa44_verifier.wasm");
        mldsa65 = _deployStylus("mldsa65_verifier.wasm");
        falcon512 = _deployStylus("falcon512_verifier.wasm");
        ladder = _deployStylus("ladder_verifier.wasm");
    }

    function _deployStylus(string memory file) private returns (address program) {
        program = IStylusVm(address(vm)).deployStylusCode(string.concat(WASM_DIR, file));
        vm.label(program, file);
    }
}
