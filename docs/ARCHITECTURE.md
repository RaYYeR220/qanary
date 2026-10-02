# Qanary architecture

This page describes the contracts and off-chain pieces of Qanary, the exact byte formats they exchange, the trust model of each module, how validation stays inside the ERC-4337 rules, and how an existing account moves to a post-quantum root. Every format here is what the code at this commit does; the tests named in each section pin it.

## Components and their roles

Qanary splits into stateless verifiers, account modules that hold per-account state, and an SDK that signs for them:

| Component | Path | Kind | Role |
|---|---|---|---|
| `mldsa44-verifier`, `mldsa65-verifier` | `contracts/stylus/` | Stylus program | ERC-7913 verifier for FIPS 204 ML-DSA-44 and ML-DSA-65 (pure, empty context) |
| `falcon512-verifier` | `contracts/stylus/` | Stylus program | ERC-7913 verifier for Falcon-512 round 3 and FN-DSA-512 (`fn-dsa` 0.4.0 draft encoding) |
| `ladder-verifier` | `contracts/stylus/` | Stylus program | ECDSA verification over secp160r1, P-192 and P-224 for the tripwire |
| `qanary-pq`, `qanary-curves` | `crates/` | Rust `no_std` | Verification cores the programs wrap; they never panic on attacker input |
| `KeyStore` | `contracts/evm/src/` | Solidity | Content-addressed store of public key blobs as contract code |
| `QuantumValidator` | `contracts/evm/src/` | ERC-7579 validator (type 1) | Post-quantum root key per account, rotation, guardian recovery, ERC-1271 |
| `HotTierExecutor` | `contracts/evm/src/` | ERC-7579 executor (type 2) and Safe module | Classical hot key with allowlist, per-asset leaky-bucket caps and threat levels |
| `QuantumCanaryRegistry`, `DrillRegistryFactory` | `contracts/evm/src/canary/` | Solidity | Ownerless tripwire and permissionless drill registries |
| `PQSafeOwner`, `PQSafeOwnerFactory` | `contracts/evm/src/safe/` | Solidity | ERC-1271 contract owner that lets a Safe count a post-quantum signature |
| `QanaryAccount`, `QanaryMultisigAccount`, factory | `contracts/evm/src/oz/` | OpenZeppelin 5.7 `Account` | Accounts whose signer is an ERC-7913 `verifier ‖ key` directly, no module |
| `SolidityMLDSA44Verifier` and helpers | `contracts/evm/src/fallback/` | Solidity | The same ERC-7913 interface for chains without Stylus activation |
| `@qanary/sdk` | `packages/sdk/` | TypeScript (viem, ZeroDev SDK) | Signers, key storage, Kernel accounts, hot tier, canary and exposure clients |

Kernel v3.3, EntryPoint v0.7 (Kernel) and v0.9 (OpenZeppelin accounts), Safe 1.3.0 and 1.4.1 are the canonical deployments; Qanary deploys none of them.

## Data formats

Each format below fixes the exact bytes a signer produces and a contract checks, so independent implementations interoperate.

### Scheme ids and sizes

The first byte of every key blob names the scheme. Each verifier accepts only its own ids and reverts with `UnsupportedScheme(id)` otherwise:

| Id | Scheme | Verifier | Public key | Signature |
|---:|---|---|---:|---:|
| 1 | FN-DSA-512 as `fn-dsa-vrfy` 0.4.0 implements the FIPS 206 draft (empty context, raw message) | Falcon | 897 B | 666 B |
| 2 | ML-DSA-44, FIPS 204, pure, empty context | ML-DSA-44 | 1,312 B | 2,420 B |
| 3 | ML-DSA-65, FIPS 204, pure, empty context | ML-DSA-65 | 1,952 B | 3,309 B |
| 4 | Falcon-512, NIST round 3, detached signature with header `0x39`: compressed (variable length, at most 809 B) or the same bytes zero-padded to 666 B | Falcon | 897 B | 666 B padded |

The 32-byte `hash` argument is the message: verifiers do not hash it again. ML-DSA with an empty context over that message is what AWS KMS `ML_DSA_SHAKE_256` with `MessageType: RAW` and `@noble/post-quantum` `ml_dsa44.sign(msg, sk)` produce.

### ERC-7913 key bytes and results

Every post-quantum verifier, Stylus or Solidity, implements one call: `verify(bytes key, bytes32 hash, bytes signature) view returns (bytes4)`. The `key` takes one of two forms:

- **Pointer**: exactly 20 bytes, the address of a contract whose code is `0x00 ‖ scheme ‖ publicKey`. The verifier reads that code. Code that is empty or does not start with `0x00` (an EOA, an EIP-7702 delegation, a Stylus program) reverts with `InvalidKey()`
- **Inline**: any other length, `scheme ‖ publicKey`

A valid signature returns `0x024ad318`, the ERC-7913 magic value. A well-formed signature that does not verify returns `0xffffffff`. Malformed input reverts with `InvalidKeyLength(expected, got)`, `InvalidSignatureLength(expected, got)`, `InvalidKey()` or `UnsupportedScheme(id)`; the Solidity fallback raises them in the same order (`test_errorOrder_matchesStylus`). One exception: a round-3 Falcon signature of the wrong length returns `0xffffffff`, because that encoding has no fixed length. `schemes()` lists the accepted ids.

The ladder verifier has its own ABI: `verify(uint8 curve, bytes32 qx, bytes32 qy, bytes32 digest, bytes32 r, bytes32 s) view returns (bool)`, with curve 1 = secp160r1, 2 = P-192 and 3 = P-224 and coordinates left-padded to 32 bytes. It follows SEC1 section 4.1.4: `r` and `s` in `[1, n − 1]`, the public key on the curve, the digest truncated to the bit length of `n`.

### KeyStore pointers

`KeyStore.store(blob)` deploys `blob = scheme ‖ publicKey` as contract code and returns its address, so a 1,312-byte key costs a verifier one code read instead of 1,313 bytes of calldata. The address is a CREATE2 address with the KeyStore as deployer:

```text
salt     = keccak256(blob)
initCode = 0x63 ‖ uint32(len(blob) + 1) ‖ 0x80600E6000396000F3 ‖ 0x00 ‖ blob
pointer  = keccak256(0xff ‖ keyStore ‖ salt ‖ keccak256(initCode))[12:]
code     = 0x00 ‖ blob
```

The leading `0x00` (STOP) makes the code unexecutable and avoids the EIP-3541 `0xEF` prefix. `store` is idempotent and permissionless: anyone who stores the same blob gets the same pointer, and nobody can change its contents. The SDK computes the same address offline (`predictKeyPointer`).

### User operation signatures

`QuantumValidator.validateUserOp` passes the EntryPoint’s `userOpHash` unchanged as the message, so the post-quantum key signs `userOpHash` directly and `userOp.signature` is the raw signature (2,420 B for ML-DSA-44). The hash already commits to the chain, the EntryPoint and every gas field.

### ERC-1271 signatures and the Kernel double wrap

The root key never signs an application hash as is. It signs `accountDigest(account, hash)`, an EIP-712 digest that binds the signature to one account:

```text
domain = { name: "QanaryValidator", version: "1",
           chainId, verifyingContract: QuantumValidator }
type   = AccountMessage(address account, bytes32 hash)
```

Kernel v3.3 wraps the application hash once before it reaches the validator: `kernelHash` is the EIP-712 digest of `Kernel(bytes32 hash)` under the account’s own domain `{ name: "Kernel", version: "0.3.3", chainId, verifyingContract: account }`. The key therefore signs `accountDigest(account, kernelHash)`, and the signature passed to `account.isValidSignature(hash, sig)` is `0x01 ‖ QuantumValidator ‖ pqSignature` (or `0x00 ‖ pqSignature` to route to the root). `kernelWrappedHash`, `accountDigest` and `kernelErc1271Signature` in the SDK build each step; `test_erc1271_pqSignatureThroughKernelWrapper` checks them against the real Kernel on an Arbitrum One fork.

### Recovery approvals

Guardians approve a replacement key by signing an EIP-712 digest under the validator’s domain:

```text
Recovery(address account, address verifier, address keyPtr, uint256 nonce)
```

The nonce is per account and only grows: every proposal, rotation, guardian change, cancellation, executed recovery and uninstall increments it, so approvals collected but not submitted die at the next change.

### Hot operations

A hot key that does not send the transaction itself signs an EIP-712 `HotOp` under the domain `{ name: "QanaryHotTier", version: "1", chainId, verifyingContract: HotTierExecutor }`:

```text
HotOp(address account, bytes32 callsHash, uint256 nonce, uint256 deadline)
callsHash = keccak256(abi.encode(calls))   // Call { target, value, data }[]
```

A secp256k1 hot key sends a 65-byte ECDSA signature. A passkey sends `abi.encode(WebAuthn.WebAuthnAuth)` whose challenge is the digest, with user presence and user verification required. Any relayer may submit `executeWithSig`; a secp256k1 hot EOA can also call `execute` directly.

### Canary claims

The registry computes the claim message itself and never accepts a digest from the claimant, because plain ECDSA over a caller-chosen digest is forgeable for any key:

```text
claimMessage = keccak256(abi.encode(keccak256("QANARY_CLAIM_V1"),
                                    chainid, registry, target, claimant))
```

The proof is `abi.encode(r, s)` for targets 0 (L1), 1 (L2), 2 (L3) and 4 (R1), and `abi.encode(uint256 v, r, s)` with `v` in {27, 28} for target 3 (K1). K1 and R1 reject high-s signatures. A claim on L1 or L2 raises `ladderLevel` to 1 or 2; L3, K1 and R1 raise it to 3; K1 and R1 also set `familyBroken` for family 0 (secp256k1) or 1 (P-256). Claims never lower anything.

The guarded keys are nothing-up-my-sleeve points. For each curve, `x = SHA-256("QANARY-NUMS-V1/" ‖ name ‖ uint32_be(ctr)) mod p` for the first counter where `x³ + ax + b` is a square, with the even `y`. `python scripts/nums.py` regenerates `deployments/canary-targets.json` and `CanaryTargets.sol` from that rule, and a non-drill registry’s constructor rejects any other keys. Drill registries guard keys whose private keys are `SHA-256("QANARY-DRILL-V1/" ‖ name) mod n`, published so anyone can rehearse a claim.

### Safe owner signatures

A Safe owner slot holds a `PQSafeOwner` contract. In a Safe signature blob each such owner is a contract signature: `r` = owner address, `s` = offset of the dynamic part, `v` = 0, and the dynamic part is the post-quantum signature. Safe 1.3.0 and 1.4.1 call the legacy `isValidSignature(bytes data, bytes sig)`, and `PQSafeOwner` verifies `keccak256(data)`, which for `execTransaction` is the Safe transaction hash. The bytes32 form returns `0x1626ba7e`; the legacy form returns `0x20c13b0b`.

### Off-chain keys

The SDK derives a post-quantum key from a BIP-39 mnemonic (no passphrase) as `seed32 = HKDF-SHA256(ikm = BIP-39 seed, salt = empty, info = "qanary/<scheme>/v1/<index>", 32 bytes)`, then runs the `@noble/post-quantum` key generation for the scheme on `seed32`. An AWS KMS key is an `ML_DSA_44` / `SIGN_VERIFY` key; its 1,312-byte public key is the BIT STRING of the SubjectPublicKeyInfo that `GetPublicKey` returns.

## Trust model

No contract in Qanary has an owner, an admin or an upgrade path. Every account-scoped setter acts on `msg.sender`, the account itself, so a configuration changes only when the account’s own authority (its post-quantum root, or its owners on a Safe) executes the call.

### Stylus verifiers and the verification cores

The verifiers hold no storage and call no other contract; the only state they read is a key pointer’s code. They trust nothing in their input: every length is checked before decoding, the cores map every malformed input to an error, and the proptest fuzzers in `crates/*/tests/fuzz.rs` check for panics and false accepts. Each program accepts only its own scheme ids, read from the pointer’s own scheme byte when a pointer is used. The ladder verifier returns `false` for any invalid point, range or signature; only an unknown curve id reverts.

### KeyStore

The KeyStore has no admin and no state besides the deployed blobs. A pointer is derived from the blob’s hash with the KeyStore as CREATE2 deployer, so a front-run `store` deploys identical code and nobody can substitute a different key at a pointer.

### QuantumValidator

`QuantumValidator` stores one `(verifier, keyPtr)` pair per account and trusts that verifier completely. It rejects a verifier without code (which would brick the account) and any address at or below `0xffff`, the precompile range: the identity precompile at `0x04` echoes its calldata, whose first word is the magic value, and would accept every signature. `validateUserOp` and the ERC-1271 path never revert on a bad signature, a reverting verifier or an uninstalled account; they return failure.

Only the account can rotate its key (`rotateKey`) or replace its guardians (`setGuardians`). Guardians are optional ERC-7913 signers (`verifier ‖ key`, 1 to 16 of them, unique) with a threshold and a delay of at least one hour. Anyone may submit `proposeRecovery` with enough guardian approvals; the account can `cancelRecovery` until the delay passes, after which anyone may `executeRecovery`. The validator does not check that guardian verifiers are post-quantum: a guardian set of passkeys or ECDSA keys is a classical path to the root, so a cold account keeps its root post-quantum only with post-quantum guardians and a delay long enough to notice and cancel.

### HotTierExecutor

This is the executor’s own trust model, from its NatSpec:

> Every account-scoped setter acts on `msg.sender` (the account, authorised by its post-quantum key); there are no owners or admins. Everything fails closed: an unconfigured account, a reverting registry or a reverting `balanceOf` on a tracked asset reverts the whole operation. Outflows are the net decrease of each tracked asset’s balance across the batch; assets that are not tracked can only leave through explicitly allowlisted calls.
>
> Trust model. Hard denials that no configuration can lift: calls to the account itself, to this executor or to `address(0)` (OZ ERC-7579 accounts treat target 0 as a self-call); calls to the account’s installed modules (ERC-7579: validators, executors, hooks, and a fallback handler registered for the selector being called; Safe: enabled modules), whose admin functions act on `msg.sender == account`; approval-class selectors (`approve`, `increaseAllowance`, `setApprovalForAll`, Permit2 `approve`, EIP-2612 `permit`), which would let a spender pull funds later, outside the executor; and empty calldata without value. Under these rules the hot key can move at most `cap * bps / 10000` plus one window of refill of each tracked asset per window. The bound does NOT hold when:
>
> - an allowlisted call converts an untracked position or credit into a tracked asset (vault or LP withdrawals, borrows, flash-style inflows): the tracked inflow masks a tracked outflow while the untracked side is drained. Track every asset an allowlisted call touches;
> - a tracked token’s `balanceOf` can be inflated or manipulated within the batch (rebasing or hook tokens, a malicious token);
> - an allowlisted target exposes admin functions keyed on `msg.sender == account` on a contract that is not a detectable module: a Safe’s fallback handler or guard, a Safe7579 adapter seen through the ERC-7579 interface, a fallback handler called with a selector other than the one it is registered for, an external registry or position manager.
>
> Safe: the native `disableModule` does not call `onUninstall`, so the configuration survives and comes back on a later re-enable. Batch `executor.onUninstall("")` with `disableModule`.

Module detection asks the account’s own `isModuleInstalled`. Kernel v3.3 answers only for module types 1 to 3, so on Kernel a hook is not detected by type: keep hook addresses off the allowlist. The selector denylist covers the five approval selectors above; other approval-style functions (DAI and Permit2 `permit`, ERC-777 operators, ERC-6909 operators, ERC-1363 `approveAndCall`) are blocked only because nothing allowlists them by default, so the root must not allowlist them. Without allowlist entries the hot key can only `transfer` tracked ERC-20 tokens and send native value with empty calldata, and both count against the caps. The invariant suite (`HotTierExecutorInvariantTest`) checks the outflow bound over random sequences of transfers, level changes and time warps.

`configure` replaces the whole configuration and refills every bucket. After a hot-key compromise, rotate the hot key with `setHotSigner` or uninstall the executor; lowering caps with `configure` alone hands the same key a fresh cap.

### QuantumCanaryRegistry

The registry has no owner and no way to lower a level or un-claim a target. Claims are deduplicated by target, not by signature bytes. Every state change and event is final before any payout: a token transfer that fails or an ETH transfer the claimant rejects is credited and pulled later with `withdrawOwed`, so neither a token issuer nor a reverting claimant can veto the signal. The ladder verifier address is immutable. A non-drill registry only accepts the NUMS keys; a drill registry (`isDrill() == true`) guards published keys and must never be the registry a production hot tier follows, so integrators pin the canonical registry address.

### PQSafeOwner

A `PQSafeOwner` is immutable `(verifier, keyPtr)` with no admin, and the factory derives its address from that pair. It verifies the hash it is given and does not bind it to the calling Safe. Safe’s `execTransaction` path is still Safe-bound, because the transaction hash commits to the Safe’s domain and chain. Through Safe 1.3.0’s ERC-1271 fallback handler the owner receives the raw application message, so a message signature by a post-quantum owner of two Safe 1.3.0 accounts is valid for both: give each Safe its own owner key, or use Safe 1.4.1, whose handler passes the Safe-bound message.

### OpenZeppelin accounts

`QanaryAccount` and `QanaryMultisigAccount` are OpenZeppelin 5.7 `Account` clones whose signer is an ERC-7913 `verifier ‖ keyPtr` (weighted set for the multisig). Implementations are locked, the factory creates and initializes a clone in one call, and the predicted address commits to the full signer configuration. ERC-1271 accepts only ERC-7739 nested signatures. ERC-7821 `execute` is restricted to the EntryPoint v0.9 and the account itself.

### Solidity ML-DSA-44 fallback

The fallback adapter trusts the core and the expanded-key store it was deployed with. Both check the Keccak-f[1600] helper’s code hash (`0x4afb4435…817b`) in their constructors; the core and store are not pinned by code hash themselves, so a verifier deployed with a rogue store would be forgeable while presenting the same ABI. Integrators use the addresses recorded in `deployments/arbitrum-one.json`. Expanded keys are computed on-chain from the raw 1,312-byte key and deployed at a CREATE2 address only the store can create, so the expansion is bound to the key. The core is vendored from Fireblocks at commit `cca262b` with nine profiling `GAS` reads replaced by `0` ([vendor README](../contracts/evm/src/fallback/vendor/README.md)); its authors describe it as unaudited research code.

## ERC-4337 validation rules (ERC-7562)

Qanary keeps every user-operation validation path inside the ERC-7562 rules that public bundlers enforce:

- **Associated storage only**: `validateUserOp` reads `_config[msg.sender]`, a mapping slot keyed by the account. Recovery and guardian state live in separate mappings that validation never touches
- **No banned opcodes in verifiers**: the Stylus verifiers read no storage and no environment. The Solidity fallback’s call tree (adapter, core, helper) contains no `GAS` without an immediately following call, no block or environment opcodes, no `CREATE`/`CREATE2`, no `SELFDESTRUCT` and no storage or transient-storage access. `test_erc7562_verifyPathHasNoBannedOpcodes` scans the deployed bytecode, and the same scan finds the nine offending opcodes in the unpatched upstream core
- **Code reads only from deployed code**: a key pointer is a contract with code, so reading it during validation is allowed
- **Guardians after deployment**: an account deployed through `initCode` installs `QuantumValidator` without guardians, because the guardian list is a dynamic `bytes[]` whose storage is not associated with the account. Set guardians with `setGuardians` in a later user operation’s execution phase (`setGuardiansCall` in the SDK)
- **Hot tier in the execution phase**: `HotTierExecutor.onInstall` reads `block.timestamp` and writes storage not associated with the account, so `createQanaryAccount` appends `installModule(2, executor, …)` to the first user operation’s call data instead of `initCode`. `hotInstall: 'initCode'` exists for self-bundled `handleOps` only
- **Gas**: Stylus verification fits in a 500k validation budget (35k to 166k gas cached, 52k to 184k uncached). The Solidity fallback needs about 1.25M gas of verification, so its user operations set `verificationGasLimit` accordingly

## Upgrade in place

An existing Kernel v3.3 account with an ECDSA root moves to a post-quantum root in one user operation signed by the old ECDSA key. The batch must invalidate the nonce first:

```solidity
account.invalidateNonce(currentNonce + 1);
account.installModule(1, quantumValidator, abi.encodePacked(
    address(0), abi.encode(installData, bytes(""), bytes(""))));
account.changeRootValidator(
    bytes21(abi.encodePacked(bytes1(0x01), quantumValidator)),
    address(0), "", "");
account.uninstallModule(1, ecdsaValidator, "");
```

The four calls run as one batch of self-calls; `installData` is `abi.encode(QuantumValidator.InstallData)`, and the 21-byte value is Kernel’s validation id for a validator. `installModule` gives the new validator the account’s current validation nonce. Kernel’s ERC-1271 path checks `validNonceFrom` for the root, so if the nonce is invalidated last the new root’s ERC-1271 signatures revert with `InvalidNonce`. Invalidating first gives the new validator the new nonce. Afterwards the ECDSA validator is gone, its stored owner is wiped, ECDSA user operations fail with `AA24`, the old owner can no longer call `execute` directly, and old ECDSA ERC-1271 signatures are rejected. `test_upgradeInPlace_ecdsaRootToPqRoot` proves each of these on the real Kernel deployment on an Arbitrum One fork, and `test_upgrade_invalidateNonceLast_breaksErc1271OfNewRoot` pins the failure of the other order.

A Safe moves owner by owner with `swapOwner(prev, eoaOwner, pqSafeOwner)` and keeps its threshold. An EOA moves by sending its assets and revoking its approvals in one batch to a new account; EIP-7702 can carry that batch, but the EOA’s ECDSA key stays valid afterwards.

## Deployment topology and program lifecycle

ApeChain (chain 33139), an Arbitrum Orbit L3 settling to Arbitrum One, runs the Stylus verifiers and the full module stack. Arbitrum One runs the same modules with the Solidity ML-DSA-44 verifier, because new Stylus activations are paused there since 2 October 2026. An Arbitrum One account switches to the Stylus verifier with `rotateKey(stylusVerifier, keyPtr)` once activations resume; the pointer stays the same, because both verifiers read the same `0x00 ‖ 0x02 ‖ pk` code. Until then the Arbitrum One registry cannot verify ladder claims (L1 to L3), while K1 and R1 use `ecrecover` and the P-256 precompile and work.

A Stylus activation lasts 365 days. `ArbWasm.programTimeLeft(address)` shows what is left, and `codehashKeepalive` renews it once 31 days have passed since the last activation or keepalive. An expired verifier stops validating every account configured with it until someone reactivates it, and reactivation is subject to the same activation pause, so every verifier needs a monitored keepalive. Where a chain has a Stylus cache manager, a cached program saves its initialization cost on every call (about 16k to 18k gas); ApeChain has none, so its programs run uncached. [docs/DEPLOYING.md](DEPLOYING.md) has the deployment, verification and keepalive commands.
