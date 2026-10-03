# Security

This page states what Qanary protects, against whom, which guarantees hold and under which conditions, how the code was reviewed, and the limits you need to know before you put funds in an account. Qanary has not had an external audit. The [internal audit](#internal-pre-deployment-audit) section at the end lists the findings of the internal pre-deployment audit and how each was resolved.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub’s private vulnerability reporting on this repository (**Security** › **Report a vulnerability**). Do not open a public issue for a vulnerability. Include the affected contract or crate, the commit, and a proof of concept if you have one.

## What the review covers

The review and the guarantees below cover the code this repository ships:

- **In scope**: the Stylus programs (`contracts/stylus/*`), the verification cores (`crates/qanary-pq`, `crates/qanary-curves`), the Solidity contracts in `contracts/evm/src` including the fallback adapter, key store and the patch to the vendored core, and the signing and encoding code in `packages/sdk`
- **Out of scope**: Kernel, Safe, OpenZeppelin Contracts, the ERC-4337 EntryPoint, the internals of the vendored Fireblocks core beyond Qanary’s patch, the Arbitrum and ApeChain protocols, and the hosting of the web app

## Threat model

Qanary protects four assets: the cold funds behind the post-quantum root, the hot tier’s bucket, each account’s configuration, and the tripwire’s signal and bounties. The adversaries it plans for:

- **Classical key thief**: holds a stolen hot key or guardian key
- **Quantum adversary**: derives secp256k1 or P-256 private keys from public keys already on-chain
- **Malicious bundler or relayer**: reorders, front-runs, censors or replays operations
- **Front-runner**: copies permissionless calls such as canary claims, key storage or recovery proposals
- **Malformed-input attacker**: sends crafted keys and signatures to the verifiers to crash them or get a false accept
- **Misconfiguration**: an account follows a drill registry, allowlists a dangerous target, or points at a verifier that cannot verify

## Guarantees and their conditions

These hold for the code at this commit, under the conditions stated with each:

- **No classical path to the cold tier**: for a Kernel account whose root validator is `QuantumValidator`, user operations, module changes, key rotation and ERC-1271 signatures all need a signature from the post-quantum key. Guardian recovery needs post-quantum signatures too: `QuantumValidator` accepts a root or guardian verifier only if its `schemes()` lists post-quantum schemes, a new root must sign a proof of possession, and a recovery waits at least 24 hours, during which the account can cancel it. The `schemes()` check trusts the verifier to describe itself honestly (see [Known limits](#known-limits))
- **Bounded hot-tier loss**: a hot key, honest or stolen, moves at most `cap × bps / 10000` plus one window of refill of each tracked asset per window, and cannot call the five denied approval selectors (`approve`, `increaseAllowance`, `setApprovalForAll`, Permit2 `approve`, EIP-2612 `permit`), the account, the executor or a module the account reports as installed. The bound assumes tracked tokens with honest `balanceOf`, allowlisted calls that cannot turn untracked positions into tracked assets, and no allowlisted approval-style function outside those five ([trust model](docs/ARCHITECTURE.md#hottierexecutor))
- **One-way tripwire**: the canary registry has no owner, its level only rises, a claim is bound to its claimant, and no bounty payout can block the signal
- **Verifier robustness**: the verifiers never panic on attacker input, map malformed input to typed errors, and reject tampered messages, keys and signatures in every test and fuzzing run
- **Domain binding**: every signed object commits to its chain and its verifying contract: user operations through the EntryPoint hash, ERC-1271 through `accountDigest`, `PQSafeOwner` approvals through `safeMessageDigest` (which also binds the Safe that asks), recovery approvals, rotation proofs and hot operations through a per-account nonce, canary claims through the claimant
- **No privileged roles**: no Qanary contract has an owner, an admin, an upgrade path or a `delegatecall`

## How the code was reviewed

Each module had an internal review after implementation, against its specification and against known bug classes. Every finding rated important was fixed with a regression test before the module merged. These fixes changed behaviour:

- **Accept-all verifier**: a verifier address without code, or a precompile such as identity (`0x04`), which echoes the magic value, would have validated every signature. `QuantumValidator` now rejects verifiers without code and every address at or below `0xffff`
- **Stale recovery approvals**: guardian approvals collected but not submitted survived a key rotation, a guardian change or a reinstall. A per-account recovery nonce now increments on every such change
- **Hot-tier escalation**: an allowlist entry could target the account’s own modules (for example `rotateKey` on the validator, a path to the root), and approval selectors let a spender pull funds outside the cap. Calls to installed modules and the five approval selectors are now hard-denied
- **Canary payout liveness**: a failing bounty-token transfer reverted the claim, so a token issuer could veto the alarm. The registry now finalizes the signal first and defers failed payouts to `withdrawOwed`
- **Falcon compressed format**: valid round-3 detached signatures in the variable-length compressed encoding were rejected. Both the compressed and the zero-padded encodings now verify, checked on all 100 NIST KATs
- **ERC-7562 `GAS` opcode in the vendored core**: the Fireblocks core read `GAS` nine times for profiling, which bundlers reject during validation. The vendored copy writes `0` instead, and a test scans the deployed bytecode for banned opcodes
- **Kernel upgrade order**: invalidating the nonce last in the ECDSA-to-post-quantum batch broke the new root’s ERC-1271 signatures. The documented batch invalidates the nonce first, and fork tests pin both orders
- **SDK hot-tier reinstall**: a later SDK session could silently reinstall a hot tier the owner had uninstalled. The SDK now installs the hot tier only when an account is created or when asked to

An internal pre-deployment audit of the whole contract and Stylus surface followed. Its findings and fixes are listed in the [last section](#internal-pre-deployment-audit); the deployed contracts include every fix.

## Known limits

Read these before you configure an account. Each is true of the code at this commit and of the deployed contracts:

- **`schemes()` is self-description**: `QuantumValidator` accepts a root or guardian verifier whose `schemes()` lists post-quantum scheme ids. This stops classical verifiers (OpenZeppelin’s P-256, WebAuthn and RSA verifiers) and misconfigurations, not a verifier written to lie. Use the verifier addresses in `deployments/<network>.json`
- **Other account types accept any verifier**: only `QuantumValidator` checks its verifiers. `PQSafeOwner` (and its factory), `QanaryAccount` and `QanaryMultisigAccount` accept any verifier address, including one without code, a classical verifier, or the identity precompile `0x04`, which accepts every signature. Pass only a verifier address from `deployments/<network>.json`
- **Guardian re-proposals**: guardians who reach the threshold can propose again after every `cancelRecovery`; there is no cooldown. Each cancel costs the account a post-quantum signed user operation. If you suspect a guardian key, replace the set with `setGuardians`, which also invalidates every outstanding approval
- **Guardian uniqueness is byte-level**: guardians are compared by their `verifier ‖ key` bytes. The same key registered as a pointer and inline, or under two deployments of one verifier, counts twice towards the threshold. Register each guardian key once
- **Hooks on Kernel**: the executor detects modules through `isModuleInstalled`, which Kernel v3.3 answers only for types 1 to 3, and ERC-7579 module types above 4 are never detected. Keep hook and other module addresses off the allowlist
- **Approval-style selectors beyond the denylist**: only the five selectors above are hard-denied. DAI and Permit2 `permit`, ERC-777 `authorizeOperator`, ERC-6909 `approve` and `setOperator`, ERC-1363 `approveAndCall`, the Uniswap v3 position manager’s `permit` and legacy `increaseApproval` are blocked only because nothing allowlists them by default. Do not allowlist them
- **Safe signatures as an oracle**: Safe’s `checkSignatures(dataHash, data, signatures)` does not check `keccak256(data) == dataHash` for contract owners (Safe 1.4.1 and earlier), so a third-party module or bridge that calls it with caller-supplied `data` can be satisfied by any message a PQ-owned Safe signed before. Do not use a PQ-owned Safe with such an integrator. On Safe 1.3.0 the owners’ signature of a Safe transaction is also a valid legacy `isValidSignature(bytes,bytes)` approval of that transaction’s 66-byte `txHashData` on the same Safe, because both paths give the owner the same `data`
- **Program lifecycle**: an expired Stylus verifier stops validating every account configured with it, and reactivation is subject to the current activation pause. The account cannot sign the `rotateKey` that would move it to another verifier, because that user operation is validated by the expired one. Run a monitored `codehashKeepalive` for every program, and give accounts guardians on a different verifier
- **No second verifier on ApeChain**: the Solidity ML-DSA-44 fallback is deployed only on Arbitrum One. On ApeChain every verifier is a Stylus program, and all of them depend on Stylus activation, so guardians there do not remove the expiry and pause risk; the keepalive is the only mitigation
- **Fallback deployment trust**: the Solidity adapter trusts the core and key store it was deployed with; only the Keccak helper is pinned by code hash. Use the addresses in `deployments/arbitrum-one.json`
- **Degenerate ML-DSA keys**: FIPS 204 accepts forged signatures under degenerate public keys such as `t1 = 0`, in every conforming verifier. Keys from KMS or a real key generation are never degenerate
- **Falcon signature encodings**: the round-3 verifier accepts a signature in compressed and in zero-padded form, so the same signature has two byte strings. Never deduplicate approvals by signature bytes
- **Drill registries look like the real one**: drill and canonical registries emit the same events, and `HotTierExecutor` accepts either. Pin the canonical registry address and reject `isDrill() == true` in production
- **The L1 rung is classically reachable**: secp160r1 offers about 2^80 security, so a well-funded classical attacker could raise the level to 1. Keep level 1 a throttle, not a freeze
- **Silent thieves**: a quantum attacker who breaks secp256k1 may drain hot buckets without ever claiming K1. The cap bounds that loss; the cold tier never depends on the tripwire
- **SDK account objects can reinstall the hot tier**: an account object that `createQanaryAccount` armed to install the hot tier (an undeployed account with a hot setup, or `installHotTier: true`) appends the install to every user operation while the executor is not installed. After uninstalling the hot tier, create a new account object before you send the next operation
- **No public-bundler run**: every live user operation in `deployments/` was self-bundled: the end-to-end script sends `EntryPoint.handleOps` from a funded wallet. No public ERC-4337 bundler run is recorded, and whether a bundler’s ERC-7562 tracer accepts the Stylus verifier call during validation is untested

## Dependencies and advisories

Qanary depends on third-party cryptography and toolchains:

- **`ruint` RUSTSEC-2025-0137**: stylus-sdk 0.10.9 pins `ruint` below 1.17, which the advisory flags for an unsound `reciprocal_mg10` in release builds ([stylus-sdk-rs#455](https://github.com/OffchainLabs/stylus-sdk-rs/issues/455)). Qanary code does not call `ruint` division. The pin stays until a Stylus SDK release with the fix is verified against these programs
- **Vendored Fireblocks core**: MIT, commit `cca262b`, described by its authors as unaudited research code with ACVP, Wycheproof, differential fuzzing and Lean and Z3 proofs of the arithmetic bounds ([vendor README](contracts/evm/src/fallback/vendor/README.md))
- **`@noble/post-quantum` 0.7.1**: its README states it has not been independently audited; its authors self-audited version 0.6.1 in April 2026
- **Rust cores**: `fips204` 0.4.6 for ML-DSA and `fn-dsa-comm` and `fn-dsa-vrfy` 0.4.0 for Falcon arithmetic and FN-DSA, pinned to exact versions in `Cargo.toml`

## Internal pre-deployment audit

This is an internal audit by the Qanary developer, not an external audit: no independent party has reviewed the code. It ran on 2 October 2026, before the module contracts were deployed, and every fix below is in the deployed contracts.

- **Scope**: the Solidity contracts in `contracts/evm/src` at `8bc4d07`, the Solidity ML-DSA-44 fallback at `6448b67`, the Stylus programs in `contracts/stylus`, and the cores in `crates/qanary-pq` and `crates/qanary-curves`. The refactored fallback at `6b5653d` (expanded-key store, vendored core with the `GAS` patch) was re-checked, and every finding applies to it unchanged. Out of scope: the internals of OpenZeppelin, Safe and the Fireblocks core, except where Qanary’s use of them creates the bug, the SDK and the web app
- **Method**: a sweep of the bug classes typical for account-abstraction modules, signature verifiers and bounty registries (signature replay and domain binding, front-running of permissionless calls, ERC-7562 validation rules, reentrancy and callback ordering, transient-storage handoffs, arithmetic and rounding, malformed-input parsing), with an edge-case pass over every external entry point. H-01 and M-01 were proven with Foundry tests against the real Safe 1.3.0 and OpenZeppelin code: an exploit test that passes on the vulnerable code, and a property test that fails until the fix lands. Both property tests are now regression tests. The Rust cores’ tests and fuzzers ran alongside
- **Result**: 0 Critical, 1 High, 2 Medium, 3 Low and 8 informational findings

| ID | Severity | Finding | Status | Resolution |
|---|---|---|---|---|
| H-01 | High | `PQSafeOwner` signatures were not bound to the Safe. Safe 1.3.0’s ERC-1271 handler passes contract owners the raw application message, and one owner contract exists per key, so an approval for one Safe 1.3.0 (for example a Permit2 permit) was valid on every Safe the same key owns | Fixed in `317a604` | The key signs the EIP-712 digest `SafeMessage(address safe,bytes32 hash)` under the domain `QanaryPQSafeOwner` / `1`, with `safe` the Safe that asks. Tests: `PQSafeOwnerSafe130Test` on the real Safe 1.3.0, `test_forkSimulation_erc1271_boundToTheCouncilSafe` on the fork |
| M-01 | Medium | Guardian recovery was a classical path to the post-quantum root: any ERC-7913 verifier (P-256, WebAuthn, RSA) could be a guardian, the minimum delay was one hour, and re-proposals were unlimited | Fixed in `b88851c`, re-proposal cooldown not implemented | Root and guardian verifiers must report post-quantum schemes through `schemes()`, and the minimum delay is 24 hours. Tests: `test_classicalGuardian_*`, `test_classicalRootVerifier_*`, `test_pqVerifier_*`, `test_executeRecovery_minimumDelayIs24Hours`. Re-proposals are a known limit |
| M-02 | Medium | Every account and the registry’s ladder depend on one Stylus program staying activated. An expired program cannot be reactivated while activations are paused, and the account cannot sign the `rotateKey` that would leave it | Documented and accepted in `b88851c`, `75689d3` | NatSpec and `contracts/evm/src/README.md` require a monitored keepalive and recommend guardians on a different verifier. Listed in the known limits, with the ApeChain caveat |
| L-01 | Low | `rotateKey`, install and recovery accepted a `(verifier, keyPtr)` pair that can never verify (a scheme the verifier does not support, an inactive program), which bricks the account | Fixed in `b88851c` | `rotateKey` and `proposeRecovery` require the new key’s proof of possession over the EIP-712 digest `Rotation(address account,address verifier,address keyPtr,uint256 nonce)`, on top of the `schemes()` check. Install needs no proof, because the first user operation’s signature check proves the key. Tests: `test_rotateKey_withoutProof_reverts`, `test_rotateKey_toKeyThatNeverVerifies_reverts`, `test_proposeRecovery_targetThatNeverVerifies_reverts` and related |
| L-02 | Low | “Hooks are hard-denied” does not hold on Kernel v3.3, which answers `isModuleInstalled(4, …)` with `false` | Documented and accepted in `f3d373a`, `75689d3` | The executor’s NatSpec states that hook detection is best effort and that hooks must never be allowlisted. Listed in the known limits |
| L-03 | Low | `configure` refilled every bucket, so lowering caps during an incident handed a compromised hot key a fresh cap | Fixed in `f3d373a` | Assets that stay tracked keep `min(level before, new effective cap)`; new assets start full. Tests: `test_reconfigure_*`, `testFuzz_reconfigure_neverRaisesLevel` |
| I-01 | Info | Approval-style functions beyond the five denied selectors: ERC-777, ERC-1363, ERC-6909, the Uniswap v3 position `permit`, legacy `increaseApproval` | Documented in `75689d3` | Known limits: never allowlist them |
| I-02 | Info | Falcon-512 round-3 signatures have a compressed and a zero-padded encoding | Documented | Known limits |
| I-03 | Info | Guardian uniqueness is checked on the signer bytes | Documented | Known limits |
| I-04 | Info | Safe `checkSignatures` used as an external oracle with caller-supplied `data` | Documented in `317a604` | `PQSafeOwner` NatSpec and the known limits |
| I-05 | Info | `HotTierExecutor` accepts a drill registry | Documented | Known limits: pin the canonical registry |
| I-06 | Info | The L1 ladder target has about 2^80 classical security | Accepted | Known limits: keep level 1 a throttle |
| I-07 | Info | The bucket refill truncates fractions on every debit | Accepted | It only under-refills, which errs towards safety |
| I-08 | Info | The Solidity fallback trusts the core and key store passed to its constructor | Documented | Known limits: use the recorded addresses |

Areas the audit checked and found clean include the key store’s init code and content addressing, the validator’s ERC-7562 storage access and its behaviour on reverting or return-bombing verifiers, the hot tier’s net-outflow accounting against donations, callbacks and force-fed ETH, the registry’s claim binding, payout ordering and NUMS-only constructor, the Stylus programs’ length checks and Falcon decoding, the ladder ECDSA range and curve checks, the fallback’s FIPS 204 key expansion and transient handoff, and chain and domain binding on every signed object.
