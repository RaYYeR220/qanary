# Claims

This page lists every claim the Qanary documentation and app make, with the command or link that proves each one, then names the prior work Qanary builds on and the claims it does not make. Each claim carries one tag:

- **REPRODUCIBLE**: run the command on a clone of this repository; it passes or prints the number. Cargo and pnpm commands run from the repository root, Foundry commands from `contracts/evm`
- **VERIFIED-LIVE**: a public chain or a public primary source shows it; follow the link or run the `cast` call. A row whose proof says pending has no deployment record yet, and [PROOF.md](PROOF.md) fills it in when one exists
- **MODELED**: computed from measured parts, not measured end to end
- **NOT-CLAIMED**: Qanary does not claim this; it is listed so nobody reads it in

## Post-quantum cryptography

The verification cores are tested against NIST vectors, an independent implementation and fuzzers:

| Claim | Tag | Proof |
|---|---|---|
| ML-DSA-44 and ML-DSA-65 verification matches FIPS 204 on the NIST ACVP sigVer vectors (pure interface, each vector’s own context) | REPRODUCIBLE | `cargo test --release -p qanary-pq --test mldsa` |
| Falcon-512 verification accepts all 100 NIST round-3 KAT signatures, compressed and zero-padded, and rejects tampered messages, keys and signatures | REPRODUCIBLE | `cargo test --release -p qanary-pq --test falcon` |
| FN-DSA-512 verification matches the known-answer test of `fn-dsa-vrfy` 0.4.0 | REPRODUCIBLE | same command, `fndsa512_upstream_kat` |
| Signatures made by `@noble/post-quantum` verify in the Rust cores and in all three Stylus programs | REPRODUCIBLE | `cargo test --release --workspace` (the `*_devsign` and `*_compressed` fixtures in `vectors/`) |
| The cores never panic on malformed input and never accept random or mutated signatures under fuzzing | REPRODUCIBLE | `cargo test --release -p qanary-pq --test fuzz` |
| The ladder ECDSA verifier agrees with python-ecdsa on 325 vectors (206 valid, 119 invalid) over secp160r1, P-192 and P-224 | REPRODUCIBLE | `cargo test --release -p qanary-curves`; vectors from `python scripts/gen_ladder_vectors.py` |
| Every Stylus program returns `0x024ad318` for a valid signature, `0xffffffff` for an invalid one and a typed error for malformed input | REPRODUCIBLE | `cargo test --release -p mldsa44-verifier -p mldsa65-verifier -p falcon512-verifier -p ladder-verifier` |
| The canary keys are nothing-up-my-sleeve points that nobody knows the private keys of | REPRODUCIBLE | `python scripts/nums.py`, then `git diff --ignore-cr-at-eol --exit-code` shows no change |
| An AWS KMS `ML_DSA_44` key signs the raw 32-byte hash in the format the verifiers accept | REPRODUCIBLE | `QANARY_KMS_KEY_ID=your_kms_key_id pnpm -r test` (needs AWS credentials) |

## Gas and size

The gas claims come from the measurements in [BENCHMARKS.md](BENCHMARKS.md), which has the full tables:

| Claim | Tag | Proof |
|---|---|---|
| Cached execution gas on Arbitrum Nitro, ArbOS 61: Falcon-512 35.6k, ML-DSA-44 109.5k, ML-DSA-65 166.3k (uncached 51.8k, 127.4k, 184.3k) | REPRODUCIBLE | The current build measures 34,727, 109,439 and 166,389 under `ARBOS_FORGE=/path/to/arbos-forge scripts/stylus-test.sh -vv`; on a dev node, deploy with `scripts/deploy-stylus.sh http://127.0.0.1:8547 devnode`, cache with `ArbWasmCache.cacheProgram` and `cast estimate` the call |
| Stylus is 18x (Falcon-512), 10.9x to 11.3x (ML-DSA-44) and 9.3x (ML-DSA-65) cheaper in execution gas than the cheapest Solidity verifiers, and 74x to 108x cheaper than their `main` branches | REPRODUCIBLE | The Solidity side: each ZKNox repository’s own `forge test` at the commit in BENCHMARKS.md, and `forge test --match-contract SolidityMLDSA44VerifierTest -vv` for Fireblocks |
| Live `verify` costs 207,646 (ML-DSA-44), 289,315 (ML-DSA-65) and 97,541 (Falcon-512) transaction gas on ApeChain, uncached | VERIFIED-LIVE | `cast estimate` command in BENCHMARKS.md, against the addresses in PROOF.md |
| The Solidity ML-DSA-44 verifier costs 1,236,247 gas per `verify` and 9,920,372 gas once per key | REPRODUCIBLE | `forge test --match-contract SolidityMLDSA44VerifierTest -vv` |
| Every Stylus program is under 18 KB of compressed WASM and fits one 24 KB fragment | VERIFIED-LIVE | `sizeBytes` in `deployments/apechain.json`; `scripts/stylus.sh contracts/stylus/<program> check` |
| The L1 data charge of an ML-DSA-44 `verify` on Arbitrum One was 7,682 L2 gas at block 511,108,146 | REPRODUCIBLE | `gasEstimateL1Component` command in BENCHMARKS.md (the figure moves with the L1 fee) |
| A Kernel user operation signed with ML-DSA-44 on Stylus costs about 270k gas; a 9-of-12 Safe with Falcon-512 owners about 500k | MODELED | Mock-verifier fork measurements plus measured verify gas, in BENCHMARKS.md |

## Accounts and modules

Account behaviour is tested against the real Kernel v3.3, EntryPoint, Safe and USDG deployments on an Arbitrum One fork (block 511,050,000; needs an archive RPC in `ARB_ONE_RPC`), and in unit, fuzz and invariant suites:

| Claim | Tag | Proof |
|---|---|---|
| A Kernel v3.3 account with `QuantumValidator` as root is deployed by its first user operation, and a tampered post-quantum signature fails with `AA24` | REPRODUCIBLE | `forge test --match-path 'test/fork/KernelFork.t.sol'` |
| The same flow runs on a public chain | VERIFIED-LIVE | pending: the end-to-end rows in PROOF.md |
| `validateUserOp` never reverts on a bad signature, a reverting verifier or an uninstalled account, and never validates a random signature | REPRODUCIBLE | `forge test --match-contract QuantumValidatorTest` (`testFuzz_randomSignatureNeverValidates`) |
| A precompile or a codeless address can never become an account’s verifier | REPRODUCIBLE | `forge test --match-test 'identityPrecompile\|precompileRange\|codeless'` |
| ERC-1271 signatures are bound to one account: the raw hash and a signature for another account with the same key are rejected | REPRODUCIBLE | `test_isValidSignatureWithSender_crossAccountReplay_invalid`, and `test_erc1271_pqSignatureThroughKernelWrapper` on the fork |
| Guardian approvals that were collected but not submitted die at the next rotation, guardian change, cancellation, recovery or reinstall | REPRODUCIBLE | `forge test --match-test invalidatesOutstandingApprovals` |
| An ECDSA-rooted Kernel account moves to a post-quantum root in one batch, after which ECDSA user operations, ECDSA ERC-1271 and the old owner’s direct calls all fail | REPRODUCIBLE | `test_upgradeInPlace_ecdsaRootToPqRoot` on the fork |
| The hot key moves at most `cap × bps / 10000` plus one window of refill of each tracked asset per window, and never moves an untracked asset | REPRODUCIBLE | `forge test --match-contract HotTierExecutorInvariantTest` (`invariant_windowOutflowBounded`, `invariant_untrackedNeverMoves`) |
| The hot key can never call an approval-class selector, the account, the executor or an installed module | REPRODUCIBLE | `forge test --match-contract HotTierExecutorTest` |
| A hot transfer over the cap reverts with `CapExceeded`, on the fork and on a public chain | REPRODUCIBLE, VERIFIED-LIVE | `test_hotTier_overCap_reverts`; PROOF.md row "Hot-key transfer over the cap" (pending until recorded) |
| After a K1 claim, the ECDSA hot key is refused with `ClassicalFamilyBroken` | REPRODUCIBLE, VERIFIED-LIVE | `test_familyBroken_killsHotTier`; PROOF.md row "Hot-key transfer after the trip" (pending until recorded) |
| A Safe 1.3.0 shaped like the Arbitrum Security Council (9 of 12) executes with 9 post-quantum owner signatures after its 12 owners are swapped for `PQSafeOwner`s | REPRODUCIBLE | `forge test --match-path 'test/fork/SafeCouncilFork.t.sol'`. A fork simulation with a mock verifier; nothing touches the real council |
| OpenZeppelin accounts use a Stylus verifier as their ERC-7913 signer, with no module | REPRODUCIBLE | `forge test --match-path 'test/fork/OzAccountFork.t.sol'`, and `test_qanaryAccount_mldsa44Inline_validateUserOp` under arbos-forge |
| The Solidity verifier’s call tree contains no opcode ERC-7562 bans during validation | REPRODUCIBLE | `forge test --match-test test_erc7562_verifyPathHasNoBannedOpcodes` |
| A public ERC-4337 bundler accepts the post-quantum user operations | VERIFIED-LIVE | pending: `e2e.sdk.bundler` in `deployments/<network>.json` names the bundler of a recorded run |

## Tripwire registry

The registry’s tests cover claim binding, monotonicity and payout liveness:

| Claim | Tag | Proof |
|---|---|---|
| A claim is bound to the chain, the registry, the target and the claimant: a front-run copy and a proof for another chain or registry revert | REPRODUCIBLE | `forge test --match-test 'test_claim_frontRunByOtherSender_reverts\|test_claim_proofForOther'` |
| The classic free-digest ECDSA forgery (`e ≡ 0`, `r = s = Qx`) cannot claim | REPRODUCIBLE | `test_claim_zeroDigestForgery_rejected` |
| The threat level never decreases and nobody can lower it | REPRODUCIBLE | `testFuzz_claim_levelNeverDecreases`, `invariant_levelMonotonic`; the contract has no owner |
| A paused, blacklisting or reverting bounty token, or a claimant that rejects ETH, cannot block the signal | REPRODUCIBLE | `forge test --match-test signalStands` |
| A non-drill registry accepts only the nothing-up-my-sleeve keys | REPRODUCIBLE | `test_constructor_nonDrillRequiresNumsTargets` |
| A drill claim on a public chain raises the drill registry’s level | VERIFIED-LIVE | pending: PROOF.md row "Drill tripwire claim" |

## Deployments

The live deployment rows come from `deployments/<network>.json`:

| Claim | Tag | Proof |
|---|---|---|
| The ML-DSA-44, ML-DSA-65, Falcon-512 and ladder verifiers are deployed and activated on ApeChain mainnet, and return `0x024ad318` for the repository’s fixtures | VERIFIED-LIVE | [PROOF.md](PROOF.md) explorer links; `ArbWasm.programVersion` and `verify` calls listed there |
| The deployed programs are byte-for-byte the code in this repository | REPRODUCIBLE | `scripts/stylus.sh contracts/stylus/<program> verify --endpoint <rpc> --deployment-tx <deployTx> --no-verify` with the `deployTx` from the deployment file (Docker, pinned image) |
| The Arbitrum Security Council paused new Stylus activations on Arbitrum One on 2 October 2026 | VERIFIED-LIVE | [Arbitrum One transaction](https://arbiscan.io/tx/0x9eb3a4be3ba777f9fc82250eddc10f8356731cc97c09a70801d30ce33322c652) (block 511,026,298); [announcement](https://forum.arbitrum.foundation/t/security-council-emergency-action-2-10-2026/31530) |
| Arbitrum One runs the module stack on the Solidity ML-DSA-44 verifier | VERIFIED-LIVE | pending: the Arbitrum One section of PROOF.md |

## Context figures

These figures come from third parties and Qanary did not measure them. Each links to its primary source:

| Claim | Tag | Source |
|---|---|---|
| More than 65% of ether sits in accounts whose public keys are on-chain | VERIFIED-LIVE | [Project Eleven 2026 report](https://report.projecteleven.com/); [Deloitte](https://www.deloitte.com/nl/en/services/consulting-risk/perspectives/quantum-risk-to-the-ethereum-blockchain.html) |
| About 6.9 million BTC sit in exposed outputs | VERIFIED-LIVE | [Project Eleven 2026 report](https://report.projecteleven.com/) |
| Singapore’s CSA asks critical-infrastructure owners for migration plans by 31 March 2027 and quantum-safe new systems from 1 January 2028, and names ML-DSA | VERIFIED-LIVE | [CSA Quantum-Safe Handbook](https://www.csa.gov.sg/resources/publications/quantum-safe-handbook-and-quantum-readiness-index/) |
| MAS aims for financial institutions to achieve quantum resilience before the end of this decade | VERIFIED-LIVE | [MAS, 28 July 2026](https://www.mas.gov.sg/news/speeches/2026/md-remarks-for-mas-ar-2025-2026) |
| NIST’s draft transition guidance disallows ECDSA at 128-bit strength after 2035 | VERIFIED-LIVE | [NIST IR 8547 ipd](https://csrc.nist.gov/pubs/ir/8547/ipd) |
| US Executive Order 14412 sets 31 December 2031 for post-quantum signatures in high-value federal systems | VERIFIED-LIVE | [EO 14412](https://www.presidency.ucsb.edu/documents/executive-order-14412-securing-the-nation-against-advanced-cryptographic-attacks) |
| Arbitrum has no post-quantum precompile live or proposed; EIP-8051 and EIP-8052 are drafts | VERIFIED-LIVE | [Tectonic quantum tracker](https://github.com/tectonic-labs/quantum-tracker-data/blob/main/chains/l2/arbitrum-one.md); [EIP-8051](https://eips.ethereum.org/EIPS/eip-8051); [EIP-8052](https://eips.ethereum.org/EIPS/eip-8052) |

## Prior art

Qanary builds on published work. Each project below did part of this before:

- **[multivmlabs/pq-smart-wallet](https://github.com/multivmlabs/pq-smart-wallet)**: a Stylus ML-DSA-65 verifier with an ERC-7579 validator for Kernel v3, measured on a local Nitro dev node with the bundler’s ERC-7562 checks turned off
- **[Vib-UX/nexora](https://github.com/Vib-UX/nexora)**: a Falcon-512 verifier and a hybrid ECDSA and post-quantum account written in Stylus, run on a private Orbit dev chain
- **ZKNox ([ETHFALCON](https://github.com/ZKNoxHQ/ETHFALCON), [ETHDILITHIUM](https://github.com/ZKNoxHQ/ETHDILITHIUM), [Kohaku `pq-account`](https://github.com/ethereum/kohaku/tree/master/packages/pq-account))**: the reference Solidity Falcon and ML-DSA verifiers, hybrid ERC-4337 accounts on Arbitrum Sepolia, and the EIP-8051 and EIP-8052 precompile drafts. Qanary’s Solidity baselines are their code
- **[fireblocks-labs/evm-ml-dsa-verifier](https://github.com/fireblocks-labs/evm-ml-dsa-verifier)**: a FIPS 204 ML-DSA-44 Solidity verifier at about 1.23M gas. Qanary vendors its core (MIT) as the Arbitrum One fallback
- **[ZK-ACE](https://github.com/zkace/quantum-resistance)**: a post-quantum account that proves knowledge of an identity secret with a STARK instead of a signature, live on Arbitrum One at about 5.3M gas per user operation
- **Justin Drake, [Cryptographic canaries and backups](https://ethresear.ch/t/cryptographic-canaries-and-backups/1235) (2018)**: a bounty on a nothing-up-my-sleeve key that contracts listen to and switch to a backup when it is claimed
- **[nikojpapa/ethereum-quantum-bounty](https://github.com/nikojpapa/ethereum-quantum-bounty)**: an ERC-4337 account that adds Lamport signatures once a quantum bounty is solved, on Sepolia

## What Qanary adds

Against that prior work, these parts are specific to Qanary:

- NIST-exact verifiers for ML-DSA-44, ML-DSA-65 and Falcon-512 (plus the FN-DSA draft) as ERC-7913 Stylus programs that take raw NIST encodings, so AWS KMS and `@noble/post-quantum` signatures verify unchanged
- Programs deployed and activated on a public Arbitrum chain, with reproducible builds checked against the deployment transactions
- One verifier interface used by three account families: Kernel v3.3 through an ERC-7579 validator, Safe through ERC-1271 contract owners, and OpenZeppelin accounts as a native ERC-7913 signer, with validation shaped for ERC-7562
- A classical hot tier with no user-operation or ERC-1271 power, net-outflow leaky-bucket caps and hard denials for approvals and module calls
- A shared, ownerless tripwire registry with a ladder of short-curve targets verified in Stylus, read by every account that opts in, each with its own response per level
- A Solidity ML-DSA-44 fallback that computes the expanded key on-chain and binds it to the raw public key, which published Solidity ML-DSA verifiers leave to an off-chain step

## Not claimed

Qanary does not claim any of the following:

- Being the first post-quantum wallet on Arbitrum or the first Stylus post-quantum verifier: the prior art above came first
- FIPS 206 compliance: FIPS 206 is unpublished; scheme 4 is NIST round-3 Falcon and scheme 1 follows a draft
- Protection of the rollup itself: the sequencer, batch posting, validators, the bridge and Security Council keys use ECDSA
- That the tripwire stops a thief who breaks a key and never claims: it bounds hot-tier loss, and cold funds rely on the post-quantum root
- That a ladder claim on L1 or L2 proves a quantum computer exists: those curves can fall to classical computation
- That an EIP-7702 delegated EOA is post-quantum safe: its ECDSA key stays valid
- That browser-held keys are HSM-grade
- An external audit: none has been completed (see [SECURITY.md](SECURITY.md))
- Any address or transaction that is not in a deployment record: such rows show pending
