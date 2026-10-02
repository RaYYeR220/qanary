# Security

This page states what Qanary protects, against whom, which guarantees hold and under which conditions, how the code was reviewed, and the limits you need to know before you put funds in an account. Qanary has not had an external audit; the pre-deployment audit section at the end records its status.

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

- **No classical path to the cold tier**: for a Kernel account whose root validator is `QuantumValidator`, user operations, module changes, key rotation and ERC-1271 signatures all need a signature from the post-quantum key. This holds when the account’s guardians, if any, are post-quantum signers, because guardians can replace the root after the recovery delay
- **Bounded hot-tier loss**: a hot key, honest or stolen, moves at most `cap × bps / 10000` plus one window of refill of each tracked asset per window, and cannot approve, call the account, call the executor or call an installed module. The bound assumes tracked tokens with honest `balanceOf` and allowlisted calls that cannot turn untracked positions into tracked assets ([trust model](docs/ARCHITECTURE.md#hottierexecutor))
- **One-way tripwire**: the canary registry has no owner, its level only rises, a claim is bound to its claimant, and no bounty payout can block the signal
- **Verifier robustness**: the verifiers never panic on attacker input, map malformed input to typed errors, and reject tampered messages, keys and signatures in every test and fuzzing run
- **Domain binding**: every signed object commits to its chain and its verifying contract: user operations through the EntryPoint hash, ERC-1271 through `accountDigest`, recovery approvals and hot operations through a per-account nonce, canary claims through the claimant
- **No privileged roles**: no Qanary contract has an owner, an admin, an upgrade path or a `delegatecall`

## How the code was reviewed

Each module had an independent review after implementation, against its specification and against known bug classes. Every finding rated important was fixed with a regression test before the module merged. These fixes changed behaviour:

- **Accept-all verifier**: a verifier address without code, or a precompile such as identity (`0x04`), which echoes the magic value, would have validated every signature. `QuantumValidator` now rejects verifiers without code and every address at or below `0xffff`
- **Stale recovery approvals**: guardian approvals collected but not submitted survived a key rotation, a guardian change or a reinstall. A per-account recovery nonce now increments on every such change
- **Hot-tier escalation**: an allowlist entry could target the account’s own modules (for example `rotateKey` on the validator, a path to the root), and approval selectors let a spender pull funds outside the cap. Calls to installed modules and approval-class selectors are now hard-denied
- **Canary payout liveness**: a failing bounty-token transfer reverted the claim, so a token issuer could veto the alarm. The registry now finalizes the signal first and defers failed payouts to `withdrawOwed`
- **Falcon compressed format**: valid round-3 detached signatures in the variable-length compressed encoding were rejected. Both the compressed and the zero-padded encodings now verify, checked on all 100 NIST KATs
- **ERC-7562 `GAS` opcode in the vendored core**: the Fireblocks core read `GAS` nine times for profiling, which bundlers reject during validation. The vendored copy writes `0` instead, and a test scans the deployed bytecode for banned opcodes
- **Kernel upgrade order**: invalidating the nonce last in the ECDSA-to-post-quantum batch broke the new root’s ERC-1271 signatures. The documented batch invalidates the nonce first, and fork tests pin both orders
- **SDK hot-tier reinstall**: a later SDK session could silently reinstall a hot tier the owner had uninstalled. The SDK now installs the hot tier only when an account is created or when asked to

## Known limits

Read these before you configure an account. Each is true of the code at this commit:

- **Guardians can be classical**: `QuantumValidator` accepts any ERC-7913 verifier as a guardian. Passkey or ECDSA guardians give a classical path to the root after the delay (one hour minimum). Use post-quantum guardians and a delay of days
- **Safe 1.3.0 messages are not Safe-bound**: `PQSafeOwner` verifies the hash it receives. Safe 1.3.0’s ERC-1271 handler passes the raw application message, so one owner key that owns two Safe 1.3.0 accounts signs messages valid for both. Transactions are not affected. Use one owner key per Safe, or Safe 1.4.1
- **Hooks on Kernel**: the executor detects modules through `isModuleInstalled`, which Kernel v3.3 answers only for types 1 to 3. Keep hook addresses off the allowlist
- **Approval-style selectors beyond the denylist**: DAI and Permit2 `permit`, ERC-777 operators, ERC-6909 approvals and operators, ERC-1363 `approveAndCall` and legacy `increaseApproval` are blocked only because nothing allowlists them by default. Do not allowlist them
- **`configure` refills buckets**: reconfiguring gives the same hot key a fresh cap. After a hot-key compromise, call `setHotSigner` or uninstall the executor
- **A root that can never verify bricks the account**: `rotateKey` checks that the verifier and pointer have code, not that they verify together (a scheme mismatch or an unactivated program passes). Verify a fresh signature with the new pair (`verifyOnChain` in the SDK) before rotating
- **Program lifecycle**: an expired Stylus verifier stops validating every account configured with it, and reactivation is subject to the current activation pause. Run a monitored `codehashKeepalive` for every program
- **Fallback deployment trust**: the Solidity adapter trusts the core and key store it was deployed with; only the Keccak helper is pinned by code hash. Use the addresses in `deployments/arbitrum-one.json`
- **Degenerate ML-DSA keys**: FIPS 204 accepts forged signatures under degenerate public keys such as `t1 = 0`, in every conforming verifier. Keys from KMS or a real key generation are never degenerate
- **Falcon signature encodings**: the round-3 verifier accepts a signature in compressed and in zero-padded form, so the same signature has two byte strings. Never deduplicate approvals by signature bytes
- **Drill registries look like the real one**: drill and canonical registries emit the same events. Pin the canonical registry address and reject `isDrill() == true` in production
- **The L1 rung is classically reachable**: secp160r1 offers about 2^80 security, so a well-funded classical attacker could raise the level to 1. Keep level 1 a throttle, not a freeze
- **Silent thieves**: a quantum attacker who breaks secp256k1 may drain hot buckets without ever claiming K1. The cap bounds that loss; the cold tier never depends on the tripwire

## Dependencies and advisories

Qanary depends on third-party cryptography and toolchains:

- **`ruint` RUSTSEC-2025-0137**: stylus-sdk 0.10.9 pins `ruint` below 1.17, which the advisory flags for an unsound `reciprocal_mg10` in release builds ([stylus-sdk-rs#455](https://github.com/OffchainLabs/stylus-sdk-rs/issues/455)). Qanary code does not call `ruint` division. The pin stays until a Stylus SDK release with the fix is verified against these programs
- **Vendored Fireblocks core**: MIT, commit `cca262b`, described by its authors as unaudited research code with ACVP, Wycheproof, differential fuzzing and Lean and Z3 proofs of the arithmetic bounds ([vendor README](contracts/evm/src/fallback/vendor/README.md))
- **`@noble/post-quantum` 0.7.1**: its README states it has not been independently audited; its authors self-audited version 0.6.1 in April 2026
- **Rust cores**: `fips204` 0.4.6 for ML-DSA and `fn-dsa-comm` and `fn-dsa-vrfy` 0.4.0 for Falcon arithmetic and FN-DSA, pinned to exact versions in `Cargo.toml`

## Pre-deployment audit

> **Status: in progress.** A pre-deployment security audit of the contracts and Stylus programs at this commit is under way. This section will list each finding with its severity, its status and the commit that fixes it, and the guarantees and known limits above will be updated to match.

| ID | Severity | Finding | Status | Fix |
|---|---|---|---|---|
| | | To be completed | | |
