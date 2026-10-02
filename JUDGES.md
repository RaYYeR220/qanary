# Judges guide

This page gets you from zero to a checked claim in five minutes: open the app, call a live verifier, follow the recorded transactions, and run any test suite with one command. Qanary is a post-quantum treasury account for Arbitrum chains; the [README](README.md) explains the design in two minutes of reading.

## Open the app (1 minute)

The live app is at [qanary.vercel.app](https://qanary.vercel.app). It runs on `@qanary/sdk` from this repository and the contract addresses below.

## Check a live verifier (2 minutes)

The Stylus verifiers run on ApeChain, an Arbitrum Orbit L3 that settles to Arbitrum One, because the Arbitrum Security Council paused new Stylus activations on Arbitrum One on 2 October 2026 ([transaction](https://arbiscan.io/tx/0x9eb3a4be3ba777f9fc82250eddc10f8356731cc97c09a70801d30ce33322c652), [announcement](https://forum.arbitrum.foundation/t/security-council-emergency-action-2-10-2026/31530)). Arbitrum One runs the same modules on a Solidity ML-DSA-44 verifier. Every address links to its explorer:

<!-- proof:begin judges-addresses -->
| Network | Contract | Address |
|---|---|---|
| ApeChain | ML-DSA-44 verifier (Stylus) | [`0x38Fc3687363F1A69cc7B07b79F54DeBF885f23e1`](https://apescan.io/address/0x38Fc3687363F1A69cc7B07b79F54DeBF885f23e1) |
| ApeChain | ML-DSA-65 verifier (Stylus) | [`0x187551ed28f6a105953aABb163AF6cd53f75C197`](https://apescan.io/address/0x187551ed28f6a105953aABb163AF6cd53f75C197) |
| ApeChain | Falcon-512 verifier (Stylus) | [`0x051736a3cD6AC6eA5Bc062E0B964eA6279f7cbA3`](https://apescan.io/address/0x051736a3cD6AC6eA5Bc062E0B964eA6279f7cbA3) |
| ApeChain | KeyStore | pending |
| ApeChain | QuantumValidator | pending |
| ApeChain | HotTierExecutor | pending |
| ApeChain | QuantumCanaryRegistry | pending |
| Arbitrum One | ML-DSA-44 verifier (Solidity) | pending |
| Arbitrum One | KeyStore | pending |
| Arbitrum One | QuantumValidator | pending |
| Arbitrum One | HotTierExecutor | pending |
| Arbitrum One | QuantumCanaryRegistry | pending |
| ApeChain Curtis (testnet) | ML-DSA-44 verifier (Stylus) | [`0x38Fc3687363F1A69cc7B07b79F54DeBF885f23e1`](https://curtis.apescan.io/address/0x38Fc3687363F1A69cc7B07b79F54DeBF885f23e1) |
<!-- proof:end judges-addresses -->

With [Foundry](https://getfoundry.sh) installed, run these from the repository root. The first call asks ArbWasm whether the ML-DSA-44 program is activated, the second verifies a real ML-DSA-44 signature from `vectors/`, and the third verifies the same signature over a different message:

```bash
RPC=https://rpc.apechain.com/http
V=0x38Fc3687363F1A69cc7B07b79F54DeBF885f23e1
cast call -r $RPC 0x0000000000000000000000000000000000000071 \
  "programVersion(address)(uint16)" $V
cast call -r $RPC $V "verify(bytes,bytes32,bytes)(bytes4)" \
  0x02$(cat vectors/mldsa44.pk) 0x$(cat vectors/mldsa44.msg) \
  0x$(cat vectors/mldsa44.sig)
cast call -r $RPC $V "verify(bytes,bytes32,bytes)(bytes4)" \
  0x02$(cat vectors/mldsa44.pk) $(cast keccak other) \
  0x$(cat vectors/mldsa44.sig)
```

Expect `2` (the program is active), then `0x024ad318` (valid), then `0xffffffff` (invalid). [PROOF.md](PROOF.md) has every deployment and activation transaction.

## Follow the recorded transactions (1 minute)

The end-to-end run deploys a treasury account with an ML-DSA-44 root, moves funds with the post-quantum key and with the capped hot key, and shows the two refusals that matter: a hot transfer over the cap, and a hot transfer after a drill claim marks secp256k1 broken. Reverted transactions are the expected result for those two:

<!-- proof:begin judges-hero -->
| Network | Step | Transaction or address |
|---|---|---|
| ApeChain | Treasury account (Kernel v3.3, ML-DSA-44 root) | pending |
| ApeChain | Account deployed by its first post-quantum signed user operation | pending |
| ApeChain | Hot-key transfer inside the cap | pending |
| ApeChain | Hot-key transfer over the cap, reverted (`CapExceeded`) | pending |
| ApeChain | Drill tripwire claim marks secp256k1 broken | pending |
| ApeChain | Hot-key transfer after the trip, reverted (`ClassicalFamilyBroken`) | pending |
| Arbitrum One | Treasury account (Kernel v3.3, ML-DSA-44 root) | pending |
| Arbitrum One | Account deployed by its first post-quantum signed user operation | pending |
| Arbitrum One | Hot-key transfer inside the cap | pending |
| Arbitrum One | Hot-key transfer over the cap, reverted (`CapExceeded`) | pending |
| Arbitrum One | Drill tripwire claim marks secp256k1 broken | pending |
| Arbitrum One | Hot-key transfer after the trip, reverted (`ClassicalFamilyBroken`) | pending |
<!-- proof:end judges-hero -->

## Run the tests (optional)

Each suite runs with one command from the repository root after `git submodule update --init --recursive`; a first Rust build takes a few minutes. The results are from 2 October 2026:

| Suite | Command | Result |
|---|---|---|
| Rust cores and Stylus contracts | `cargo test --release --workspace` | 81 passed |
| Solidity modules and fallback verifier | `cd contracts/evm && forge test` | 245 passed, 39 skipped |
| TypeScript SDK | `pnpm install && pnpm -r test` | 152 passed, 3 skipped |
| Arbitrum One fork (real Kernel, Safe, EntryPoint, USDG) | `cd contracts/evm && ARB_ONE_RPC=your_archive_rpc_url forge test --match-path 'test/fork/*'` | 21 passed at block 511,050,000 |
| Stylus WASM inside Foundry | `ARBOS_FORGE=path_to_arbos_forge scripts/stylus-test.sh` | 7 passed, 11 skipped |
| Proof tables match the deployment records | `pnpm proof --check` | exit code 0 |

The 39 skipped Foundry tests are the fork suite and the Stylus suite, which need the settings shown in their own rows. Three fallback tests sign live with `@noble/post-quantum`; run `npm ci` in `scripts/devsign` once, or they skip and the count reads 242 passed. The SDK skips its live AWS KMS and live Arbitrum One scanner tests unless `QANARY_KMS_KEY_ID` or `QANARY_LIVE=1` is set. The 11 skipped Stylus tests read keys from KeyStore pointers, which arbos-forge v0.1.1 overcharges; the live end-to-end run covers that path.

## Where each claim is proven

[CLAIMS.md](CLAIMS.md) tags every claim and gives its proof. The main ones:

| Claim | Where to check |
|---|---|
| Stylus verifies ML-DSA-44, ML-DSA-65 and Falcon-512 on a public Arbitrum chain | The `cast` calls above; [PROOF.md](PROOF.md) |
| 9x to 18x cheaper than the cheapest Solidity verifiers | [BENCHMARKS.md](BENCHMARKS.md), with sources and commits |
| NIST conformance | `cargo test --release -p qanary-pq` (ACVP and round-3 KAT vectors) |
| The hot key’s loss is capped and it can never approve or touch modules | `forge test --match-contract HotTierExecutor`; the over-cap transaction above |
| The tripwire is ownerless, one-way and cannot be front-run | `forge test --match-contract QuantumCanaryRegistryTest`; the drill claim above |
| Works with the real Kernel v3.3, Safe 1.3.0 and OpenZeppelin accounts | The Arbitrum One fork suite |
| What Qanary does not protect | [README](README.md#not-in-scope-and-honest-limits) and [SECURITY.md](SECURITY.md#known-limits) |
