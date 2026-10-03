# Benchmarks

This page gives the gas cost of post-quantum signature verification in Arbitrum Stylus, the Solidity verifiers it replaces, the account-level costs of Qanary’s modules and the L1 data cost of post-quantum calldata on Arbitrum One. Every row names where it was measured and how to reproduce it. With cached programs on Arbitrum Nitro (ArbOS 61), Stylus verifies Falcon-512 for 35.6k gas, ML-DSA-44 for 109.5k and ML-DSA-65 for 166.3k, between 9x and 18x below the cheapest Solidity verifiers measured on the same node.

## How to read the numbers

Gas figures on this page use these definitions:

- **Execution gas**: gas of the `verify` call frame, measured with `gasleft()` before and after the call. It includes the cold account access (2,600) and the whole Stylus program cost (initialization, ink, memory pages) and excludes the transaction’s 21,000 intrinsic gas and its calldata
- **Transaction gas**: `gasUsed` of a mined transaction from an EOA to the verifier, or `cast estimate` for one: 21,000 plus calldata plus execution
- **Cached and uncached**: after and before `ArbWasmCache.cacheProgram`. A cached program skips most of its initialization cost on every call
- **Mock verifier**: account-level fork tests check post-quantum signatures with `MockVerifier` (valid when `signature == abi.encode(key, hash)`, a few thousand gas), because plain Foundry cannot run Stylus code on a fork. Those rows measure the account and module overhead, not the cost of the post-quantum check

## Stylus verifiers on Arbitrum Nitro

These are the headline numbers. They were measured on a local Nitro dev node (`nitro-node` v3.11.4 upgraded to ArbOS 61, L1 price set to 0) on 25 September 2026, with the same verification crates the shipped programs use (`fips204` 0.4.6, `fn-dsa-comm` and `fn-dsa-vrfy` 0.4.0) and the key inline in calldata:

| Scheme | Public key + signature | Calldata | Execution, uncached | Execution, cached | Transaction, uncached | Transaction, cached |
|---|---:|---:|---:|---:|---:|---:|
| Falcon-512 round 3 (compressed, KAT 0) | 897 + 656 B | 1,892 B | 51,774 | **35,583** | 96,259 | 80,068 |
| FN-DSA-512 (`fn-dsa` 0.4.0) | 897 + 666 B | 1,764 B | 52,544 | 36,353 | 96,494 | 80,303 |
| ML-DSA-44 | 1,312 + 2,420 B | 3,940 B | 127,415 | **109,537** | 205,568 | 187,690 |
| ML-DSA-65 | 1,952 + 3,309 B | 5,476 B | 184,316 | **166,255** | 286,476 | 268,415 |

Reading the key from a KeyStore pointer instead of calldata adds about 3k of execution gas (the cold code read) and removes the public key from calldata. With cached programs the transaction then costs 69,205 gas for FN-DSA-512, 169,932 for ML-DSA-44 and 240,435 for ML-DSA-65, which is 11k, 18k and 28k less than with the key inline.

The current contracts match these within 2% under arbos-forge v0.1.1, which runs the release WASM inside Foundry with programs cached:

| Call | Valid signature | Invalid signature |
|---|---:|---:|
| ML-DSA-44 `verify`, inline key | 109,439 | 107,003 |
| ML-DSA-65 `verify`, inline key | 166,389 | 164,011 |
| Falcon-512 round 3 `verify` (padded), inline key | 34,727 | 32,242 |
| FN-DSA-512 `verify`, inline key | 36,201 | |
| `QanaryAccount.validateUserOp`, ML-DSA-44 inline key | 208,898 | |

Reproduce these with `ARBOS_FORGE=/path/to/arbos-forge scripts/stylus-test.sh -vv`, which logs the gas of each call. The `QanaryAccount` row costs about 99k gas more than the bare `verify`, mostly cold reads of its 1,333-byte signer from storage; a KeyStore pointer keeps the signer at 40 bytes.

## Stylus verifiers live on ApeChain

ApeChain runs ArbOS 51 with Stylus and has no Stylus cache manager, so its programs run uncached. These are `cast estimate` transaction figures for the deployed programs with the fixtures in `vectors/`, including the 21,000 base cost and calldata:

| Program | Fixture | Transaction gas |
|---|---|---:|
| ML-DSA-44 | inline key `0x02 ‖ pk`, 2,420 B signature | 207,646 |
| ML-DSA-65 | inline key `0x03 ‖ pk`, 3,309 B signature | 289,315 |
| Falcon-512 round 3 | inline key `0x04 ‖ pk`, 666 B signature | 97,541 |
| FN-DSA-512 | inline key `0x01 ‖ pk`, 666 B signature | 98,662 |
| Ladder ECDSA | secp160r1 / P-192 / P-224 | 828,518 / 959,401 / 1,152,888 |

They are within 2.5% of the dev node’s uncached transaction gas, measured with the shipped builds on an older ArbOS. Reproduce one with:

```bash
cast estimate -r https://rpc.apechain.com/http \
  0x38Fc3687363F1A69cc7B07b79F54DeBF885f23e1 \
  "verify(bytes,bytes32,bytes)" 0x02$(cat vectors/mldsa44.pk) \
  0x$(cat vectors/mldsa44.msg) 0x$(cat vectors/mldsa44.sig)
```

## Solidity verifiers

The Solidity baselines are the published NIST-variant verifiers, deployed to the same ArbOS 61 dev node and called with the same kind of probe. ZKNox repositories are pinned by commit; the Fireblocks core is the one Qanary vendors as its Arbitrum One fallback:

| Verifier | Source | Input it expects | Execution gas | Transaction gas |
|---|---|---|---:|---:|
| `ZKNOX_falcon`, Falcon-512 NIST | [ETHFALCON](https://github.com/ZKNoxHQ/ETHFALCON) `main` @ `820da4b` | Pre-NTT, compacted key and signature | 3,831,474 | 3,881,664 |
| `ZKNOX_falcon8`, Falcon-512 NIST | ETHFALCON `exp/pq-verifier-gas` @ `012e080` | Same, plus a Keccak-f helper | **641,116** | 691,306 |
| `ZKNOX_dilithium`, ML-DSA-44 NIST | [ETHDILITHIUM](https://github.com/ZKNoxHQ/ETHDILITHIUM) `main` @ `f9f4fe1` | 22.4 KB pre-expanded key in SSTORE2 | 8,124,321 | 8,182,522 |
| `ZKNOX_dilithium`, ML-DSA-44 NIST, packed | ETHDILITHIUM `exp/packed-verifier` @ `f85ca80` | Same | **1,188,755** | 1,246,956 |
| `ZKNOX_dilithium65`, ML-DSA-65 | ETHDILITHIUM `mldsa-65` @ `4c370bb` | Pre-expanded key | **1,549,360** (their Foundry test) | not deployed |
| Fireblocks ML-DSA-44 through Qanary’s adapter | [evm-ml-dsa-verifier](https://github.com/fireblocks-labs/evm-ml-dsa-verifier) @ `cca262b` | 20,545 B expanded key blob, prepared once | **1,236,247** (Foundry, cold) | |

The ZKNox Foundry harnesses agree with the dev node within 2% for the `main` branches (3,910,833 and 8,128,360). Reproduce them by cloning each repository at the listed commit and running its own `forge test`. The Fireblocks row and its one-time key preparation come from `forge test --match-contract SolidityMLDSA44VerifierTest -vv` in `contracts/evm`.

## Stylus against Solidity

Ratios use execution gas, which removes the calldata difference between input formats. The cached ratio is the steady state of a cached program; the uncached ratio applies to chains without a Stylus cache manager, such as ApeChain:

| Scheme | Stylus, cached (uncached) | Cheapest Solidity | Ratio cached (uncached) | Solidity `main` branch | Ratio cached (uncached) |
|---|---:|---:|---:|---:|---:|
| Falcon-512 | 35,583 (51,774) | 641,116 | 18.0x (12.4x) | 3,831,474 | 108x (74x) |
| ML-DSA-44 | 109,537 (127,415) | 1,188,755 | 10.9x (9.3x) | 8,124,321 | 74x (64x) |
| ML-DSA-44 | 109,537 (127,415) | 1,236,247 (Fireblocks) | 11.3x (9.7x) | | |
| ML-DSA-65 | 166,255 (184,316) | 1,549,360 | 9.3x (8.4x) | | |

Whole-transaction ratios are smaller because calldata costs the same on both sides: 7.2x to 8.6x for Falcon-512 and 6.1x to 6.6x for ML-DSA-44 against the experimental branches, and 40x to 49x against `main`.

The comparison favours the Solidity side. ZKNox Falcon takes a key and signature that were decompressed and transformed to NTT form off-chain, and every Solidity ML-DSA verifier reads a 20 KB to 22 KB expanded key prepared in advance. The Stylus programs take the raw NIST encodings (897-, 1,312- or 1,952-byte keys) and do all decoding and the ML-DSA matrix expansion on-chain. The ZKNox rows with the lowest gas are on experimental branches that are not merged.

## Accounts and modules

Account-level costs come from Foundry, on an Arbitrum One fork at block 511,050,000 where marked, against the real Kernel v3.3, EntryPoint, Safe and USDG deployments:

| Path | Gas | Verifier | Where |
|---|---:|---|---|
| Kernel: first user operation (deploy, `QuantumValidator` root, hot-tier install, USDG transfer) | 668,316 | mock | fork |
| Kernel: post-quantum signed USDG transfer | 164,414 | mock | fork |
| Kernel: ECDSA-signed upgrade batch to a post-quantum root | 302,438 | ECDSA | fork |
| OpenZeppelin `QanaryAccount`, EntryPoint v0.9: post-quantum signed USDG transfer | 128,206 | mock | fork |
| `QuantumValidator.validateUserOp`, KeyStore pointer | 1,247,542 | Solidity ML-DSA-44 | Foundry |
| Security Council Safe 1.3.0, 9-of-12 `execTransaction` with 9 post-quantum owners | 221,828 | mock | fork |
| Same Safe with 9 ECDSA owners (baseline) | 125,014 | ECDSA | fork |
| Hot-tier ERC-20 transfer, Kernel `executeFromExecutor` | 120,493 | | fork |
| Hot-tier ERC-20 transfer, ERC-7579 test account | 134,414 | | Foundry |
| Hot-tier ERC-20 transfer, Safe module | 133,847 | | Foundry |
| Hot-tier ERC-20 transfer signed by a passkey (WebAuthn, P-256) | 397,346 | | Foundry |

Adding the measured verify gas to the mock rows gives modeled figures, not measurements: a Kernel user operation signed with ML-DSA-44 on Stylus costs about 270k gas, and the 9-of-12 council needs about 500k gas with Falcon-512 owners (a 6,867-byte signature blob) or 1.17M with ML-DSA-44 owners (22,653 bytes). Reproduce the fork rows with `ARB_ONE_RPC=<archive RPC> forge test --match-path 'test/fork/*' -vv` and the Foundry rows with `forge test --match-contract HotTierExecutorTest -vv`.

The fork rows were measured before the audit fixes added the `schemes()` probe to `onInstall` and the EIP-712 Safe binding to `PQSafeOwner`, and have not been re-measured since; the first-operation and council rows include those paths. A live figure for comparison: an ML-DSA-44 signed native transfer from a deployed Kernel account used 297,724 gas on ApeChain, with the uncached Stylus verifier and self-bundled ([`0xc60a…4f2e`](https://apescan.io/tx/0xc60a9ac330f5417e156d5c75e2754aad7bc573bedc0e5c42a41b27542a614f2e)).

## Tripwire claims

A ladder claim verifies one ECDSA signature on a short curve in Stylus, with generic Jacobian arithmetic over `crypto-bigint`:

| Curve | arbos-forge, execution | ApeChain, transaction |
|---|---:|---:|
| secp160r1 (L1) | 784,148 | 828,518 |
| P-192 (L2) | 911,321 | 959,401 |
| P-224 (L3) | 1,103,080 | 1,152,888 |

Claims are rare and the claimant pays, so this cost does not reach accounts. K1 and R1 claims use `ecrecover` and the P-256 precompile.

## Program and contract sizes

Each Stylus program fits in one 24 KB fragment, so it deploys on ArbOS versions without multi-fragment programs, such as ApeChain’s ArbOS 51:

| Program | Compressed WASM |
|---|---:|
| ML-DSA-44 verifier | 15,933 B |
| ML-DSA-65 verifier | 15,885 B |
| Falcon-512 verifier | 17,166 B |
| Ladder verifier | 16,546 B |

The Solidity fallback’s runtimes are 3,616 B (adapter), 4,950 B (expanded-key store), 24,163 B (core, 413 B under the EIP-170 limit) and 21,622 B (Keccak-f helper), and each prepared key is a 20,545 B code blob.

## L1 data cost on Arbitrum One

Arbitrum charges every transaction for posting its compressed calldata to Ethereum, on top of L2 execution. Post-quantum keys and signatures are large and high-entropy, so they compress poorly. The ArbOS NodeInterface (`0xC8`) prices that charge in L2 gas with `gasEstimateL1Component`; at Arbitrum One block 511,108,146 (2 October 2026, 21:31 UTC, L2 base fee 0.02 gwei) it gave:

| `verify` calldata | Bytes | L1 component, L2 gas |
|---|---:|---:|
| ML-DSA-44, inline key | 3,940 | 7,682 |
| ML-DSA-44, KeyStore pointer | 2,628 | 5,190 |
| ML-DSA-65, inline key | 5,476 | 10,562 |
| ML-DSA-65, KeyStore pointer | 3,524 | 6,839 |
| Falcon-512, inline key | 1,764 | 3,579 |
| Falcon-512, KeyStore pointer | 868 | 1,885 |

At that L1 price the data charge adds about 4% to an ML-DSA-44 verification. It scales with the L1 fee, so pointers (which drop the public key from every transaction) and Falcon’s 666-byte signatures matter more when L1 fees rise. Reproduce a row against the current price:

```bash
cast call -r https://arb1.arbitrum.io/rpc \
  0x00000000000000000000000000000000000000C8 \
  "gasEstimateL1Component(address,bool,bytes)(uint64,uint256,uint256)" \
  0x1111111111111111111111111111111111111111 false \
  $(cast calldata "verify(bytes,bytes32,bytes)" \
    0x02$(cat vectors/mldsa44.pk) 0x$(cat vectors/mldsa44.msg) \
    0x$(cat vectors/mldsa44.sig))
```

The first return value is the L1 component in L2 gas; the target address does not change it.

## Deployment cost on ApeChain

Each Stylus program costs about 0.70 APE to deploy and activate at ApeChain’s 101.7 gwei floor: about 3.5M gas for the deployment, 2.9M to 3.4M gas for activation and a data fee under 0.0001 APE. `deployments/apechain.json` records the exact gas, fee and total of each program.
