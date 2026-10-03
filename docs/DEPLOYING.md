# Deploying Qanary

This guide covers the on-chain deployment of Qanary: the Stylus signature verifiers first, then the
Solidity modules that use them. Every deployment is recorded in `deployments/<network>.json`, which is
the source of truth for addresses.

## Stylus verifiers

Qanary ships four Stylus (Rust → WASM) programs:

| Program | Contract dir | What it verifies | Scheme ids |
|---|---|---|---|
| ML-DSA-44 verifier | `contracts/stylus/mldsa44-verifier` | ERC-7913 `verify(bytes key, bytes32 hash, bytes sig)`, FIPS 204 ML-DSA-44 | `2` |
| ML-DSA-65 verifier | `contracts/stylus/mldsa65-verifier` | ERC-7913, FIPS 204 ML-DSA-65 | `3` |
| Falcon-512 verifier | `contracts/stylus/falcon512-verifier` | ERC-7913, FN-DSA-512 and round-3 Falcon-512 | `1`, `4` |
| Ladder verifier | `contracts/stylus/ladder-verifier` | ECDSA over secp160r1 / P-192 / P-224 for the quantum canary | n/a |

An ERC-7913 `key` is either an inline `scheme ‖ publicKey` or a 20-byte pointer to a KeyStore entry whose
code is `0x00 ‖ scheme ‖ publicKey`. A valid signature returns `0x024ad318`, an invalid one `0xffffffff`.

### Where they are deployed

| Network | Chain id | ML-DSA-44 | ML-DSA-65 | Falcon-512 | Ladder |
|---|---|---|---|---|---|
| ApeChain | 33139 | [`0x38Fc…23e1`](https://apescan.io/address/0x38Fc3687363F1A69cc7B07b79F54DeBF885f23e1) | [`0x1875…C197`](https://apescan.io/address/0x187551ed28f6a105953aABb163AF6cd53f75C197) | [`0x0517…cbA3`](https://apescan.io/address/0x051736a3cD6AC6eA5Bc062E0B964eA6279f7cbA3) | [`0x7DEA…DC4F`](https://apescan.io/address/0x7DEAe8711B07004017CcAFd71b64F3b944E8DC4F) |
| ApeChain Curtis (testnet) | 33111 | [`0x38Fc…23e1`](https://curtis.apescan.io/address/0x38Fc3687363F1A69cc7B07b79F54DeBF885f23e1) | — | — | — |

Full addresses, deployment and activation transactions, sizes, data fees and live `verify` gas are in
[`deployments/apechain.json`](../deployments/apechain.json) and
[`deployments/apechain-curtis.json`](../deployments/apechain-curtis.json).

### Why ApeChain, and what runs on Arbitrum One

On 2 October 2026 the Arbitrum Security Council used its emergency powers to pause **new** Stylus
activations on Arbitrum One and Arbitrum Nova by setting the WASM activation gas to `u64::MAX`, so every
`ArbWasm.activateProgram` call now fails. Programs that were already active keep running; new ones cannot be
activated until the setting is reverted.

- Arbitrum One transaction: [`0x9eb3a4be…c652`](https://arbiscan.io/tx/0x9eb3a4be3ba777f9fc82250eddc10f8356731cc97c09a70801d30ce33322c652)
- Arbitrum Sepolia transaction: `0x123ec40e38c2e9c51741c767d06fcbabd92c7d2ac40db242bcaeb193ed20745b`
- Announcement: [Security Council Emergency Action 2-10-2026](https://forum.arbitrum.foundation/t/security-council-emergency-action-2-10-2026/31530)

ApeChain is an Arbitrum Orbit L3 that settles to Arbitrum One. It runs ArbOS 51 with Stylus enabled and still
accepts activations, and it already hosts the account-abstraction stack Qanary builds on (EntryPoint v0.7,
Kernel v3.3, Safe 1.4.1, the CREATE2 factory). The Stylus verifiers therefore live on ApeChain, and the
full Qanary stack runs there.

On Arbitrum One, accounts use the Solidity ML-DSA-44 verifier as their ERC-7913 backend instead. When Stylus
activations return, deploy the Stylus verifiers there with the same script and switch each account over with
`QuantumValidator.rotateKey(verifier, keyPtr, proof)`, where `proof` is the key's signature over
`rotationDigest(account, verifier, keyPtr)`; the KeyStore pointer stays the same.

### Prerequisites

- Docker, with the pinned build image (Rust 1.95.0, cargo-stylus 0.10.9):
  ```bash
  docker build -t qanary/stylus:0.10.9 -f docker/stylus.Dockerfile docker
  ```
  `scripts/stylus.sh` runs every `cargo stylus` command inside this image (cargo-stylus does not build
  natively on Windows).
- [Foundry](https://getfoundry.sh) (`cast`), `curl` and Python 3.
- A funded deployer key in `DEPLOYER_PRIVATE_KEY`. Each program costs about 0.70 APE at ApeChain's
  ~101.7 gwei floor: ~3.5M gas for the deployment, ~2.9–3.4M gas for activation and a ~0.00009 APE
  activation data fee. All four cost about 2.8 APE.

### Deploying

```bash
set -a; source /path/to/deployer.env; set +a      # exports DEPLOYER_PRIVATE_KEY

# Build, check and estimate only; sends nothing
DRY_RUN=1 scripts/deploy-stylus.sh https://rpc.apechain.com/http apechain

# Deploy, activate and smoke-test all four; refuses to start if the estimate exceeds 7 APE
MAX_SPEND=7 scripts/deploy-stylus.sh https://rpc.apechain.com/http apechain

# ApeChain Curtis testnet (see the note below), one program
DEPLOY_VIA=cast scripts/deploy-stylus.sh https://curtis.rpc.caldera.xyz/http apechain-curtis mldsa44-verifier

# Local Nitro dev node: start it in another terminal first, then use its prefunded key
scripts/run-dev-node.sh
DEPLOYER_PRIVATE_KEY=0xb6b15c8cb491557369f3c7d2c287b053eb229daa9c22138887752191c9520659 \
  scripts/deploy-stylus.sh http://127.0.0.1:8547 devnode
```

For each program, `scripts/deploy-stylus.sh` does the following:

1. Runs `cargo stylus check` against the target chain (size and activation data fee).
2. Generates the init code and estimates deployment gas, activation gas and the data fee for every program
   before sending anything. It aborts if the balance is below 1.2× the total, or the total exceeds
   `MAX_SPEND`.
3. Runs `cargo stylus deploy --no-verify`. The verifiers have no Stylus constructor, so this is a plain
   `CREATE` followed by `ArbWasm.activateProgram`; the `StylusDeployer` contract is not needed and is
   not deployed (`DEPLOY_STYLUS_DEPLOYER=1` deploys it at its canonical CREATE2 address if a future program
   needs it).
4. Confirms activation through ArbWasm (`0x71`): `programVersion(address)` and
   `codehashVersion(bytes32)` must both return the chain's Stylus version.
5. Places a `cache bid 0` where the chain has a Stylus CacheManager.
6. Calls `verify` on the live program with a fixture from `vectors/` (valid signature → `0x024ad318`,
   wrong hash → `0xffffffff`; the ladder verifier checks one valid and one tampered signature per curve),
   and records the result and the `cast estimate` gas.
7. Writes `deployments/<network>.json`: address, deployment and activation transactions, size, data fee,
   code hash, gas used, total cost and the smoke-test result.

Re-running is safe. A program already recorded and active is only smoke-tested again, and a program
recorded as deployed but not yet active is only activated.

The deployer key reaches cargo-stylus through a private temporary file, mounted read-only into the
container and removed when the script exits. It is never written to the repository, the logs or the
deployment records. `cast` is different: it takes the key on its command line, where other local users
can read it from the process list. The script derives the deployer address with `cast wallet address`,
and `DEPLOY_VIA=cast` and the one-time StylusDeployer bootstrap (`DEPLOY_STYLUS_DEPLOYER=1`) send their
transactions with `cast send --private-key`. Run the script only on a single-user machine.

**Curtis:** the Curtis RPC node rejects the activation simulation that `cargo stylus check` and
`cargo stylus deploy` run (an `eth_call` with a `2^256-1` balance override returns "method handler
crashed"). `DEPLOY_VIA=cast` skips that simulation, simulates activation with a bounded override instead
and sends the deployment and activation transactions with `cast`. On Windows the deployment calldata must
fit on one command line (about 16 KB of init code), which only the ML-DSA programs satisfy; deploy the
larger ones from Linux, macOS or WSL.

### Verifying a deployment

Reproducible build: rebuild the program in the pinned image and compare it with the deployment
transaction's init code (the `deployTx` in the deployment record):

```bash
scripts/stylus.sh contracts/stylus/mldsa44-verifier verify \
  --endpoint https://rpc.apechain.com/http \
  --deployment-tx 0xa0dc679c19606a321b767e0d258dd8a8564ac8475827d6baf5f335ac82d5069a \
  --no-verify
```

`--no-verify` builds inside `qanary/stylus:0.10.9` itself rather than in cargo-stylus's nested Docker
image; that image pins the toolchain. The command runs `cargo clean` on `target-linux/` first. If the RPC
drops its idle connection during the rebuild ("peer closed connection"), run it again with `--skip-clean`.
All five deployments above verify.

cargo-stylus hashes the program's `Cargo.toml`, `build.rs`, `src/*.rs` and the root `rust-toolchain.toml`
byte for byte into a `project_hash` section of the deployed program. The deployments were built from a
checkout with CRLF line endings, so `.gitattributes` checks those files out with CRLF on every platform;
with LF line endings the rebuild differs and verification fails with a "prelude mismatch".

Activation and a live signature check:

```bash
RPC=https://rpc.apechain.com/http
cast call -r $RPC 0x0000000000000000000000000000000000000071 \
  "programVersion(address)(uint16)" 0x38Fc3687363F1A69cc7B07b79F54DeBF885f23e1    # 2
cast call -r $RPC 0x38Fc3687363F1A69cc7B07b79F54DeBF885f23e1 \
  "verify(bytes,bytes32,bytes)(bytes4)" \
  0x02$(cat vectors/mldsa44.pk) 0x$(cat vectors/mldsa44.msg) 0x$(cat vectors/mldsa44.sig)   # 0x024ad318
```

### Cost and gas on ApeChain

Deployment (101.68 gwei, recorded in `deployments/apechain.json`):

| Program | Size | Deploy gas | Activation gas | Data fee (APE) | Total (APE) |
|---|---|---|---|---|---|
| ML-DSA-44 | 15,933 B | 3,498,864 | 3,350,590 | 0.000087 | 0.6966 |
| ML-DSA-65 | 15,885 B | 3,488,627 | 3,413,450 | 0.000088 | 0.7019 |
| Falcon-512 | 17,166 B | 3,765,640 | 2,919,558 | 0.000079 | 0.6798 |
| Ladder | 16,546 B | 3,631,511 | 3,011,498 | 0.000080 | 0.6756 |

`verify` on the live programs (`cast estimate`, uncached; includes the 21,000 base cost and calldata):

| Program | Fixture | Gas |
|---|---|---|
| ML-DSA-44 | inline key `0x02 ‖ pk`, 2,420-byte signature | 207,646 |
| ML-DSA-65 | inline key `0x03 ‖ pk`, 3,309-byte signature | 289,315 |
| Falcon-512 | inline key `0x04 ‖ pk`, 666-byte signature | 97,541 |
| FN-DSA-512 | inline key `0x01 ‖ pk`, 666-byte signature | 98,662 |
| Ladder | secp160r1 / P-192 / P-224 | 828,518 / 959,401 / 1,152,888 |

### Keepalive and caching

- **Expiry.** An activation lasts 365 days (`ArbWasm.expiryDays()`). `ArbWasm.programTimeLeft(address)`
  shows the time remaining. Extend it with a keepalive, which is allowed once 31 days
  (`ArbWasm.keepaliveDays()`) have passed since the last activation or keepalive:
  ```bash
  # SECRETS_DIR is mounted read-only at /secrets; it holds a file `key` with the hex private key
  SECRETS_DIR=/path/to/keydir scripts/stylus.sh contracts/stylus/mldsa44-verifier codehash-keepalive \
    --codehash <codehash from deployments/apechain.json> --endpoint https://rpc.apechain.com/http \
    --private-key-path /secrets/key
  ```
  If a program does expire, re-run `scripts/deploy-stylus.sh` for that network: it finds the recorded
  program inactive and activates it again. The address and code stay the same.
- **Activation is per code hash.** Deploying byte-identical code again, on the same chain, needs no new
  activation (`cargo stylus deploy` reports "wasm already activated").
- **Caching.** ApeChain and Curtis have no Stylus CacheManager, so the programs run uncached and every call
  pays the program's initialization cost (`ArbWasm.programInitGas`, about 20.5k gas for ML-DSA-44 versus
  about 3k when cached). Where a CacheManager exists the script places a zero bid automatically.

## Solidity modules

`contracts/evm/script/Deploy.s.sol` deploys the account modules on one network and records them under
`evm` in `deployments/<network>.json`:

| Contract | Role |
|---|---|
| `KeyStore` | Content-addressed store for post-quantum public keys |
| `QuantumValidator` | ERC-7579 validator: a post-quantum key is the account's root |
| `HotTierExecutor` | Capped classical hot key, scaled down by the quantum canary |
| `PQSafeOwnerFactory` | Post-quantum Safe owners |
| `QanaryAccountFactory` | OpenZeppelin ERC-4337 accounts with ERC-7913 post-quantum signers |
| `QuantumCanaryRegistry` | The live tripwire over the nothing-up-my-sleeve keys |
| `DrillRegistryFactory` | Drill registries over the published drill keys, for rehearsals |

The script reads the Stylus programs from the same file. Where a network has no Stylus ML-DSA-44 program
it deploys the Solidity verifier stack instead (`contracts/evm/src/fallback/README.md`): the
Keccak-f[1600] helper, the vendored core, the expanded-key store and the ERC-7913 adapter, recorded as
`mldsa44SolidityVerifier`. Where it has no Stylus ladder program it deploys `LadderUnavailableVerifier`,
so ladder claims (L1–L3) fail closed while K1 and R1 claims still trip the registry. The bounty token is
USDG on Arbitrum One and none (native bounties only) on ApeChain, where USDG does not exist.

### Where they are deployed

The deployer used the same nonce for each shared contract on both chains, so they have the same address:

| Contract | Address on ApeChain and Arbitrum One |
|---|---|
| KeyStore | `0x12cF4EE4073d5F3E5DE8bFE6e34522cEb46854f6` |
| QuantumValidator | `0x0057Fcac28c7094910D563Ad31E437d78a92036a` |
| HotTierExecutor | `0xE5A6EFCEAcdBFe96593f01F7770C1163B0C631f3` |
| PQSafeOwnerFactory | `0x4Ce066c253d38bFF3012607B0D3B1B4b8E29ABA3` |
| QanaryAccountFactory | `0xdbEEAA8CC79A925b42A5F42f3F1bA81afC132609` |
| QuantumCanaryRegistry | `0x4848512a663F59fA23708C1Fa2f1cEA21B888A95` (ladder: the Stylus program on ApeChain, `LadderUnavailableVerifier` on Arbitrum One) |
| DrillRegistryFactory | `0xA523899D17954a5BeE0Ee102124C458942878032` |

Arbitrum One only:

| Contract | Address |
|---|---|
| ML-DSA-44 verifier (Solidity adapter) | `0xc9C7B3B71f4A3451adeb29604bd8eA789F3F2EfE` |
| ML-DSA-44 core (vendored) | `0xf2d5c07ae3817B8bbDf57970369a6604377e588E` |
| Expanded-key store | `0x49fdfaCaf748cbe2F9adb4cAeE50F87582CEf8f5` |
| Keccak-f[1600] helper | `0x68b5C1b28707AC3201880d59f27cFc6583D4FF8D` |
| `LadderUnavailableVerifier` | `0xBf33F4FE6D73fEcDE03E388f4FE985fe1d88b9D6` |

Deployment transactions and gas are in the JSON files and in [PROOF.md](../PROOF.md).

### Deploying the modules

```bash
cd contracts/evm
export DEPLOYER_PRIVATE_KEY=0x…

# Simulate against the live chain: prints addresses and gas, sends and writes nothing
forge script script/Deploy.s.sol --rpc-url https://rpc.apechain.com/http

# Deploy, one transaction at a time
forge script script/Deploy.s.sol --rpc-url https://rpc.apechain.com/http --broadcast --slow

# Add each contract's deployment transaction, gas and cost from the broadcast receipts
cd ../../packages/sdk && npx tsx scripts/record-deploy.ts --network apechain
```

Arbitrum One works the same way with `--rpc-url https://arb1.arbitrum.io/rpc` and `--network arbitrum-one`.

- **Idempotent.** A contract already recorded under `evm` that has code on-chain is reused. After a
  partial failure, run the script again and it deploys only what is missing.
- **Same addresses on every chain.** Contract addresses follow the deployer's nonce. To match another
  chain, first bring the nonce to the same value with empty self-transfers (`cast send <deployer> --value 0`,
  repeated). The script can do this itself with `ALIGN_NONCE=<n>`, but Forge then asks to confirm
  transactions to an address without code, which needs a terminal; `cast` does not. The Arbitrum One
  alignment transactions are listed under `nonceAlignment` in its JSON file.
- **Stylus programs in simulations.** Forge cannot execute Stylus programs, so the script checks the
  Solidity verifier's `schemes()` locally and leaves the Stylus programs to `QuantumValidator`, which
  checks `schemes()` on-chain whenever an account installs it.
- **Gas on Arbitrum chains.** Forge estimates every transaction through the RPC, so the parent-chain data
  fee is included. Its "Estimated amount required" assumes twice the base fee on every transaction; the
  actual cost is about half of it.

### Verifying the modules

The Solidity contracts are verified on [Sourcify](https://sourcify.dev), which needs no API key:

```bash
cd contracts/evm
forge verify-contract --verifier sourcify --chain 33139 \
  0x12cF4EE4073d5F3E5DE8bFE6e34522cEb46854f6 src/KeyStore.sol:KeyStore --watch
```

Constructor arguments go in `--constructor-args $(cast abi-encode …)`: the registry takes
`(ladder, bountyToken, CanaryTargets.nums(), false)`, the drill factory `(ladder, bountyToken)`, the core
and the expanded-key store `(helper)`, the adapter `(core, store)`. The Keccak-f[1600] helper is raw
runtime with no Solidity source. Check it by code hash instead: `cast codehash
0x68b5C1b28707AC3201880d59f27cFc6583D4FF8D -r https://arb1.arbitrum.io/rpc` must print
`0x4afb4435879cdf8e50474c7aab2bc3a679caed432550ad6dba64f509309a817b`, the hash the core and the store
check in their constructors.

### Cost of the modules

| Contract | Gas on ApeChain | Gas on Arbitrum One |
|---|---:|---:|
| KeyStore | 452,984 | 453,804 |
| QuantumValidator | 2,430,228 | 2,434,735 |
| HotTierExecutor | 4,946,452 | 4,954,756 |
| PQSafeOwnerFactory | 1,248,718 | 1,250,913 |
| QanaryAccountFactory (with both implementations) | 5,734,781 | 5,743,154 |
| QuantumCanaryRegistry | 2,120,751 | 2,125,134 |
| DrillRegistryFactory | 2,630,247 | 2,635,092 |
| LadderUnavailableVerifier | — | 108,987 |
| Keccak-f[1600] helper | — | 4,719,182 |
| ML-DSA-44 core | — | 5,209,232 |
| Expanded-key store | — | 1,122,350 |
| ML-DSA-44 adapter | — | 840,339 |
| **Total** | **19,564,161 gas, 1.989 APE** | **31,597,678 gas, 0.000633 ETH** |

## End-to-end run

`packages/sdk/scripts/e2e.ts` runs a treasury account through its whole life on a live network. Every
user operation is self-bundled: the deployer sends `EntryPoint.handleOps` itself, which works on chains
without a public ERC-4337 bundler (ApeChain) and lets the refusals land on-chain as failed transactions.

```bash
cd packages/sdk
export DEPLOYER_PRIVATE_KEY=0x…
# AWS KMS root key (ML_DSA_44, SIGN_VERIFY); credentials come from the usual AWS provider chain
export QANARY_KMS_KEY_ID=… AWS_REGION=us-east-1 AWS_PROFILE=…
# where the run keeps the mnemonic and the hot key it creates (never printed)
export QANARY_SECRETS_DIR=/path/outside/the/repo

npx tsx scripts/e2e.ts --network apechain --root kms --extras mnemonic,falcon --max-spend 2.5
npx tsx scripts/e2e.ts --network arbitrum-one --root kms --max-spend 0.00105
```

The treasury account has the AWS KMS ML-DSA-44 key as its root:

1. The root key goes into the KeyStore. On the Solidity verifier, `prepareKey` expands it on-chain, once
   per key.
2. A Kernel v3.3 account with the QuantumValidator as root is deployed by its first user operation, signed
   by the KMS key.
3. A native transfer signed by the KMS key.
4. A root user operation installs the hot tier (one secp256k1 hot key, a native cap, ladder levels
   100% / 50% / 25% / 0%) following the live registry.
5. The hot key moves half the cap, which succeeds. It then tries more than the cap, and the transaction
   fails with `CapExceeded`.
6. A user operation whose post-quantum signature has one flipped byte: `handleOps` fails with
   `AA24 signature error`.
7. A drill registry from the factory. A root user operation re-points the hot tier at it.
8. Ladder rung L1 (secp160r1) is claimed with the published drill key. On ApeChain the Stylus ladder
   verifier accepts it and the hot tier drops to 50%. On Arbitrum One the claim fails with
   `LadderUnavailable`.
9. K1 is claimed with the published drill key: secp256k1 is marked broken, and the next hot transfer fails
   with `ClassicalFamilyBroken`.
10. ERC-1271 through Kernel: `isValidSignature` returns `0x1626ba7e` for the KMS signature and
    `0xffffffff` for the same signature on another hash.

`--extras mnemonic,falcon` adds an account with an ML-DSA-44 root derived from a BIP-39 mnemonic, as a
browser wallet would, and one with a Falcon-512 root. Each is deployed by one signed user operation that
also transfers.

Each transaction is simulated before it is sent, and each expected failure is confirmed by simulation
first, then sent with a fixed gas limit. The run stops before any step that would take the deployer's
spend over `--max-spend`. Every hash goes into `deployments/<network>.json` under `e2e.sdk`. A step that
is already recorded is skipped, so an interrupted run resumes where it stopped. Afterwards, render the
proof pages with `pnpm proof`.

### Gas of the end-to-end steps

| Step | ApeChain (Stylus) | Arbitrum One (Solidity) |
|---|---:|---:|
| Store the root key | 345,109 | 346,234 |
| Expand the key for the Solidity verifier (once per key) | — | 9,896,269 |
| First user operation, deploys the account | 525,339 | 1,613,983 |
| Native transfer signed by the root | 297,724 | 1,407,338 |
| Root installs the hot tier | 556,307 | 1,666,414 |
| Hot-key transfer within the cap | 111,743 | 112,002 |
| Hot-key transfer over the cap (fails) | 101,948 | 102,251 |
| Tampered signature (fails, AA24) | 276,508 | 1,386,274 |
| Drill registry | 1,965,081 | 1,965,166 |
| Root re-points the hot tier | 380,277 | 1,487,519 |
| L1 claim | 878,308 | 29,369 (fails, no ladder) |
| K1 claim | 43,384 | 60,851 |
| Hot-key transfer after the trip (fails) | 46,441 | 46,910 |
| Mnemonic ML-DSA-44 account: store key, first user operation | 345,109 + 532,209 | — |
| Falcon-512 account: store key, first user operation | 254,934 + 429,154 | — |

The account pays for its own user operations. Its first operation leaves a deposit in the EntryPoint (the
prefund minus the cost), which later operations draw on. The deposit stays the account's and a root user
operation can withdraw it with `EntryPoint.withdrawTo`.
