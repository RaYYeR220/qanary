// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {GnosisSafe} from "./vendor/safe130/GnosisSafe.sol";
import {GnosisSafeProxyFactory} from "./vendor/safe130/proxies/GnosisSafeProxyFactory.sol";
import {CompatibilityFallbackHandler} from "./vendor/safe130/handler/CompatibilityFallbackHandler.sol";
import {Enum} from "./vendor/safe130/common/Enum.sol";
import {PQSafeOwner} from "../src/safe/PQSafeOwner.sol";
import {PQSafeOwnerFactory} from "../src/safe/PQSafeOwnerFactory.sol";
import {KeyStore} from "../src/KeyStore.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {TestToken} from "./mocks/TestToken.sol";
import {SafeSig} from "./helpers/SafeSig.sol";

/// @notice Minimal model of Permit2 `AllowanceTransfer.permit`: like the real one, the signed
///         `PermitSingle` does not contain the owner; the owner is only the address whose ERC-1271
///         `isValidSignature` is asked.
contract MiniPermit2 {
    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("PermitSingle(address token,uint160 amount,uint48 nonce,address spender,uint256 sigDeadline)");
    mapping(address owner => mapping(address token => mapping(address spender => uint256))) public allowance;
    mapping(address owner => mapping(address token => mapping(address spender => uint48))) public nonces;

    function digest(address token, uint160 amount, uint48 nonce, address spender, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)"),
                keccak256("Permit2"),
                block.chainid,
                address(this)
            )
        );
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, token, amount, nonce, spender, deadline));
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function permit(
        address owner,
        address token,
        uint160 amount,
        uint48 nonce,
        address spender,
        uint256 deadline,
        bytes calldata sig
    ) external {
        require(block.timestamp <= deadline, "expired");
        require(nonce == nonces[owner][token][spender], "nonce");
        bytes32 d = digest(token, amount, nonce, spender, deadline);
        require(IERC1271(owner).isValidSignature(d, sig) == IERC1271.isValidSignature.selector, "bad sig");
        nonces[owner][token][spender] = nonce + 1;
        allowance[owner][token][spender] = amount;
    }

    function transferFrom(address from, address to, uint160 amount, address token) external {
        uint256 a = allowance[from][token][msg.sender];
        require(a >= amount, "allowance");
        allowance[from][token][msg.sender] = a - amount;
        require(IERC20(token).transferFrom(from, to, amount), "transfer");
    }
}

/// @title PQSafeOwnerSafe130Test
/// @notice `PQSafeOwner` on Safe 1.3.0 (vendored, `test/vendor/safe130`), the version of the Arbitrum
///         Security Council Safes. Its `CompatibilityFallbackHandler` forwards the raw application
///         message (`abi.encode(dataHash)`) to contract owners, not a Safe-bound message, and one
///         `PQSafeOwner` exists per key. An owner signature must therefore carry the Safe itself, or an
///         approval collected for one Safe would be a valid approval of every Safe the key owns.
contract PQSafeOwnerSafe130Test is Test {
    bytes4 internal constant MAGIC = 0x1626ba7e;

    MockVerifier internal mv;
    KeyStore internal ks;
    PQSafeOwner internal pqOwner;
    address internal keyPtr;

    GnosisSafe internal singleton;
    GnosisSafeProxyFactory internal proxyFactory;
    CompatibilityFallbackHandler internal handler;

    TestToken internal token;
    MiniPermit2 internal permit2;
    address internal mallory = makeAddr("mallory"); // a counterparty of Safe A

    function setUp() public {
        mv = new MockVerifier();
        ks = new KeyStore();
        keyPtr = ks.store(abi.encodePacked(uint8(2), keccak256("alice ML-DSA-44 public key")));
        pqOwner = new PQSafeOwnerFactory().deploy(address(mv), keyPtr);
        singleton = new GnosisSafe();
        proxyFactory = new GnosisSafeProxyFactory();
        handler = new CompatibilityFallbackHandler();
        token = new TestToken("USD", "USD", 6);
        permit2 = new MiniPermit2();
    }

    // ---------------------------------------------------------------- helpers

    function _safe(address owner, uint256 salt) internal returns (GnosisSafe s) {
        address[] memory owners = new address[](1);
        owners[0] = owner;
        bytes memory init = abi.encodeCall(
            GnosisSafe.setup, (owners, 1, address(0), "", address(handler), address(0), 0, payable(address(0)))
        );
        s = GnosisSafe(payable(address(proxyFactory.createProxyWithNonce(address(singleton), init, salt))));
    }

    /// @dev `MockVerifier` signature of the key at `keyPtr` over `h`.
    function _pq(bytes32 h) internal view returns (bytes memory) {
        return abi.encode(abi.encodePacked(keyPtr), h);
    }

    /// @dev The Safe signature blob carrying the PQ owner's approval of `h` for `safe`.
    function _ownerApproval(GnosisSafe safe, bytes32 h) internal view returns (bytes memory) {
        address[] memory o = new address[](1);
        o[0] = address(pqOwner);
        bytes[] memory s = new bytes[](1);
        s[0] = _pq(pqOwner.safeMessageDigest(address(safe), h));
        return SafeSig.contractSignatures(o, s);
    }

    /// @dev The owner's approval of the ERC-1271 check of `appHash` on `safe`: Safe 1.3.0 hands the
    ///      owner `data = abi.encode(appHash)`, so the owner signs `keccak256(data)` bound to `safe`.
    function _erc1271Approval(GnosisSafe safe, bytes32 appHash) internal view returns (bytes memory) {
        return _ownerApproval(safe, keccak256(abi.encode(appHash)));
    }

    function _txHash(GnosisSafe safe, address to, uint256 value, bytes memory data) internal view returns (bytes32) {
        return
            safe.getTransactionHash(to, value, data, Enum.Operation.Call, 0, 0, 0, address(0), address(0), safe.nonce());
    }

    function _exec(GnosisSafe safe, address to, uint256 value, bytes memory data) internal returns (bool) {
        bytes memory sigs = _ownerApproval(safe, _txHash(safe, to, value, data));
        return
            safe.execTransaction(to, value, data, Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), sigs);
    }

    // ---------------------------------------------------------------- tests

    function test_safe130_version() public view {
        assertEq(singleton.VERSION(), "1.3.0");
    }

    /// @dev The owner signature for Safe A is not an ERC-1271 signature of Safe B.
    function test_safe130_signatureForSafeA_isInvalidOnSafeB() public {
        GnosisSafe safeA = _safe(address(pqOwner), 1);
        GnosisSafe safeB = _safe(address(pqOwner), 2);
        bytes32 d = keccak256("app digest that does not contain the owner (Permit2 PermitSingle, CoW order)");
        bytes memory sigForA = _erc1271Approval(safeA, d);
        assertEq(IERC1271(address(safeA)).isValidSignature(d, sigForA), MAGIC);
        vm.expectRevert(bytes("GS024"));
        IERC1271(address(safeB)).isValidSignature(d, sigForA);
    }

    /// @dev The cross-Safe drain: a Permit2 approval signed for Safe A, replayed on Safe B (same PQ
    ///      owner, Permit2 already approved), is rejected and Safe B keeps its funds.
    function test_safe130_permitSignedForSafeA_cannotDrainSafeB() public {
        GnosisSafe safeA = _safe(address(pqOwner), 1);
        GnosisSafe safeB = _safe(address(pqOwner), 2);
        token.mint(address(safeB), 1_000_000e6);
        assertTrue(
            _exec(safeB, address(token), 0, abi.encodeCall(IERC20.approve, (address(permit2), type(uint256).max)))
        );

        uint256 deadline = block.timestamp + 1 days;
        bytes32 d = permit2.digest(address(token), 1_000_000e6, 0, mallory, deadline);
        bytes memory sigForA = _erc1271Approval(safeA, d);

        // the approval works where it was meant to
        vm.prank(mallory);
        permit2.permit(address(safeA), address(token), 1_000_000e6, 0, mallory, deadline, sigForA);
        assertEq(permit2.allowance(address(safeA), address(token), mallory), 1_000_000e6);

        // and nowhere else
        vm.prank(mallory);
        vm.expectRevert(bytes("GS024"));
        permit2.permit(address(safeB), address(token), 1_000_000e6, 0, mallory, deadline, sigForA);
        vm.prank(mallory);
        vm.expectRevert(bytes("allowance"));
        permit2.transferFrom(address(safeB), mallory, 1_000_000e6, address(token));
        assertEq(token.balanceOf(address(safeB)), 1_000_000e6);
        assertEq(token.balanceOf(mallory), 0);
    }

    /// @dev An approval made the old way (over the raw `keccak256(data)`, nothing Safe-specific) is
    ///      rejected by every Safe, including the one it was made for.
    function test_safe130_unboundSignature_rejected() public {
        GnosisSafe safeA = _safe(address(pqOwner), 1);
        bytes32 d = keccak256("app digest");
        address[] memory o = new address[](1);
        o[0] = address(pqOwner);
        bytes[] memory s = new bytes[](1);
        s[0] = _pq(keccak256(abi.encode(d)));
        bytes memory unbound = SafeSig.contractSignatures(o, s);
        vm.expectRevert(bytes("GS024"));
        IERC1271(address(safeA)).isValidSignature(d, unbound);
    }

    /// @dev Safe transactions keep working: the owner signs the Safe transaction hash bound to the Safe,
    ///      and a transaction signature for Safe A does not execute on Safe B at the same nonce.
    function test_safe130_execTransaction_works_andIsSafeBound() public {
        GnosisSafe safeA = _safe(address(pqOwner), 1);
        GnosisSafe safeB = _safe(address(pqOwner), 2);
        vm.deal(address(safeA), 1 ether);
        vm.deal(address(safeB), 1 ether);
        assertTrue(_exec(safeA, mallory, 1 wei, ""));
        assertEq(mallory.balance, 1 wei);

        bytes memory sigsA = _ownerApproval(safeA, _txHash(safeA, mallory, 1 wei, ""));
        vm.expectRevert(bytes("GS024"));
        safeB.execTransaction(mallory, 1 wei, "", Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), sigsA);
    }

    /// @dev For comparison: an ECDSA owner on Safe 1.3.0 signs the Safe-bound message hash, so its
    ///      approval for Safe A is useless on Safe B. The PQ owner now has the same property.
    function test_safe130_eoaOwner_isNotReplayable() public {
        (address eoa, uint256 pk) = makeAddrAndKey("eoa-owner");
        GnosisSafe safeA = _safe(eoa, 1);
        GnosisSafe safeB = _safe(eoa, 2);
        bytes32 d = keccak256("some app digest");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, handler.getMessageHashForSafe(safeA, abi.encode(d)));
        bytes memory sigForA = abi.encodePacked(r, s, v);
        assertEq(IERC1271(address(safeA)).isValidSignature(d, sigForA), MAGIC);
        vm.expectRevert(bytes("GS026"));
        IERC1271(address(safeB)).isValidSignature(d, sigForA);
    }
}
