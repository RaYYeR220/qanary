// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IEntryPoint, PackedUserOperation} from "@openzeppelin/contracts/interfaces/IERC4337.sol";
import {Execution} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ArbOneFork} from "./ArbOneFork.sol";
import {KeyStore} from "../../src/KeyStore.sol";
import {QuantumValidator} from "../../src/QuantumValidator.sol";
import {HotTierExecutor} from "../../src/HotTierExecutor.sol";
import {MockVerifier} from "../mocks/MockVerifier.sol";
import {MockCanaryRegistry} from "../mocks/MockCanaryRegistry.sol";

/// @notice ZeroDev Kernel v3.3 (`kernel.advanced.v0.3.3`), checked against the `v3.3` tag. Its
///         `ValidationId` is `bytes21` (`0x01 ‖ validator` for a plain validator) and `IHook` an address.
interface IKernel {
    struct ValidationConfig {
        uint32 nonce;
        address hook;
    }

    function initialize(
        bytes21 rootValidator,
        address hook,
        bytes calldata validatorData,
        bytes calldata hookData,
        bytes[] calldata initConfig
    ) external;
    function execute(bytes32 mode, bytes calldata executionCalldata) external payable;
    function executeFromExecutor(bytes32 mode, bytes calldata executionCalldata)
        external
        payable
        returns (bytes[] memory);
    function installModule(uint256 moduleType, address module, bytes calldata initData) external payable;
    function uninstallModule(uint256 moduleType, address module, bytes calldata deInitData) external payable;
    function changeRootValidator(
        bytes21 rootValidator,
        address hook,
        bytes calldata validatorData,
        bytes calldata hookData
    ) external payable;
    function invalidateNonce(uint32 nonce) external payable;
    function rootValidator() external view returns (bytes21);
    function currentNonce() external view returns (uint32);
    function validNonceFrom() external view returns (uint32);
    function validationConfig(bytes21 vId) external view returns (ValidationConfig memory);
    function isModuleInstalled(uint256 moduleType, address module, bytes calldata additionalContext)
        external
        view
        returns (bool);
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
    function accountId() external view returns (string memory);
    function entrypoint() external view returns (address);
    function eip712Domain()
        external
        view
        returns (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        );
}

interface IKernelFactory {
    function implementation() external view returns (address);
    function createAccount(bytes calldata data, bytes32 salt) external payable returns (address);
    function getAddress(bytes calldata data, bytes32 salt) external view returns (address);
}

/// @notice ZeroDev meta factory (`FactoryStaker`): the staked factory the ZeroDev SDK puts in `initCode`.
interface IFactoryStaker {
    function approved(address factory) external view returns (bool);
    function deployWithFactory(address factory, bytes calldata createData, bytes32 salt)
        external
        payable
        returns (address);
}

interface IKernelECDSAValidator {
    function ecdsaValidatorStorage(address account) external view returns (address owner);
}

/// @notice Kernel errors (v3.3 source).
interface IKernelErrors {
    error InvalidCaller();
    error InvalidExecutor();
    error InvalidValidator();
    error InvalidNonce();
}

/// @title KernelForkTest
/// @notice QuantumValidator (root) and HotTierExecutor on the real ZeroDev Kernel v3.3 deployment and the
///         real EntryPoint v0.7 on an Arbitrum One fork, moving real USDG: counterfactual deployment
///         through the ZeroDev meta factory, PQ-signed user operations, the capped hot tier through
///         `executeFromExecutor`, ERC-1271 through Kernel's EIP-712 wrapper, and the in-place upgrade of
///         an ECDSA-rooted Kernel to a post-quantum root.
contract KernelForkTest is ArbOneFork {
    address internal constant KERNEL_IMPL = 0xd6CEDDe84be40893d153Be9d467CD6aD37875b28;
    address internal constant KERNEL_FACTORY = 0x2577507b78c2008Ff367261CB6285d44ba5eF2E9;
    address internal constant META_FACTORY = 0xd703aaE79538628d27099B8c4f621bE4CCd142d5;
    address internal constant ECDSA_VALIDATOR = 0x845ADb2C711129d4f3966735eD98a9F09fC4cE57;

    uint256 internal constant MODULE_TYPE_VALIDATOR = 1;
    uint256 internal constant MODULE_TYPE_EXECUTOR = 2;
    /// @dev ERC-7579 mode: call type single (0x00) / batch (0x01), default exec type, no selector/payload.
    bytes32 internal constant MODE_SINGLE = bytes32(0);
    bytes32 internal constant MODE_BATCH = bytes32(uint256(1) << 248);
    /// @dev Kernel's `KERNEL_WRAPPER_TYPE_HASH`.
    bytes32 internal constant KERNEL_WRAPPER_TYPEHASH =
        0x1547321c374afde8a591d972a084b071c594c275e36724931ff96c25f2999c83;
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes4 internal constant MAGIC = 0x1626ba7e;
    bytes4 internal constant INVALID = 0xffffffff;

    uint128 internal constant HOT_CAP = 100e6; // 100 USDG per day for the hot key
    uint256 internal constant FUNDING = 1_000e6;
    uint256 internal constant ECDSA_OWNER_KEY = 0xA11CE;

    MockVerifier internal mv;
    KeyStore internal ks;
    QuantumValidator internal qv;
    HotTierExecutor internal hotTier;
    MockCanaryRegistry internal registry;
    address internal keyPtr;
    address internal hot;
    address internal bob;

    /// @dev PQ-rooted Kernel deployed by its first user operation in `setUp`.
    IKernel internal account;

    function setUp() public {
        if (!_fork()) return;
        mv = new MockVerifier();
        ks = new KeyStore();
        qv = new QuantumValidator();
        hotTier = new HotTierExecutor();
        registry = new MockCanaryRegistry();
        keyPtr = ks.store(abi.encodePacked(uint8(2), keccak256("mock ML-DSA-44 public key")));
        hot = makeAddr("hot");
        bob = makeAddr("bob");
        (account,,) = _deployPqKernel(bytes32(uint256(1)), false);
    }

    // ---------------------------------------------------------------- helpers

    function _vId(address validator) internal pure returns (bytes21) {
        return bytes21(abi.encodePacked(bytes1(0x01), validator));
    }

    function _qvInstallData() internal view returns (bytes memory) {
        return abi.encode(
            QuantumValidator.InstallData({
                verifier: address(mv), keyPtr: keyPtr, guardians: new bytes[](0), threshold: 0, delay: 0
            })
        );
    }

    function _pqInitData(bytes[] memory initConfig) internal view returns (bytes memory) {
        return abi.encodeCall(IKernel.initialize, (_vId(address(qv)), address(0), _qvInstallData(), "", initConfig));
    }

    function _hotSetup() internal view returns (HotTierExecutor.Setup memory s) {
        s.kind = HotTierExecutor.AccountKind.ERC7579;
        s.registry = address(registry);
        s.window = 1 days;
        s.levelBps = [uint16(10_000), 5_000, 2_500, 0];
        s.signer = HotTierExecutor.HotSigner(HotTierExecutor.Family.SECP256K1, hot, bytes32(0), bytes32(0));
        s.assets = new address[](1);
        s.assets[0] = USDG;
        s.caps = new uint128[](1);
        s.caps[0] = HOT_CAP;
        s.allow = new HotTierExecutor.AllowEntry[](0);
    }

    /// @dev Kernel `installModule(2, …)` initData: `hook(20) ‖ abi.encode(executorData, hookData)`.
    function _installHotTierCall(address acct) internal view returns (Execution memory) {
        bytes memory initData = abi.encodePacked(address(0), abi.encode(abi.encode(_hotSetup()), bytes("")));
        return
            Execution(
                acct, 0, abi.encodeCall(IKernel.installModule, (MODULE_TYPE_EXECUTOR, address(hotTier), initData))
            );
    }

    function _usdgTransfer(address to, uint256 amount) internal pure returns (Execution memory) {
        return Execution(USDG, 0, abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    function _batch(Execution[] memory calls) internal pure returns (bytes memory) {
        return abi.encodeCall(IKernel.execute, (MODE_BATCH, abi.encode(calls)));
    }

    function _single(Execution memory c) internal pure returns (bytes memory) {
        return abi.encodeCall(IKernel.execute, (MODE_SINGLE, abi.encodePacked(c.target, c.value, c.callData)));
    }

    /// @dev Root-validator user operation (nonce key 0) signed with the account's PQ key.
    function _pqOp(address acct, bytes memory initCode, bytes memory callData)
        internal
        view
        returns (PackedUserOperation memory op)
    {
        op = _userOp(acct, IEntryPoint(ENTRYPOINT_V07).getNonce(acct, 0), initCode, callData);
        op.signature = _pqSig(keyPtr, _userOpHash(ENTRYPOINT_V07, op));
    }

    /// @dev Cools `acct` and every contract a Kernel operation touches (see `ArbOneFork._cool`).
    function _coolKernel(address acct) internal {
        address[11] memory touched = [
            acct,
            KERNEL_IMPL,
            KERNEL_FACTORY,
            META_FACTORY,
            ECDSA_VALIDATOR,
            address(qv),
            address(mv),
            keyPtr,
            address(hotTier),
            address(registry),
            bob
        ];
        address[] memory list = new address[](touched.length);
        for (uint256 i = 0; i < touched.length; ++i) {
            list[i] = touched[i];
        }
        _cool(list);
    }

    function _ecdsa(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Kernel's ERC-1271 wrapper: EIP-712 `Kernel(bytes32 hash)` under {"Kernel", "0.3.3", chainId, account}.
    function _kernelWrapped(address acct, bytes32 hash) internal view returns (bytes32) {
        bytes32 domain =
            keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, keccak256("Kernel"), keccak256("0.3.3"), block.chainid, acct));
        return MessageHashUtils.toTypedDataHash(domain, keccak256(abi.encode(KERNEL_WRAPPER_TYPEHASH, hash)));
    }

    /// @dev ERC-1271 signature for a QuantumValidator-rooted Kernel: `0x01 ‖ validator ‖ pqSig`, where the
    ///      key signs `accountDigest(account, kernelWrappedHash)`.
    function _pq1271(address acct, bytes32 hash) internal view returns (bytes memory) {
        bytes32 digest = qv.accountDigest(acct, _kernelWrapped(acct, hash));
        return abi.encodePacked(bytes1(0x01), address(qv), _pqSig(keyPtr, digest));
    }

    /// @dev Deploys a PQ-rooted Kernel the production way: its first user operation carries `initCode`
    ///      (meta factory → Kernel factory → `initialize` with QuantumValidator as root, no guardians, so
    ///      validation-phase storage stays ERC-7562-associated), and its callData installs the hot tier
    ///      (execution phase: `HotTierExecutor.onInstall` uses TIMESTAMP, transient storage and nested
    ///      mappings, which ERC-7562 bans during validation) and pays bob 250 USDG.
    ///      `measure` cools the touched contracts first (test functions only, see `ArbOneFork._cool`).
    function _deployPqKernel(bytes32 salt, bool measure)
        internal
        returns (IKernel acct, uint256 gasUsed, uint256 calldataSize)
    {
        bytes memory init = _pqInitData(new bytes[](0));
        acct = IKernel(IKernelFactory(KERNEL_FACTORY).getAddress(init, salt));
        deal(USDG, address(acct), FUNDING);
        vm.deal(address(acct), 1 ether);

        bytes memory initCode = abi.encodePacked(
            META_FACTORY, abi.encodeCall(IFactoryStaker.deployWithFactory, (KERNEL_FACTORY, init, salt))
        );
        Execution[] memory calls = new Execution[](2);
        calls[0] = _installHotTierCall(address(acct));
        calls[1] = _usdgTransfer(bob, 250e6);
        PackedUserOperation memory op = _pqOp(address(acct), initCode, _batch(calls));
        calldataSize = _handleOpsCalldataSize(op);
        if (measure) _coolKernel(address(acct));
        gasUsed = _handleOp(ENTRYPOINT_V07, op);
    }

    // ---------------------------------------------------------------- infrastructure sanity

    function test_fork_realInfrastructure() public onlyFork {
        assertEq(IKernelFactory(KERNEL_FACTORY).implementation(), KERNEL_IMPL);
        assertTrue(IFactoryStaker(META_FACTORY).approved(KERNEL_FACTORY), "factory not approved by meta factory");
        assertEq(IKernel(KERNEL_IMPL).entrypoint(), ENTRYPOINT_V07);
        assertEq(IKernel(KERNEL_IMPL).accountId(), "kernel.advanced.v0.3.3");
        assertGt(ENTRYPOINT_V07.code.length, 0);
        assertGt(ECDSA_VALIDATOR.code.length, 0);
        assertEq(IERC20(USDG).balanceOf(address(account)), FUNDING - 250e6);
        assertEq(keccak256("Kernel(bytes32 hash)"), KERNEL_WRAPPER_TYPEHASH);
    }

    // ---------------------------------------------------------------- PQ user operations

    /// @dev One `handleOps` deploys the Kernel counterfactually, sets the PQ root, installs the hot tier
    ///      and moves USDG.
    function test_firstUserOp_deploysPqKernel_installsHotTier_movesUsdg() public onlyFork {
        uint256 bobBefore = IERC20(USDG).balanceOf(bob);
        (IKernel acct, uint256 gasUsed, uint256 size) = _deployPqKernel(bytes32(uint256(2)), true);

        assertGt(address(acct).code.length, 0);
        assertEq(address(uint160(uint256(vm.load(address(acct), ERC1967_IMPLEMENTATION_SLOT)))), KERNEL_IMPL);
        assertEq(acct.accountId(), "kernel.advanced.v0.3.3");
        assertEq(acct.rootValidator(), _vId(address(qv)));
        QuantumValidator.Config memory c = qv.configOf(address(acct));
        assertEq(c.verifier, address(mv));
        assertEq(c.keyPtr, keyPtr);
        assertTrue(acct.isModuleInstalled(MODULE_TYPE_EXECUTOR, address(hotTier), ""));
        assertTrue(hotTier.isInitialized(address(acct)));
        assertEq(IERC20(USDG).balanceOf(bob) - bobBefore, 250e6);
        assertEq(IERC20(USDG).balanceOf(address(acct)), FUNDING - 250e6);
        assertEq(IEntryPoint(ENTRYPOINT_V07).getNonce(address(acct), 0), 1);

        emit log_named_uint("gas: handleOps, deploy Kernel + PQ root + hot tier install + USDG transfer", gasUsed);
        emit log_named_uint("bytes: handleOps calldata (deploy op)", size);
    }

    function test_handleOps_pqUserOp_transfersUsdg() public onlyFork {
        uint256 bobBefore = IERC20(USDG).balanceOf(bob);
        PackedUserOperation memory op = _pqOp(address(account), "", _single(_usdgTransfer(bob, 300e6)));
        uint256 size = _handleOpsCalldataSize(op);
        _coolKernel(address(account));
        uint256 gasUsed = _handleOp(ENTRYPOINT_V07, op);

        assertEq(IERC20(USDG).balanceOf(bob) - bobBefore, 300e6);
        assertEq(IEntryPoint(ENTRYPOINT_V07).getNonce(address(account), 0), 2);
        emit log_named_uint("gas: handleOps, PQ-signed USDG transfer (mock verifier)", gasUsed);
        emit log_named_uint("bytes: handleOps calldata (mock PQ signature)", size);
        emit log_named_uint("bytes: userOp.signature (mock PQ signature)", op.signature.length);
    }

    function test_handleOps_tamperedSignature_AA24() public onlyFork {
        bytes memory err = abi.encodeWithSelector(IEntryPoint.FailedOp.selector, 0, "AA24 signature error");
        PackedUserOperation memory op = _pqOp(address(account), "", _single(_usdgTransfer(bob, 1e6)));

        bytes memory sig = op.signature;
        sig[sig.length - 1] ^= 0x01;
        op.signature = sig;
        _expectHandleOpRevert(ENTRYPOINT_V07, op, err);

        // A valid signature by a different PQ key.
        address otherPtr = ks.store(abi.encodePacked(uint8(2), keccak256("another ML-DSA-44 public key")));
        op.signature = _pqSig(otherPtr, _userOpHash(ENTRYPOINT_V07, op));
        _expectHandleOpRevert(ENTRYPOINT_V07, op, err);

        // The right key, but over another operation (different callData).
        PackedUserOperation memory other = _pqOp(address(account), "", _single(_usdgTransfer(bob, 2e6)));
        op.signature = other.signature;
        _expectHandleOpRevert(ENTRYPOINT_V07, op, err);
    }

    // ---------------------------------------------------------------- hot tier through executeFromExecutor

    function _hotCall(address target, bytes memory data) internal pure returns (HotTierExecutor.Call[] memory c) {
        c = new HotTierExecutor.Call[](1);
        c[0] = HotTierExecutor.Call(target, 0, data);
    }

    function test_hotTier_withinCap_transfersUsdg() public onlyFork {
        uint256 bobBefore = IERC20(USDG).balanceOf(bob);
        HotTierExecutor.Call[] memory calls = _hotCall(USDG, abi.encodeCall(IERC20.transfer, (bob, 60e6)));
        _coolKernel(address(account));
        vm.prank(hot);
        uint256 g = gasleft();
        hotTier.execute(address(account), calls);
        emit log_named_uint("gas: hot EOA USDG transfer via Kernel executeFromExecutor", g - gasleft());

        assertEq(IERC20(USDG).balanceOf(bob) - bobBefore, 60e6);
        assertEq(hotTier.available(address(account), USDG), HOT_CAP - 60e6);
    }

    function test_hotTier_overCap_reverts() public onlyFork {
        vm.prank(hot);
        hotTier.execute(address(account), _hotCall(USDG, abi.encodeCall(IERC20.transfer, (bob, 60e6))));

        HotTierExecutor.Call[] memory calls = _hotCall(USDG, abi.encodeCall(IERC20.transfer, (bob, 60e6)));
        vm.prank(hot);
        vm.expectRevert(abi.encodeWithSelector(HotTierExecutor.CapExceeded.selector, USDG, 60e6, 40e6));
        hotTier.execute(address(account), calls);
    }

    function test_hotTier_approve_callNotAllowed() public onlyFork {
        HotTierExecutor.Call[] memory calls = _hotCall(USDG, abi.encodeCall(IERC20.approve, (bob, 1)));
        vm.prank(hot);
        vm.expectRevert(abi.encodeWithSelector(HotTierExecutor.CallNotAllowed.selector, USDG, IERC20.approve.selector));
        hotTier.execute(address(account), calls);
    }

    /// @dev Only an installed executor reaches `executeFromExecutor`; the hot key itself cannot.
    function test_hotTier_onlyInstalledExecutor() public onlyFork {
        Execution[] memory calls = new Execution[](1);
        calls[0] = _usdgTransfer(bob, 1e6);
        vm.prank(hot);
        vm.expectRevert(IKernelErrors.InvalidExecutor.selector);
        account.executeFromExecutor(MODE_BATCH, abi.encode(calls));

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(HotTierExecutor.Unauthorized.selector);
        hotTier.execute(address(account), _hotCall(USDG, abi.encodeCall(IERC20.transfer, (bob, 1e6))));
    }

    // ---------------------------------------------------------------- ERC-1271 through Kernel

    function test_erc1271_pqSignatureThroughKernelWrapper() public onlyFork {
        (, string memory name, string memory version, uint256 chainId, address vc,,) = account.eip712Domain();
        assertEq(name, "Kernel");
        assertEq(version, "0.3.3");
        assertEq(chainId, 42161);
        assertEq(vc, address(account));

        bytes32 h = keccak256("Permit2 / Safe / order hash");
        assertEq(account.isValidSignature(h, _pq1271(address(account), h)), MAGIC);

        // Root-validator prefix (0x00) routes to the same validator.
        bytes32 digest = qv.accountDigest(address(account), _kernelWrapped(address(account), h));
        assertEq(account.isValidSignature(h, abi.encodePacked(bytes1(0x00), _pqSig(keyPtr, digest))), MAGIC);

        // Unwrapped hash, other hash, other account: rejected.
        bytes memory raw =
            abi.encodePacked(bytes1(0x01), address(qv), _pqSig(keyPtr, qv.accountDigest(address(account), h)));
        assertEq(account.isValidSignature(h, raw), INVALID);
        assertEq(account.isValidSignature(keccak256("other"), _pq1271(address(account), h)), INVALID);
        (IKernel twin,,) = _deployPqKernel(bytes32(uint256(3)), false);
        assertEq(twin.isValidSignature(h, _pq1271(address(account), h)), INVALID);
        assertEq(twin.isValidSignature(h, _pq1271(address(twin), h)), MAGIC);
    }

    // ---------------------------------------------------------------- brief's initConfig encoding

    /// @dev `initialize(..., initConfig = [installModule(2, hotTier, …)])` through the factory directly (not
    ///      through `initCode`: the executor's `onInstall` is not ERC-7562-safe during validation).
    function test_factory_initConfigInstallsHotTier() public onlyFork {
        bytes[] memory initConfig = new bytes[](1);
        initConfig[0] = _installHotTierCall(address(0)).callData;
        IKernel acct =
            IKernel(IKernelFactory(KERNEL_FACTORY).createAccount(_pqInitData(initConfig), bytes32(uint256(4))));
        assertEq(acct.rootValidator(), _vId(address(qv)));
        assertTrue(acct.isModuleInstalled(MODULE_TYPE_EXECUTOR, address(hotTier), ""));
        assertTrue(hotTier.isInitialized(address(acct)));

        deal(USDG, address(acct), FUNDING);
        vm.prank(hot);
        hotTier.execute(address(acct), _hotCall(USDG, abi.encodeCall(IERC20.transfer, (bob, 10e6))));
        assertEq(IERC20(USDG).balanceOf(address(acct)), FUNDING - 10e6);
    }

    // ---------------------------------------------------------------- upgrade in place: ECDSA root → PQ root

    /// @dev Kernel with the real ZeroDev ECDSA validator as root, created through the real factory.
    function _ecdsaKernel(bytes32 salt) internal returns (IKernel acct, address owner) {
        owner = vm.addr(ECDSA_OWNER_KEY);
        bytes memory init = abi.encodeCall(
            IKernel.initialize, (_vId(ECDSA_VALIDATOR), address(0), abi.encodePacked(owner), "", new bytes[](0))
        );
        acct = IKernel(IKernelFactory(KERNEL_FACTORY).createAccount(init, salt));
        deal(USDG, address(acct), FUNDING);
        vm.deal(address(acct), 1 ether);
        assertEq(acct.rootValidator(), _vId(ECDSA_VALIDATOR));
        assertEq(IKernelECDSAValidator(ECDSA_VALIDATOR).ecdsaValidatorStorage(address(acct)), owner);
    }

    function _ecdsaRootOp(IKernel acct, bytes memory callData) internal view returns (PackedUserOperation memory op) {
        op = _userOp(address(acct), IEntryPoint(ENTRYPOINT_V07).getNonce(address(acct), 0), "", callData);
        op.signature = _ecdsa(ECDSA_OWNER_KEY, _userOpHash(ENTRYPOINT_V07, op));
    }

    /// @dev Calls of the upgrade batch. `invalidateNonce` runs first so QuantumValidator is installed at the
    ///      new validation nonce; see `test_upgrade_invalidateNonceLast_breaksErc1271OfNewRoot`.
    function _upgradeCalls(IKernel acct, bool invalidateFirst) internal view returns (Execution[] memory calls) {
        calls = new Execution[](4);
        Execution memory invalidate = Execution(address(acct), 0, abi.encodeCall(IKernel.invalidateNonce, (2)));
        // installModule(1, …) initData: hook(20) ‖ abi.encode(validatorData, hookData, selectorData).
        bytes memory qvInit = abi.encodePacked(address(0), abi.encode(_qvInstallData(), bytes(""), bytes("")));
        Execution memory install = Execution(
            address(acct), 0, abi.encodeCall(IKernel.installModule, (MODULE_TYPE_VALIDATOR, address(qv), qvInit))
        );
        Execution memory changeRoot = Execution(
            address(acct), 0, abi.encodeCall(IKernel.changeRootValidator, (_vId(address(qv)), address(0), "", ""))
        );
        Execution memory uninstall = Execution(
            address(acct), 0, abi.encodeCall(IKernel.uninstallModule, (MODULE_TYPE_VALIDATOR, ECDSA_VALIDATOR, ""))
        );
        if (invalidateFirst) {
            (calls[0], calls[1], calls[2], calls[3]) = (invalidate, install, changeRoot, uninstall);
        } else {
            (calls[0], calls[1], calls[2], calls[3]) = (install, changeRoot, uninstall, invalidate);
        }
    }

    function test_upgradeInPlace_ecdsaRootToPqRoot() public onlyFork {
        (IKernel acct, address owner) = _ecdsaKernel(bytes32(uint256(10)));
        bytes32 h = keccak256("message signed before the upgrade");
        bytes memory ecdsaSig = _ecdsa(ECDSA_OWNER_KEY, _kernelWrapped(address(acct), h));
        bytes memory ecdsa1271 = abi.encodePacked(bytes1(0x01), ECDSA_VALIDATOR, ecdsaSig);

        // Classical baseline: ERC-1271 accepted, and the owner EOA can call `execute` directly (the ECDSA
        // validator doubles as the root hook in Kernel's `onlyEntryPointOrSelfOrRoot`).
        assertEq(acct.isValidSignature(h, ecdsa1271), MAGIC);
        vm.prank(owner);
        acct.execute(MODE_SINGLE, abi.encodePacked(USDG, uint256(0), abi.encodeCall(IERC20.transfer, (bob, 1e6))));

        // One ECDSA-signed user operation performs the whole migration.
        PackedUserOperation memory upgradeOp = _ecdsaRootOp(acct, _batch(_upgradeCalls(acct, true)));
        _coolKernel(address(acct));
        uint256 gasUsed = _handleOp(ENTRYPOINT_V07, upgradeOp);
        emit log_named_uint("gas: handleOps, ECDSA-signed upgrade batch to PQ root", gasUsed);

        assertEq(acct.rootValidator(), _vId(address(qv)));
        assertTrue(acct.isModuleInstalled(MODULE_TYPE_VALIDATOR, address(qv), ""));
        assertFalse(acct.isModuleInstalled(MODULE_TYPE_VALIDATOR, ECDSA_VALIDATOR, ""));
        assertEq(IKernelECDSAValidator(ECDSA_VALIDATOR).ecdsaValidatorStorage(address(acct)), address(0));
        assertEq(acct.validNonceFrom(), 2);
        assertEq(acct.validationConfig(_vId(address(qv))).nonce, 2);

        // ECDSA ERC-1271 is dead: the validator is uninstalled (Kernel reverts), and the root path now
        // checks the PQ key.
        vm.expectRevert(IKernelErrors.InvalidValidator.selector);
        acct.isValidSignature(h, ecdsa1271);
        assertEq(acct.isValidSignature(h, abi.encodePacked(bytes1(0x00), ecdsaSig)), INVALID);

        // ECDSA user operations fail validation: through the root (PQ) validator, and through the old
        // validator's own nonce key (revoked nonce).
        Execution memory pay = _usdgTransfer(bob, 5e6);
        _expectHandleOpRevert(
            ENTRYPOINT_V07,
            _ecdsaRootOp(acct, _single(pay)),
            abi.encodeWithSelector(IEntryPoint.FailedOp.selector, 0, "AA24 signature error")
        );
        uint192 ecdsaKey = (uint192(1) << 176) | (uint192(uint160(ECDSA_VALIDATOR)) << 16);
        PackedUserOperation memory viaOld =
            _userOp(address(acct), IEntryPoint(ENTRYPOINT_V07).getNonce(address(acct), ecdsaKey), "", _single(pay));
        viaOld.signature = _ecdsa(ECDSA_OWNER_KEY, _userOpHash(ENTRYPOINT_V07, viaOld));
        _expectHandleOpRevert(
            ENTRYPOINT_V07,
            viaOld,
            abi.encodeWithSelector(
                IEntryPoint.FailedOpWithRevert.selector,
                0,
                "AA23 reverted",
                abi.encodeWithSelector(IKernelErrors.InvalidNonce.selector)
            )
        );

        // The former owner's direct-call side door is closed.
        vm.prank(owner);
        vm.expectRevert(IKernelErrors.InvalidCaller.selector);
        acct.execute(MODE_SINGLE, abi.encodePacked(USDG, uint256(0), abi.encodeCall(IERC20.transfer, (bob, 1e6))));

        // The PQ key now controls the account: user operations and ERC-1271.
        uint256 bobBefore = IERC20(USDG).balanceOf(bob);
        _handleOp(ENTRYPOINT_V07, _pqOp(address(acct), "", _single(pay)));
        assertEq(IERC20(USDG).balanceOf(bob) - bobBefore, 5e6);
        assertEq(acct.isValidSignature(h, _pq1271(address(acct), h)), MAGIC);
    }

    /// @dev Pins a Kernel v3.3 ordering pitfall. `installModule` gives QuantumValidator the current validation
    ///      nonce (1, the same as the ECDSA validator), and `_verifySignature` applies the `validNonceFrom`
    ///      check to the root validator too. Invalidating nonce 2 *after* the install therefore leaves user
    ///      operations working (the root path skips the check in `validateUserOp`) but makes every ERC-1271
    ///      check of the new root revert `InvalidNonce`. The upgrade batch must invalidate first.
    function test_upgrade_invalidateNonceLast_breaksErc1271OfNewRoot() public onlyFork {
        (IKernel acct,) = _ecdsaKernel(bytes32(uint256(11)));
        _handleOp(ENTRYPOINT_V07, _ecdsaRootOp(acct, _batch(_upgradeCalls(acct, false))));

        assertEq(acct.rootValidator(), _vId(address(qv)));
        assertEq(acct.validationConfig(_vId(address(qv))).nonce, 1);
        assertEq(acct.validNonceFrom(), 2);

        uint256 bobBefore = IERC20(USDG).balanceOf(bob);
        _handleOp(ENTRYPOINT_V07, _pqOp(address(acct), "", _single(_usdgTransfer(bob, 1e6))));
        assertEq(IERC20(USDG).balanceOf(bob) - bobBefore, 1e6);

        bytes32 h = keccak256("message");
        bytes memory sig = _pq1271(address(acct), h);
        vm.expectRevert(IKernelErrors.InvalidNonce.selector);
        acct.isValidSignature(h, sig);
    }
}
