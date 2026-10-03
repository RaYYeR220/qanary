// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {KeyStore} from "../src/KeyStore.sol";
import {QuantumValidator} from "../src/QuantumValidator.sol";
import {HotTierExecutor} from "../src/HotTierExecutor.sol";
import {CanaryTargets} from "../src/canary/CanaryTargets.sol";
import {QuantumCanaryRegistry} from "../src/canary/QuantumCanaryRegistry.sol";
import {DrillRegistryFactory} from "../src/canary/DrillRegistryFactory.sol";
import {LadderUnavailableVerifier} from "../src/canary/LadderUnavailable.sol";
import {ILadderVerifier} from "../src/interfaces/ILadderVerifier.sol";
import {IQanaryPQVerifier} from "../src/interfaces/IQanaryPQVerifier.sol";
import {PQSafeOwnerFactory} from "../src/safe/PQSafeOwnerFactory.sol";
import {QanaryAccountFactory} from "../src/oz/QanaryAccountFactory.sol";
import {IMLDSAVerifier} from "../src/fallback/vendor/IMLDSAVerifier.sol";
import {MLDSA44ExpandedKeyStore} from "../src/fallback/MLDSA44ExpandedKeyStore.sol";
import {SolidityMLDSA44Verifier} from "../src/fallback/SolidityMLDSA44Verifier.sol";

/// @title Deploy
/// @notice Deploys the Qanary EVM modules on one network and records them in
///         `deployments/<network>.json` under `evm`.
///
///   DEPLOYER_PRIVATE_KEY=0x… forge script script/Deploy.s.sol --rpc-url <rpc> [--broadcast --slow]
///
/// - ML-DSA-44 verifier: the Stylus program from `stylus.mldsa44Verifier` when the record has one,
///   otherwise the Solidity fallback (Keccak-f[1600] helper, vendored core, expanded-key store and the
///   ERC-7913 adapter), recorded as `evm.mldsa44SolidityVerifier`.
/// - Ladder verifier: the Stylus program from `stylus.ladderVerifier`, otherwise
///   `LadderUnavailableVerifier`, so L1–L3 claims fail closed while K1 and R1 work.
/// - Bounty token: `BOUNTY_TOKEN` if set, else USDG on Arbitrum One and none (native-only) elsewhere.
/// - Order: KeyStore, QuantumValidator, HotTierExecutor, PQSafeOwnerFactory, QanaryAccountFactory, the
///   canonical QuantumCanaryRegistry (NUMS targets), DrillRegistryFactory, then the chain-specific
///   ladder stand-in and fallback verifier. With the same deployer nonce (`ALIGN_NONCE`), the shared
///   contracts get the same addresses on every chain.
///
/// Idempotent: a contract already recorded under `evm` with code on-chain is reused, not redeployed.
/// The record is written only when broadcasting; `packages/sdk/scripts/record-deploy.ts` then adds
/// each contract's deployment transaction and gas from the broadcast receipts.
/// Env: NETWORK (default from the chain id), DEPLOYER_PRIVATE_KEY, BOUNTY_TOKEN, ALIGN_NONCE.
contract Deploy is Script {
    /// @dev Global Dollar (USDG) on Arbitrum One.
    address internal constant USDG_ARBITRUM_ONE = 0x004B506865409877C9fA29bfb1ebA929984B9bbC;
    /// @dev keccak256 of the pinned Keccak-f[1600] helper runtime (`src/fallback/vendor/f1600_170.hex`).
    bytes32 internal constant F1600_CODEHASH = 0x4afb4435879cdf8e50474c7aab2bc3a679caed432550ad6dba64f509309a817b;
    string internal constant HELPER_HEX = "src/fallback/vendor/f1600_170.hex";
    string internal constant CORE_ARTIFACT = "MLDSA44Verifier.sol:MLDSA44Verifier";

    string internal path;
    string internal record;
    bool internal writing;
    mapping(bytes32 key => address) internal deployed;

    function run() external {
        string memory network = vm.envOr("NETWORK", _networkOf(block.chainid));
        path = string.concat(vm.projectRoot(), "/../../deployments/", network, ".json");
        record = vm.exists(path) ? vm.readFile(path) : "{}";
        if (vm.keyExistsJson(record, ".chainId")) {
            require(vm.parseJsonUint(record, ".chainId") == block.chainid, "Deploy: record is for another chain");
        }
        writing = vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        console.log("network %s, chain %s, deployer %s", network, block.chainid, deployer);
        if (!writing) console.log("dry run: deployments record not written");

        if (writing && !vm.keyExistsJson(record, ".network")) {
            vm.writeJson(string.concat('{"network":"', network, '","chainId":', vm.toString(block.chainid), "}"), path);
        }

        vm.startBroadcast(pk);
        // Optional: burn nonces up to ALIGN_NONCE with empty self-transfers, so the contracts below land
        // at the same addresses as on a chain where the deployer already used those nonces.
        uint256 align = vm.envOr("ALIGN_NONCE", uint256(0));
        while (vm.getNonce(deployer) < align) {
            (bool ok,) = deployer.call("");
            require(ok, "Deploy: nonce alignment");
        }

        if (_reuse("keyStore") == address(0)) _put("keyStore", address(new KeyStore()));
        if (_reuse("quantumValidator") == address(0)) _put("quantumValidator", address(new QuantumValidator()));
        if (_reuse("hotTierExecutor") == address(0)) _put("hotTierExecutor", address(new HotTierExecutor()));
        if (_reuse("pqSafeOwnerFactory") == address(0)) _put("pqSafeOwnerFactory", address(new PQSafeOwnerFactory()));
        if (_reuse("qanaryAccountFactory") == address(0)) {
            _put("qanaryAccountFactory", address(new QanaryAccountFactory()));
        }

        address token = vm.envOr("BOUNTY_TOKEN", block.chainid == 42161 ? USDG_ARBITRUM_ONE : address(0));
        require(token == address(0) || token.code.length != 0, "Deploy: bounty token has no code");
        bool newRegistry = _reuse("canaryRegistry") == address(0);
        bool newFactory = _reuse("drillRegistryFactory") == address(0);
        address ladder = _stylus("ladderVerifier");
        bool newLadder;
        if (ladder == address(0)) ladder = _reuse("ladderUnavailable");
        if (ladder == address(0)) {
            // deployed right after the registry and the drill factory, which take its address
            newLadder = true;
            uint256 skip = (newRegistry ? 1 : 0) + (newFactory ? 1 : 0);
            ladder = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + skip);
        }
        if (newRegistry) {
            _put(
                "canaryRegistry",
                address(new QuantumCanaryRegistry(ILadderVerifier(ladder), IERC20(token), CanaryTargets.nums(), false))
            );
        }
        if (newFactory) {
            _put("drillRegistryFactory", address(new DrillRegistryFactory(ILadderVerifier(ladder), IERC20(token))));
        }
        if (newLadder) {
            require(
                _put("ladderUnavailable", address(new LadderUnavailableVerifier())) == ladder, "Deploy: ladder address"
            );
        }

        address mldsa44 = _stylus("mldsa44Verifier");
        if (mldsa44 == address(0)) mldsa44 = _fallbackVerifier();
        vm.stopBroadcast();

        // Sanity checks against the deployed (or simulated) contracts.
        // Forge cannot execute Stylus programs; QuantumValidator checks their `schemes()` on-chain at install.
        if (_stylus("mldsa44Verifier") == address(0)) {
            uint8[] memory schemes = IQanaryPQVerifier(mldsa44).schemes();
            require(schemes.length == 1 && schemes[0] == 2, "Deploy: ML-DSA-44 verifier reports other schemes");
        }
        QuantumCanaryRegistry registry = QuantumCanaryRegistry(_reuse("canaryRegistry"));
        require(address(registry.ladder()) == ladder && !registry.isDrill(), "Deploy: registry mismatch");
        require(address(registry.bountyToken()) == token, "Deploy: bounty token mismatch");

        if (writing) {
            for (uint256 i = 0; i < 2; ++i) {
                string memory key = i == 0 ? ".evm.canaryRegistry" : ".evm.drillRegistryFactory";
                vm.writeJson(vm.toString(ladder), path, string.concat(key, ".ladder"));
                vm.writeJson(vm.toString(token), path, string.concat(key, ".bountyToken"));
            }
        }
        console.log("ML-DSA-44 verifier %s, ladder %s, bounty token %s", mldsa44, ladder, token);
    }

    // ------------------------------------------------------------------ fallback verifier

    /// @dev Deploys (or reuses) the Solidity ML-DSA-44 verifier stack; see `src/fallback/README.md`.
    function _fallbackVerifier() internal returns (address adapter) {
        adapter = _reuse("mldsa44SolidityVerifier");
        if (adapter != address(0)) return adapter;

        address helper = _reuse("keccakF1600Helper");
        if (helper == address(0)) {
            bytes memory runtime = vm.parseBytes(string.concat("0x", vm.trim(vm.readFile(HELPER_HEX))));
            helper = _put("keccakF1600Helper", _deployRuntime(runtime));
        }
        require(helper.codehash == F1600_CODEHASH, "Deploy: helper code hash");
        address core = _reuse("mldsa44VerifierCore");
        if (core == address(0)) core = _put("mldsa44VerifierCore", vm.deployCode(CORE_ARTIFACT, abi.encode(helper)));
        address store = _reuse("mldsa44ExpandedKeyStore");
        if (store == address(0)) store = _put("mldsa44ExpandedKeyStore", address(new MLDSA44ExpandedKeyStore(helper)));
        adapter = _put(
            "mldsa44SolidityVerifier",
            address(new SolidityMLDSA44Verifier(IMLDSAVerifier(core), MLDSA44ExpandedKeyStore(store)))
        );
    }

    /// @dev Deploys `runtime` verbatim: PUSH2 len DUP1 PUSH1 12 PUSH1 0 CODECOPY PUSH1 0 RETURN.
    function _deployRuntime(bytes memory runtime) internal returns (address a) {
        require(runtime.length < 0x10000, "Deploy: runtime too large");
        // casting to 'uint16' is safe because of the length check above
        // forge-lint: disable-next-line(unsafe-typecast)
        bytes memory init = abi.encodePacked(hex"61", uint16(runtime.length), hex"80600c6000396000f3", runtime);
        assembly ("memory-safe") {
            a := create(0, add(init, 32), mload(init))
        }
        require(a != address(0) && a.code.length == runtime.length, "Deploy: runtime deployment failed");
    }

    // ------------------------------------------------------------------ record

    /// @dev Address of the live Stylus program `stylus.<key>`, or zero if the record has none.
    function _stylus(string memory key) internal view returns (address a) {
        string memory k = string.concat(".stylus.", key, ".address");
        if (!vm.keyExistsJson(record, k)) return address(0);
        a = vm.parseJsonAddress(record, k);
        require(a.code.length != 0, string.concat("Deploy: no code at stylus.", key));
    }

    /// @dev Address deployed by this run or recorded under `evm.<key>` with code on-chain, else zero.
    function _reuse(string memory key) internal view returns (address a) {
        a = deployed[keccak256(bytes(key))];
        if (a != address(0)) return a;
        string memory k = string.concat(".evm.", key, ".address");
        if (!vm.keyExistsJson(record, k)) return address(0);
        a = vm.parseJsonAddress(record, k);
        if (a.code.length == 0) return address(0);
    }

    /// @dev Remembers `a` as `key` and records it under `evm.<key>.address` when broadcasting.
    function _put(string memory key, address a) internal returns (address) {
        console.log("%s: %s", key, a);
        deployed[keccak256(bytes(key))] = a;
        if (writing) vm.writeJson(vm.toString(a), path, string.concat(".evm.", key, ".address"));
        return a;
    }

    function _networkOf(uint256 chainId) internal pure returns (string memory) {
        if (chainId == 42161) return "arbitrum-one";
        if (chainId == 33139) return "apechain";
        if (chainId == 33111) return "apechain-curtis";
        if (chainId == 421614) return "arbitrum-sepolia";
        if (chainId == 412346) return "devnode";
        revert("Deploy: unknown chain; set NETWORK");
    }
}
