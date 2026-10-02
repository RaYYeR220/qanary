// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";

/// @title Fixtures
/// @notice Reads the shared test vectors under the repository's `vectors/` directory.
library Fixtures {
    /// @notice Decodes a hex file (bare hex, optional trailing newline) from `vectors/<rel>`.
    /// @param vm The forge cheatcode handle.
    /// @param rel Path relative to `vectors/`, e.g. `"fndsa512.pk"`.
    /// @return The decoded bytes.
    function hexFile(Vm vm, string memory rel) internal view returns (bytes memory) {
        string memory raw = vm.trim(vm.readFile(string.concat("../../vectors/", rel)));
        return vm.parseBytes(string.concat("0x", raw));
    }

    /// @notice Reads a JSON file from `vectors/<rel>`.
    /// @param vm The forge cheatcode handle.
    /// @param rel Path relative to `vectors/`, e.g. `"ladder/p192.json"`.
    /// @return The file contents.
    function jsonFile(Vm vm, string memory rel) internal view returns (string memory) {
        return vm.readFile(string.concat("../../vectors/", rel));
    }
}
