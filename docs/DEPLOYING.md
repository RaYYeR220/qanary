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
`QuantumValidator.rotateKey(verifier, keyPtr)`; the KeyStore pointer stays the same.

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
deployment records.

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
