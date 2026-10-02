// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PackedUserOperation} from "@openzeppelin/contracts/interfaces/IERC4337.sol";
import {Safe} from "@safe/Safe.sol";
import {Enum} from "@safe/common/Enum.sol";
import {SafeProxyFactory} from "@safe/proxies/SafeProxyFactory.sol";
import {DevSign} from "../utils/DevSign.sol";
import {SafeSig} from "../helpers/SafeSig.sol";
import {KeyStore} from "../../src/KeyStore.sol";
import {IQanaryPQVerifier} from "../../src/interfaces/IQanaryPQVerifier.sol";
import {QuantumValidator} from "../../src/QuantumValidator.sol";
import {PQSafeOwner} from "../../src/safe/PQSafeOwner.sol";
import {PQSafeOwnerFactory} from "../../src/safe/PQSafeOwnerFactory.sol";
import {QanaryAccount} from "../../src/oz/QanaryAccount.sol";
import {QanaryAccountFactory} from "../../src/oz/QanaryAccountFactory.sol";

/// @notice The Solidity modules wired to the real Stylus verifiers (arbos-forge) with live dev-signer
///         signatures: QuantumValidator, PQSafeOwner on a local Safe 1.4.1, and QanaryAccount.
///         Run with `scripts/stylus-test.sh --match-contract StylusModules`.
/// @dev Gas figures are call-frame gas with every involved account cooled (`vm.cool`) first; they
///      exclude intrinsic and calldata gas. QuantumValidator and PQSafeOwner always hand the verifier
///      a KeyStore pointer, so their tests are marked `pointerReads` (`STYLUS_POINTER_TESTS=true`, see
///      `DevSign.pointerReads`); QanaryAccount is also covered with an inline `scheme || pk` key.
contract StylusModulesTest is DevSign {
    uint8 internal constant MLDSA44 = 2;
    uint8 internal constant MLDSA65 = 3;
    uint8 internal constant FALCON512 = 4;

    address internal constant ACCOUNT = address(0xA11CE);

    address internal mldsa44;
    address internal mldsa65;
    address internal falcon;
    address internal ladder;
    KeyStore internal ks;

    function setUp() public {
        if (!stylusEnabled()) return;
        (mldsa44, mldsa65, falcon, ladder) = deployVerifiers();
        ks = new KeyStore();
    }

    // ---------------------------------------------------------------- helpers

    function _seed(string memory label) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("qanary-devsign/modules/", label));
    }

    /// @dev Stores the devsign key for `label` in the KeyStore and returns its pointer.
    function _keyPtr(string memory scheme, uint8 id, string memory label) internal returns (address) {
        return ks.store(abi.encodePacked(id, pqKeygen(scheme, _seed(label))));
    }

    function _sign(string memory scheme, string memory label, bytes32 h) internal returns (bytes memory) {
        return pqSign(scheme, _seed(label), abi.encodePacked(h));
    }

    function _cool(address[] memory accounts) internal {
        for (uint256 i = 0; i < accounts.length; ++i) {
            vm.cool(accounts[i]);
        }
    }

    function _op(address sender, bytes memory signature) internal pure returns (PackedUserOperation memory op) {
        op.sender = sender;
        op.signature = signature;
    }

    // ---------------------------------------------------------------- QuantumValidator

    function _install(address verifier, address ptr) internal returns (QuantumValidator qv) {
        qv = new QuantumValidator();
        bytes memory data = abi.encode(
            QuantumValidator.InstallData({
                verifier: verifier, keyPtr: ptr, guardians: new bytes[](0), threshold: 0, delay: 0
            })
        );
        vm.prank(ACCOUNT);
        qv.onInstall(data);
    }

    /// @dev Cold `validateUserOp` from ACCOUNT; returns the validation data and the call-frame gas.
    function _validate(QuantumValidator qv, address ptr, bytes32 h, bytes memory sig)
        internal
        returns (uint256 result, uint256 gasUsed)
    {
        PackedUserOperation memory op = _op(ACCOUNT, sig);
        QuantumValidator.Config memory c = qv.configOf(ACCOUNT);
        address[] memory cold = new address[](3);
        cold[0] = address(qv);
        cold[1] = c.verifier;
        cold[2] = ptr;
        _cool(cold);
        vm.prank(ACCOUNT);
        uint256 g = gasleft();
        result = qv.validateUserOp(op, h);
        gasUsed = g - gasleft();
    }

    function test_validator_mldsa44Pointer() public stylusOnly pointerReads {
        address ptr = _keyPtr("mldsa44", MLDSA44, "validator-44");
        QuantumValidator qv = _install(mldsa44, ptr);
        bytes32 h = bytes32(vm.randomUint());
        bytes memory sig = _sign("mldsa44", "validator-44", h);

        (uint256 r, uint256 g) = _validate(qv, ptr, h, sig);
        assertEq(r, 0, "valid ML-DSA-44 signature");
        emit log_named_uint("gas: QuantumValidator.validateUserOp, ML-DSA-44 pointer", g);

        sig[sig.length / 2] ^= 0x01;
        (r,) = _validate(qv, ptr, h, sig);
        assertEq(r, 1, "tampered signature");
    }

    function test_validator_schemeMismatch_fails() public stylusOnly pointerReads {
        // ML-DSA-65 key behind the pointer, ML-DSA-44 verifier configured: the verifier reverts
        // with UnsupportedScheme(3) and the validator turns that into VALIDATION_FAILED.
        address ptr = _keyPtr("mldsa65", MLDSA65, "validator-65");
        QuantumValidator qv = _install(mldsa44, ptr);
        bytes32 h = bytes32(vm.randomUint());
        bytes memory sig = _sign("mldsa65", "validator-65", h);
        (uint256 r,) = _validate(qv, ptr, h, sig);
        assertEq(r, 1, "scheme mismatch");

        // the failure is the verifier's typed UnsupportedScheme(3), not a trap
        (bool ok, bytes memory ret) =
            mldsa44.staticcall(abi.encodeCall(IQanaryPQVerifier.verify, (abi.encodePacked(ptr), h, sig)));
        assertFalse(ok);
        assertEq(ret, abi.encodeWithSelector(IQanaryPQVerifier.UnsupportedScheme.selector, MLDSA65));
    }

    /// @dev QuantumValidator reads `schemes()` on install: the three Stylus post-quantum verifiers pass
    ///      (no key-pointer read is involved), and the ladder verifier, which has no `schemes()`, is refused.
    function test_validator_acceptsStylusPqVerifiersOnly() public stylusOnly {
        address ptr = ks.store(abi.encodePacked(MLDSA44, new bytes(1312)));
        address[3] memory pq = [mldsa44, mldsa65, falcon];
        QuantumValidator qv = new QuantumValidator();
        for (uint256 i = 0; i < pq.length; ++i) {
            address account = address(uint160(0xACC0 + i));
            vm.prank(account);
            qv.onInstall(
                abi.encode(
                    QuantumValidator.InstallData({
                        verifier: pq[i], keyPtr: ptr, guardians: new bytes[](0), threshold: 0, delay: 0
                    })
                )
            );
            assertEq(qv.configOf(account).verifier, pq[i]);
        }
        bytes memory data = abi.encode(
            QuantumValidator.InstallData({
                verifier: ladder, keyPtr: ptr, guardians: new bytes[](0), threshold: 0, delay: 0
            })
        );
        vm.prank(ACCOUNT);
        vm.expectRevert(QuantumValidator.InvalidKeyConfig.selector);
        qv.onInstall(data);
    }

    function test_validator_falconPointer() public stylusOnly pointerReads {
        address ptr = _keyPtr("falcon512", FALCON512, "validator-falcon");
        QuantumValidator qv = _install(falcon, ptr);
        bytes32 h = bytes32(vm.randomUint());
        (uint256 r, uint256 g) = _validate(qv, ptr, h, _sign("falcon512", "validator-falcon", h));
        assertEq(r, 0, "valid Falcon signature");
        emit log_named_uint("gas: QuantumValidator.validateUserOp, Falcon-512 pointer", g);
    }

    // ---------------------------------------------------------------- PQSafeOwner on Safe 1.4.1

    struct SafeOwner {
        PQSafeOwner owner;
        address ptr;
        string scheme;
        string label;
    }

    function _safeOwners(PQSafeOwnerFactory factory) internal returns (SafeOwner[] memory o) {
        o = new SafeOwner[](3);
        string[3] memory schemes = ["falcon512", "falcon512", "mldsa44"];
        uint8[3] memory ids = [FALCON512, FALCON512, MLDSA44];
        string[3] memory labels = ["safe-falcon-a", "safe-falcon-b", "safe-mldsa44"];
        for (uint256 i = 0; i < 3; ++i) {
            address verifier = ids[i] == FALCON512 ? falcon : mldsa44;
            address ptr = _keyPtr(schemes[i], ids[i], labels[i]);
            o[i] = SafeOwner(factory.deploy(verifier, ptr), ptr, schemes[i], labels[i]);
        }
        // Safe signatures must be ordered by owner address
        for (uint256 i = 1; i < 3; ++i) {
            for (uint256 j = i; j > 0 && address(o[j].owner) < address(o[j - 1].owner); --j) {
                (o[j], o[j - 1]) = (o[j - 1], o[j]);
            }
        }
    }

    function _execSimple(Safe safe, address to, uint256 value, bytes memory sigs) internal returns (bool) {
        return safe.execTransaction(to, value, "", Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), sigs);
    }

    function test_safe_threePQOwners_execTransaction() public stylusOnly pointerReads {
        SafeOwner[] memory o = _safeOwners(new PQSafeOwnerFactory());
        Safe singleton = new Safe();
        address[] memory owners = new address[](3);
        for (uint256 i = 0; i < 3; ++i) {
            owners[i] = address(o[i].owner);
        }
        bytes memory init =
            abi.encodeCall(Safe.setup, (owners, 3, address(0), "", address(0), address(0), 0, payable(address(0))));
        Safe safe = Safe(payable(address(new SafeProxyFactory().createProxyWithNonce(address(singleton), init, 1))));
        vm.deal(address(safe), 1 ether);

        address to = address(0xBEEF);
        bytes32 txHash = safe.getTransactionHash(
            to, 0.5 ether, "", Enum.Operation.Call, 0, 0, 0, address(0), address(0), safe.nonce()
        );
        bytes[] memory sigs = new bytes[](3);
        for (uint256 i = 0; i < 3; ++i) {
            // each key signs the Safe transaction hash bound to this Safe and chain
            sigs[i] = _sign(o[i].scheme, o[i].label, o[i].owner.safeMessageDigest(address(safe), txHash));
        }
        bytes memory packed = SafeSig.contractSignatures(owners, sigs);

        address[] memory cold = new address[](11);
        cold[0] = address(safe);
        cold[1] = address(singleton);
        cold[2] = to;
        for (uint256 i = 0; i < 3; ++i) {
            cold[3 + i] = owners[i];
            cold[6 + i] = o[i].ptr;
        }
        cold[9] = falcon;
        cold[10] = mldsa44;
        _cool(cold);
        uint256 g = gasleft();
        bool ok = _execSimple(safe, to, 0.5 ether, packed);
        g -= gasleft();
        assertTrue(ok, "execTransaction");
        assertEq(to.balance, 0.5 ether);
        emit log_named_uint("gas: Safe.execTransaction, 3-of-3 PQ owners (2 Falcon-512, 1 ML-DSA-44)", g);

        // the same signatures do not authorize the next nonce
        vm.expectRevert(bytes("GS024"));
        _execSimple(safe, to, 0.5 ether, packed);
    }

    // ---------------------------------------------------------------- QanaryAccount

    /// @dev ML-DSA-44 account whose signer is `mldsa44 || signerKey`; a devsign signature over a random
    ///      userOpHash must validate (0) and the same signature with one flipped byte must not (1).
    function _accountValidates(bytes memory signerKey, address ptr, string memory gasLabel) internal {
        QanaryAccountFactory factory = new QanaryAccountFactory();
        QanaryAccount acc =
            QanaryAccount(payable(factory.createAccount(abi.encodePacked(mldsa44, signerKey), bytes32(uint256(1)))));
        bytes32 h = bytes32(vm.randomUint());
        PackedUserOperation memory op = _op(address(acc), _sign("mldsa44", "account-44", h));
        address entryPoint = address(acc.entryPoint());

        address[] memory cold = new address[](ptr == address(0) ? 3 : 4);
        cold[0] = address(acc);
        cold[1] = factory.singleImpl();
        cold[2] = mldsa44;
        if (ptr != address(0)) cold[3] = ptr;
        _cool(cold);
        vm.prank(entryPoint);
        uint256 g = gasleft();
        uint256 r = acc.validateUserOp(op, h, 0);
        g -= gasleft();
        assertEq(r, 0, "valid ML-DSA-44 signature");
        emit log_named_uint(gasLabel, g);

        op.signature[op.signature.length / 2] ^= 0x01;
        vm.prank(entryPoint);
        assertEq(acc.validateUserOp(op, h, 0), 1, "tampered signature");
    }

    function test_qanaryAccount_mldsa44Inline_validateUserOp() public stylusOnly {
        bytes memory key = abi.encodePacked(MLDSA44, pqKeygen("mldsa44", _seed("account-44")));
        _accountValidates(key, address(0), "gas: QanaryAccount.validateUserOp, ML-DSA-44 inline key");
    }

    function test_qanaryAccount_mldsa44Pointer_validateUserOp() public stylusOnly pointerReads {
        address ptr = _keyPtr("mldsa44", MLDSA44, "account-44");
        _accountValidates(abi.encodePacked(ptr), ptr, "gas: QanaryAccount.validateUserOp, ML-DSA-44 pointer");
    }
}
