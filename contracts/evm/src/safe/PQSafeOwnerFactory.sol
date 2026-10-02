// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PQSafeOwner} from "./PQSafeOwner.sol";

/// @title PQSafeOwnerFactory
/// @notice Deterministic CREATE2 factory for `PQSafeOwner` contracts.
contract PQSafeOwnerFactory {
    /// @notice Emitted when a new owner contract is deployed.
    /// @param owner The deployed owner.
    /// @param verifier The ERC-7913 verifier.
    /// @param keyPtr The KeyStore pointer.
    event OwnerDeployed(address indexed owner, address indexed verifier, address indexed keyPtr);

    /// @notice Deploys the owner for `(verifier, keyPtr)`, or returns the existing one.
    /// @param verifier The ERC-7913 verifier.
    /// @param keyPtr The KeyStore pointer.
    /// @return The owner contract.
    function deploy(address verifier, address keyPtr) external returns (PQSafeOwner) {
        address predicted = predict(verifier, keyPtr);
        if (predicted.code.length != 0) return PQSafeOwner(predicted);
        PQSafeOwner o = new PQSafeOwner{salt: _salt(verifier, keyPtr)}(verifier, keyPtr);
        emit OwnerDeployed(address(o), verifier, keyPtr);
        return o;
    }

    /// @notice Predicts the owner address for `(verifier, keyPtr)`.
    /// @param verifier The ERC-7913 verifier.
    /// @param keyPtr The KeyStore pointer.
    /// @return The CREATE2 address.
    function predict(address verifier, address keyPtr) public view returns (address) {
        bytes32 initHash = keccak256(abi.encodePacked(type(PQSafeOwner).creationCode, abi.encode(verifier, keyPtr)));
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), _salt(verifier, keyPtr), initHash))))
        );
    }

    function _salt(address verifier, address keyPtr) private pure returns (bytes32) {
        return keccak256(abi.encode(verifier, keyPtr));
    }
}
