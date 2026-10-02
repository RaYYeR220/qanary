// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ArbOneFork} from "./ArbOneFork.sol";
import {KeyStore} from "../../src/KeyStore.sol";
import {PQSafeOwner} from "../../src/safe/PQSafeOwner.sol";
import {PQSafeOwnerFactory} from "../../src/safe/PQSafeOwnerFactory.sol";
import {MockVerifier} from "../mocks/MockVerifier.sol";

/// @notice The Safe 1.3.0 (GnosisSafeL2) functions the simulation uses.
interface ISafe130 {
    function VERSION() external view returns (string memory);
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
    function isOwner(address owner) external view returns (bool);
    function nonce() external view returns (uint256);
    function swapOwner(address prevOwner, address oldOwner, address newOwner) external;
    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 nonce
    ) external view returns (bytes32);
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes calldata signatures
    ) external payable returns (bool);
}

/// @title SecurityCouncilForkSimulationTest
/// @notice FORK SIMULATION ONLY. On a local fork of Arbitrum One, the Arbitrum Security Council emergency
///         Safe (Safe 1.3.0, 9-of-12) is re-owned by twelve post-quantum ERC-1271 owners (`PQSafeOwner`)
///         by impersonating the Safe (`vm.prank`) for each `swapOwner`. Nothing is signed by or broadcast
///         to the real council; the test only shows that the deployed Safe accepts PQ contract owners
///         unchanged, keeps its 9-of-12 policy, and executes with nine PQ signatures but not eight.
/// @dev The PQ owners use `MockVerifier` keys (plain forge cannot execute Stylus programs). Safe 1.3.0
///      validates contract signatures through the legacy `isValidSignature(bytes txHashData, bytes)`
///      (magic `0x20c13b0b`), which `PQSafeOwner` implements over `keccak256(txHashData)`.
contract SecurityCouncilForkSimulationTest is ArbOneFork {
    /// @dev Arbitrum Security Council emergency Safe on Arbitrum One.
    ISafe130 internal constant COUNCIL = ISafe130(0x423552c0F05baCCac5Bfa91C6dCF1dc53a0A1641);
    /// @dev GnosisSafeL2 1.3.0 singleton behind the council proxy.
    address internal constant SAFE_L2_130_SINGLETON = 0x3E5c63644E683549055b9Be8653de26E0B4CD36E;
    address internal constant SENTINEL = address(0x1);
    uint256 internal constant OWNERS = 12;
    uint256 internal constant THRESHOLD = 9;

    MockVerifier internal mv;
    KeyStore internal ks;
    PQSafeOwnerFactory internal ownerFactory;

    address[] internal classicalOwners; // the council's owners at the pinned block
    address[] internal pqOwners; // sorted ascending (Safe signature order)
    mapping(address owner => address keyPtr) internal keyOf;
    address internal noop;

    function setUp() public {
        if (!_fork()) return;
        mv = new MockVerifier();
        ks = new KeyStore();
        ownerFactory = new PQSafeOwnerFactory();
        noop = makeAddr("noop");

        classicalOwners = COUNCIL.getOwners();
        assertEq(classicalOwners.length, OWNERS);
        assertEq(COUNCIL.getThreshold(), THRESHOLD);

        // Simulation: the Safe "approves" its own swapOwner calls (authorized == self-call).
        address prev = SENTINEL;
        for (uint256 i = 0; i < OWNERS; ++i) {
            address ptr = ks.store(abi.encodePacked(uint8(2), keccak256(abi.encode("council PQ key", i))));
            address pq = address(ownerFactory.deploy(address(mv), ptr));
            keyOf[pq] = ptr;
            vm.prank(address(COUNCIL));
            COUNCIL.swapOwner(prev, classicalOwners[i], pq);
            prev = pq;
            pqOwners.push(pq);
        }
        _sortAscending(pqOwners);
    }

    // ---------------------------------------------------------------- helpers

    function _sortAscending(address[] storage a) internal {
        for (uint256 i = 1; i < a.length; ++i) {
            for (uint256 j = i; j > 0 && a[j] < a[j - 1]; --j) {
                (a[j], a[j - 1]) = (a[j - 1], a[j]);
            }
        }
    }

    function _txHash(address to) internal view returns (bytes32) {
        return COUNCIL.getTransactionHash(to, 0, "", 0, 0, 0, 0, address(0), address(0), COUNCIL.nonce());
    }

    /// @dev Safe signature blob: one 65-byte static entry per signer (`r = owner`, `s = offset`, `v = 0` for a
    ///      contract signature; `v = 1` with no dynamic part for an owner that is `msg.sender`), followed by the
    ///      `len ‖ sig` dynamic parts. `staticSlots` sets where the dynamic area starts (normally the signer
    ///      count; Safe requires offsets >= threshold * 65).
    function _pack(address[] memory signers, bool[] memory approvedBySender, bytes32 txHash, uint256 staticSlots)
        internal
        view
        returns (bytes memory statics, bytes memory dynamics)
    {
        uint256 offset = staticSlots * 65;
        for (uint256 i = 0; i < signers.length; ++i) {
            if (approvedBySender[i]) {
                statics = abi.encodePacked(statics, bytes32(uint256(uint160(signers[i]))), bytes32(0), uint8(1));
                continue;
            }
            bytes memory sig = _pqSig(keyOf[signers[i]], txHash);
            statics = abi.encodePacked(statics, bytes32(uint256(uint160(signers[i]))), bytes32(offset), uint8(0));
            dynamics = abi.encodePacked(dynamics, bytes32(sig.length), sig);
            offset += 32 + sig.length;
        }
    }

    /// @dev Signatures of the first `count` PQ owners (ascending), packed the standard way.
    function _pqSignatures(uint256 count, bytes32 txHash) internal view returns (bytes memory) {
        address[] memory signers = new address[](count);
        for (uint256 i = 0; i < count; ++i) {
            signers[i] = pqOwners[i];
        }
        (bytes memory s, bytes memory d) = _pack(signers, new bool[](count), txHash, count);
        return abi.encodePacked(s, d);
    }

    function _exec(address to, bytes memory sigs) internal returns (bool) {
        return COUNCIL.execTransaction(to, 0, "", 0, 0, 0, 0, address(0), payable(address(0)), sigs);
    }

    // ---------------------------------------------------------------- tests

    function test_forkSimulation_councilReownedByTwelvePqOwners() public onlyFork {
        assertEq(COUNCIL.VERSION(), "1.3.0");
        address[] memory owners = COUNCIL.getOwners();
        assertEq(owners.length, OWNERS);
        assertEq(COUNCIL.getThreshold(), THRESHOLD);
        for (uint256 i = 0; i < OWNERS; ++i) {
            assertFalse(COUNCIL.isOwner(classicalOwners[i]), "classical owner still present");
            assertTrue(COUNCIL.isOwner(pqOwners[i]), "PQ owner missing");
            assertEq(PQSafeOwner(pqOwners[i]).verifier(), address(mv));
            assertEq(PQSafeOwner(pqOwners[i]).keyPtr(), keyOf[pqOwners[i]]);
        }
    }

    /// @dev Executes the no-op with `sigs` priced like a fresh transaction (Safe proxy and singleton, owners,
    ///      their key pointers and the verifier start cold) and logs gas and sizes under `label`.
    function _measuredExec(bytes memory sigs, string memory label) internal {
        uint256 nonceBefore = COUNCIL.nonce();
        uint256 size =
            abi.encodeCall(ISafe130.execTransaction, (noop, 0, "", 0, 0, 0, 0, address(0), payable(address(0)), sigs))
        .length;
        address[] memory owners = COUNCIL.getOwners();
        address[] memory touched = new address[](owners.length + 4);
        for (uint256 i = 0; i < owners.length; ++i) {
            touched[i] = owners[i];
            if (keyOf[owners[i]] != address(0)) vm.cool(keyOf[owners[i]]);
        }
        touched[owners.length] = address(COUNCIL);
        touched[owners.length + 1] = SAFE_L2_130_SINGLETON;
        touched[owners.length + 2] = address(mv);
        touched[owners.length + 3] = noop;
        _cool(touched);

        uint256 g = gasleft();
        assertTrue(_exec(noop, sigs));
        uint256 gasUsed = g - gasleft();

        assertEq(COUNCIL.nonce(), nonceBefore + 1);
        emit log_named_uint(string.concat("gas: council execTransaction, ", label), gasUsed);
        emit log_named_uint(string.concat("bytes: signatures blob, ", label), sigs.length);
        emit log_named_uint(string.concat("bytes: execTransaction calldata, ", label), size);
    }

    function test_forkSimulation_ninePqSignatures_execute() public onlyFork {
        assertEq(address(uint160(uint256(vm.load(address(COUNCIL), 0)))), SAFE_L2_130_SINGLETON);
        _measuredExec(_pqSignatures(THRESHOLD, _txHash(noop)), "9 PQ contract signatures (mock verifier, 128 B)");
    }

    /// @dev Like-for-like baseline: the same Safe re-owned (simulation) by twelve fresh ECDSA EOAs, 9 of them sign.
    function test_forkSimulation_baseline_nineEcdsaSignatures_execute() public onlyFork {
        address[] memory current = COUNCIL.getOwners();
        address[] memory eoas = new address[](OWNERS);
        uint256[] memory keys = new uint256[](OWNERS);
        address prev = SENTINEL;
        for (uint256 i = 0; i < OWNERS; ++i) {
            keys[i] = 0xC0C11 + i;
            eoas[i] = vm.addr(keys[i]);
            vm.prank(address(COUNCIL));
            COUNCIL.swapOwner(prev, current[i], eoas[i]);
            prev = eoas[i];
        }
        for (uint256 i = 1; i < OWNERS; ++i) {
            for (uint256 j = i; j > 0 && eoas[j] < eoas[j - 1]; --j) {
                (eoas[j], eoas[j - 1]) = (eoas[j - 1], eoas[j]);
                (keys[j], keys[j - 1]) = (keys[j - 1], keys[j]);
            }
        }
        bytes32 txHash = _txHash(noop);
        bytes memory sigs;
        for (uint256 i = 0; i < THRESHOLD; ++i) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(keys[i], txHash);
            sigs = abi.encodePacked(sigs, r, s, v);
        }
        _measuredExec(sigs, "9 ECDSA signatures (baseline)");
    }

    function test_forkSimulation_eightPqSignatures_revert() public onlyFork {
        bytes32 txHash = _txHash(noop);

        // Eight signatures packed for eight signers: their offsets point inside the 9 * 65-byte static part.
        vm.expectRevert(bytes("GS021"));
        _exec(noop, _pqSignatures(THRESHOLD - 1, txHash));

        // Only the eight static entries (shorter than 9 * 65 bytes).
        address[] memory eight = new address[](THRESHOLD - 1);
        for (uint256 i = 0; i < eight.length; ++i) {
            eight[i] = pqOwners[i];
        }
        (bytes memory statics,) = _pack(eight, new bool[](eight.length), txHash, THRESHOLD);
        assertLt(statics.length, THRESHOLD * 65);
        vm.expectRevert(bytes("GS020"));
        _exec(noop, statics);

        // Nine slots where the ninth repeats the eighth signer: each owner counts once.
        address[] memory padded = new address[](THRESHOLD);
        for (uint256 i = 0; i < eight.length; ++i) {
            padded[i] = eight[i];
        }
        padded[THRESHOLD - 1] = eight[eight.length - 1];
        (bytes memory s, bytes memory d) = _pack(padded, new bool[](THRESHOLD), txHash, THRESHOLD);
        vm.expectRevert(bytes("GS026"));
        _exec(noop, abi.encodePacked(s, d));
    }

    /// @dev A former (classical) owner submitting the transaction itself no longer counts as a signer.
    function test_forkSimulation_formerClassicalOwnerNoLongerCounts() public onlyFork {
        bytes32 txHash = _txHash(noop);
        address former = classicalOwners[0];

        // Eight PQ owners plus the former owner as `msg.sender` (v = 1), sorted ascending.
        address[] memory signers = new address[](THRESHOLD);
        bool[] memory bySender = new bool[](THRESHOLD);
        for (uint256 i = 0; i < THRESHOLD - 1; ++i) {
            signers[i] = pqOwners[i];
        }
        signers[THRESHOLD - 1] = former;
        for (uint256 i = 1; i < THRESHOLD; ++i) {
            for (uint256 j = i; j > 0 && signers[j] < signers[j - 1]; --j) {
                (signers[j], signers[j - 1]) = (signers[j - 1], signers[j]);
            }
        }
        for (uint256 i = 0; i < THRESHOLD; ++i) {
            bySender[i] = signers[i] == former;
        }
        (bytes memory s, bytes memory d) = _pack(signers, bySender, txHash, THRESHOLD);

        vm.prank(former);
        vm.expectRevert(bytes("GS026"));
        _exec(noop, abi.encodePacked(s, d));
    }
}
