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
| ApeChain | KeyStore | [`0x12cF4EE4073d5F3E5DE8bFE6e34522cEb46854f6`](https://apescan.io/address/0x12cF4EE4073d5F3E5DE8bFE6e34522cEb46854f6) |
| ApeChain | QuantumValidator | [`0x0057Fcac28c7094910D563Ad31E437d78a92036a`](https://apescan.io/address/0x0057Fcac28c7094910D563Ad31E437d78a92036a) |
| ApeChain | HotTierExecutor | [`0xE5A6EFCEAcdBFe96593f01F7770C1163B0C631f3`](https://apescan.io/address/0xE5A6EFCEAcdBFe96593f01F7770C1163B0C631f3) |
| ApeChain | QuantumCanaryRegistry | [`0x4848512a663F59fA23708C1Fa2f1cEA21B888A95`](https://apescan.io/address/0x4848512a663F59fA23708C1Fa2f1cEA21B888A95) |
| Arbitrum One | ML-DSA-44 verifier (Solidity) | [`0xc9C7B3B71f4A3451adeb29604bd8eA789F3F2EfE`](https://arbiscan.io/address/0xc9C7B3B71f4A3451adeb29604bd8eA789F3F2EfE) |
| Arbitrum One | KeyStore | [`0x12cF4EE4073d5F3E5DE8bFE6e34522cEb46854f6`](https://arbiscan.io/address/0x12cF4EE4073d5F3E5DE8bFE6e34522cEb46854f6) |
| Arbitrum One | QuantumValidator | [`0x0057Fcac28c7094910D563Ad31E437d78a92036a`](https://arbiscan.io/address/0x0057Fcac28c7094910D563Ad31E437d78a92036a) |
| Arbitrum One | HotTierExecutor | [`0xE5A6EFCEAcdBFe96593f01F7770C1163B0C631f3`](https://arbiscan.io/address/0xE5A6EFCEAcdBFe96593f01F7770C1163B0C631f3) |
| Arbitrum One | QuantumCanaryRegistry | [`0x4848512a663F59fA23708C1Fa2f1cEA21B888A95`](https://arbiscan.io/address/0x4848512a663F59fA23708C1Fa2f1cEA21B888A95) |
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
| ApeChain | Treasury account (Kernel v3.3) whose root key is an AWS KMS ML-DSA-44 key | [`0x32D09d174725388116C3fB997262AA0D3944A958`](https://apescan.io/address/0x32D09d174725388116C3fB997262AA0D3944A958) |
| ApeChain | Account deployed by its first post-quantum signed user operation | [`0x8191…5801`](https://apescan.io/tx/0x819119f9af3b4f684fd46be95f7b32b4f435285a53f0cf29d79d0c6910015801) |
| ApeChain | Native transfer signed by the post-quantum root key | [`0xc60a…4f2e`](https://apescan.io/tx/0xc60a9ac330f5417e156d5c75e2754aad7bc573bedc0e5c42a41b27542a614f2e) |
| ApeChain | Hot tier installed by a root user operation | [`0xb732…0a9c`](https://apescan.io/tx/0xb732c41ac6fcf17e22cf39ea5d371dd9a20b7debe236b998666ad78a16740a9c) |
| ApeChain | Hot-key transfer inside the cap | [`0x16b8…68f3`](https://apescan.io/tx/0x16b86ab6745cbfd03e0dfc6fdfc26f54e0434a9741fb5af5bfcbc17ee8b368f3) |
| ApeChain | Hot-key transfer over the cap, reverted (`CapExceeded`) | [`0x95f5…5db4`](https://apescan.io/tx/0x95f55ce2439bba0f8c20696874a71893c855bc46dd4da6f1958c208930545db4) |
| ApeChain | Tampered post-quantum signature, reverted (`AA24 signature error`) | [`0x28bf…51db`](https://apescan.io/tx/0x28bfb6b686a638660a23fea20e7267dcc03c4ee36e0a7fac022cdd4d546351db) |
| ApeChain | Ladder rung L1 (secp160r1) claimed through the Stylus ladder verifier | [`0x5eb5…8b83`](https://apescan.io/tx/0x5eb595c6f188135e43c0d914c96a7e9d2708d8d4ce0ae33b92afa9bd210a8b83) |
| ApeChain | Drill tripwire claim marks secp256k1 broken | [`0x417d…13bd`](https://apescan.io/tx/0x417d49ae8e07749155f85003995adf34282d47c62aede8cdb91d99cb923813bd) |
| ApeChain | Hot-key transfer after the trip, reverted (`ClassicalFamilyBroken`) | [`0x4540…d3ad`](https://apescan.io/tx/0x45404f06fc5c1a284f332d517760dcec0bd09fdc0f72ca7a319a4d68fe8ad3ad) |
| Arbitrum One | Treasury account (Kernel v3.3) whose root key is an AWS KMS ML-DSA-44 key | [`0xA3d2E874C2643B53b166DCB94073A7AD621BEbEe`](https://arbiscan.io/address/0xA3d2E874C2643B53b166DCB94073A7AD621BEbEe) |
| Arbitrum One | Account deployed by its first post-quantum signed user operation | [`0x0b98…6d0c`](https://arbiscan.io/tx/0x0b989fed5457af04e827e254f9afae443d411efeb80baa575c89360fb95d6d0c) |
| Arbitrum One | Native transfer signed by the post-quantum root key | [`0xa1f7…d821`](https://arbiscan.io/tx/0xa1f717c83ee25aad554aac6b33fc4e5a868c8e8386d594ec464c9ab6182cd821) |
| Arbitrum One | Hot tier installed by a root user operation | [`0xb6c8…fc60`](https://arbiscan.io/tx/0xb6c838feb81a0d98f8d746909b4835491b4bc65b9464f88debc53d1ab3defc60) |
| Arbitrum One | Hot-key transfer inside the cap | [`0x8e90…0a82`](https://arbiscan.io/tx/0x8e9069521f3cdf405b59ad37aaab0d442ce0c61c8ba5575e6b0c141697910a82) |
| Arbitrum One | Hot-key transfer over the cap, reverted (`CapExceeded`) | [`0xe2b4…d1dd`](https://arbiscan.io/tx/0xe2b477f0c523117b83aababbd3cc2d1688105bc1cc5a138428774bee975fd1dd) |
| Arbitrum One | Tampered post-quantum signature, reverted (`AA24 signature error`) | [`0x601c…a41b`](https://arbiscan.io/tx/0x601c02aaa9be012cd633c44ac7da30a151febe337f7b22461946b19f9e0ba41b) |
| Arbitrum One | Ladder rung L1 claim fails closed (`LadderUnavailable`) | [`0x7d45…f7c4`](https://arbiscan.io/tx/0x7d453419b345b764ab3d58b8a02f50a9ec2bf4c75493a6bcc6aff6e89e4bf7c4) |
| Arbitrum One | Drill tripwire claim marks secp256k1 broken | [`0x08f2…5ceb`](https://arbiscan.io/tx/0x08f2ff7868afa9b8dd6c04ed91640867b18214e8696a3dd0d2c62b322bd75ceb) |
| Arbitrum One | Hot-key transfer after the trip, reverted (`ClassicalFamilyBroken`) | [`0xab82…0bd6`](https://arbiscan.io/tx/0xab822abc17b0c02edc4b1396a1b3e2c726fbecede7670d8c6068d48bb8bf0bd6) |
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
