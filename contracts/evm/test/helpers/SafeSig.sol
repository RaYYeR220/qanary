// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title SafeSig
/// @notice Test helper that packs Safe contract signatures ({r=owner, s=offset, v=0} + dynamic parts).
library SafeSig {
    /// @param owners Contract owners, sorted ascending by address.
    /// @param sigs The signature each owner's `isValidSignature` expects.
    /// @return packed Static parts for all owners followed by the dynamic `len ‖ sig` parts.
    function contractSignatures(address[] memory owners, bytes[] memory sigs) internal pure returns (bytes memory packed) {
        require(owners.length == sigs.length, "SafeSig: length");
        uint256 offset = owners.length * 65;
        bytes memory statics;
        bytes memory dynamics;
        for (uint256 i = 0; i < owners.length; i++) {
            statics = abi.encodePacked(statics, bytes32(uint256(uint160(owners[i]))), bytes32(offset), uint8(0));
            dynamics = abi.encodePacked(dynamics, bytes32(sigs[i].length), sigs[i]);
            offset += 32 + sigs[i].length;
        }
        packed = abi.encodePacked(statics, dynamics);
    }
}
