# Qanary EVM contracts

| Contract | Role |
|---|---|
| `QuantumValidator` | ERC-7579 validator: a post-quantum key (`verifier ‖ keyPtr`) is the account's root, with key rotation and time-delayed guardian recovery |
| `HotTierExecutor` | ERC-7579 executor / Safe module: a classical hot key moves capped amounts, scaled down by the quantum canary |
| `safe/PQSafeOwner`, `safe/PQSafeOwnerFactory` | ERC-1271 Safe owner whose signatures are checked by a post-quantum verifier |
| `oz/QanaryAccount`, `oz/QanaryMultisigAccount` | OpenZeppelin ERC-4337 accounts with ERC-7913 post-quantum signers |
| `canary/QuantumCanaryRegistry` | Ownerless quantum tripwire: bounties on keys nobody knows |
| `KeyStore` | Content-addressed store for post-quantum public keys (KeyStore pointers) |
| `fallback/` | Solidity ML-DSA-44 verifier for chains where the Stylus verifiers cannot be activated (see `fallback/README.md`) |

## Trust model and operations

**Post-quantum verifiers only.** `QuantumValidator` accepts a root verifier (install, `rotateKey`,
recovery target) and guardian verifiers only if `schemes()` returns a non-empty list of
post-quantum scheme ids (1 FN-DSA-512, 2 ML-DSA-44, 3 ML-DSA-65, 4 Falcon-512). The Stylus
verifiers and the Solidity fallback implement it; OpenZeppelin's P-256, WebAuthn and RSA ERC-7913
verifiers do not and are rejected, so no classical signature can rotate the root through recovery.
The check relies on the verifier describing itself honestly.

**Proof of possession.** A new root key signs `rotationDigest(account, verifier, keyPtr)`
(EIP-712 `Rotation(address account,address verifier,address keyPtr,uint256 nonce)`, domain
`QanaryValidator` / `1`, nonce = `recoveryNonce(account)`) before `rotateKey` or `proposeRecovery`
accepts it. A pair that can never verify (scheme the verifier does not support, inactive program,
unprepared Solidity-fallback key) cannot produce the proof, so it cannot brick the account.
Recovery waits at least `MIN_RECOVERY_DELAY` = 24 hours, during which the account can cancel.

**Liveness depends on one verifier.** Validation, ERC-1271 and `rotateKey` all go through the
account's configured verifier. A Stylus program stops executing when its activation lapses: 365
days without `ArbWasm.codehashKeepalive`, or a Stylus version bump in an ArbOS upgrade. While
activations and reactivations are paused it cannot be renewed, and the account cannot sign the
`rotateKey` that would move it elsewhere.
- Run a monitored keepalive (`cargo stylus codehash-keepalive`, allowed about 31 days after the
  last activation and required before 365) for every verifier in use and for the ladder verifier.
- Configure guardians whose keys use a different verifier than the root, e.g. the Solidity
  ML-DSA-44 fallback, so recovery can rotate the root away from an expired or paused program.
- The canary registry's ladder verifier is immutable. If it lapses, L1–L3 claims revert: the
  ladder half of the tripwire goes silent but never reports a false level (fail closed). K1 and R1
  claims keep working.

**Safe owners are bound to the Safe.** A `PQSafeOwner` key signs `safeMessageDigest(safe, hash)`
(EIP-712 `SafeMessage(address safe,bytes32 hash)`, domain `QanaryPQSafeOwner` / `1`, chain id,
verifying contract = the owner contract), where `safe` is the Safe asking. One owner contract
exists per key, and Safe 1.3.0 forwards the raw application message to contract owners, so the
binding is what keeps an approval for one Safe from approving every Safe the key owns. `hash` is
the Safe transaction hash for `execTransaction`; for ERC-1271 it is `keccak256(abi.encode(appHash))`
on Safe 1.3.0 and the Safe message hash on 1.4.1 / 1.5.0 (the SDK has `pqSafeOwnerDigest`). Safe
`checkSignatures` does not check `keccak256(data) == dataHash` for contract owners, so do not use a
PQ-owned Safe with an integrator that calls it as an oracle with caller-supplied `data`.

**Hot tier.** Calls to the account's installed modules are refused, but detection asks the
account and is best-effort for hooks: Kernel v3.3 answers `isModuleInstalled(4, …)` with `false`
(its hooks hang off validators, executors and selectors, including per-validation hooks) and so
does OpenZeppelin's `AccountERC7579` without hooks. Never allowlist a hook's address. Reconfiguring
an account with `configure` keeps the bucket of every asset that stays tracked
(`min(level before, new effective cap)`); newly tracked assets start full, and so does every asset
after an uninstall and a fresh install. In an incident, rotate the hot key first (`setHotSigner`).
