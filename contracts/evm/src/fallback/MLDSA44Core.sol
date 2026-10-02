// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Builds the pinned Fireblocks ML-DSA-44 core (lib/evm-ml-dsa-verifier, MIT, see README.md) as part
// of this project, so its artifact `MLDSA44Verifier.sol:MLDSA44Verifier` is available for deployment
// next to SolidityMLDSA44Verifier. It compiles through the IR pipeline only (foundry.toml
// `compilation_restrictions`); nothing here may be imported by legacy-codegen sources.
// forge-lint: disable-next-line(unused-import)
import {MLDSA44Verifier} from "evm-ml-dsa-verifier/MLDSA44Verifier.sol";
