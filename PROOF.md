<!-- Rendered by scripts/render-proof.ts from deployments/*.json. Do not edit by hand. -->

# Proof of deployment

This page lists every Qanary contract and end-to-end transaction on a public chain, with explorer links. It is rendered from `deployments/<network>.json`; a row marked pending has no deployment record yet. To render it again, run `pnpm proof`.

To check a Stylus verifier yourself, ask ArbWasm for its program version and call `verify` with a fixture from `vectors/`:

```bash
RPC=https://rpc.apechain.com/http
V=0x38Fc3687363F1A69cc7B07b79F54DeBF885f23e1
cast call -r $RPC 0x0000000000000000000000000000000000000071 \
  "programVersion(address)(uint16)" $V
cast call -r $RPC $V "verify(bytes,bytes32,bytes)(bytes4)" \
  0x02$(cat vectors/mldsa44.pk) 0x$(cat vectors/mldsa44.msg) \
  0x$(cat vectors/mldsa44.sig)
```

A valid signature returns `0x024ad318`. Flip any byte of the signature or the message and the same call returns `0xffffffff`.

## ApeChain

Chain id 33139. An Arbitrum Orbit L3 that settles to Arbitrum One; it runs the Stylus verifiers and the full module stack.

Recorded in `deployments/apechain.json`: ArbOS 51, Stylus v2, deployer [`0xe46b3a14790f6fb24B0067475FC4C5875d1233cA`](https://apescan.io/address/0xe46b3a14790f6fb24B0067475FC4C5875d1233cA).

| Contract | Address | Transactions | Notes |
|---|---|---|---|
| ML-DSA-44 verifier (Stylus) | [`0x38Fc3687363F1A69cc7B07b79F54DeBF885f23e1`](https://apescan.io/address/0x38Fc3687363F1A69cc7B07b79F54DeBF885f23e1) | deploy [`0xa0dc…069a`](https://apescan.io/tx/0xa0dc679c19606a321b767e0d258dd8a8564ac8475827d6baf5f335ac82d5069a)<br>activate [`0x2c5e…3993`](https://apescan.io/tx/0x2c5e12291ba8f81d2972754479724cebffbc864cacc55a98da7e1c6667743993) | live `verify` → `0x024ad318`, 207,646 gas, 15,933 B, Stylus v2 |
| ML-DSA-65 verifier (Stylus) | [`0x187551ed28f6a105953aABb163AF6cd53f75C197`](https://apescan.io/address/0x187551ed28f6a105953aABb163AF6cd53f75C197) | deploy [`0x977c…da50`](https://apescan.io/tx/0x977c491e9b2053c376743f84ef3b483c0a505c06b52e592191be4643d9ddda50)<br>activate [`0x4b4e…2951`](https://apescan.io/tx/0x4b4ed446e226f5858913de2798c9b608ae99f15467c291f3b90df29cbddf2951) | live `verify` → `0x024ad318`, 289,315 gas, 15,885 B, Stylus v2 |
| Falcon-512 verifier (Stylus) | [`0x051736a3cD6AC6eA5Bc062E0B964eA6279f7cbA3`](https://apescan.io/address/0x051736a3cD6AC6eA5Bc062E0B964eA6279f7cbA3) | deploy [`0x6d5a…be15`](https://apescan.io/tx/0x6d5a795272dac75956373f19b3218bd2872557994c9706e2a5f9458dbff0be15)<br>activate [`0x7775…4b70`](https://apescan.io/tx/0x777566fb63116846c3fa3d41aa6462c3ab94515175325a2cc0ef2ebe5efb4b70) | live `verify` → `0x024ad318`, 97,541 gas, 17,166 B, Stylus v2 |
| Ladder ECDSA verifier (Stylus) | [`0x7DEAe8711B07004017CcAFd71b64F3b944E8DC4F`](https://apescan.io/address/0x7DEAe8711B07004017CcAFd71b64F3b944E8DC4F) | deploy [`0x18ce…8934`](https://apescan.io/tx/0x18cec8d5827132b51d012764caf8e53e79b19487186f110cd2aad92a03218934)<br>activate [`0x8c26…2916`](https://apescan.io/tx/0x8c267e1b446938252bbb194de47b19c0be419bf0f0fb2453890e7d3be9c42916) | live `verify` → `true`, 828,518 / 959,401 / 1,152,888 gas by curve, 16,546 B, Stylus v2 |
| KeyStore | pending | | |
| QuantumValidator | pending | | |
| HotTierExecutor | pending | | |
| QuantumCanaryRegistry | pending | | |
| DrillRegistryFactory | pending | | |
| PQSafeOwnerFactory | pending | | |
| QanaryAccountFactory | pending | | |

### ApeChain: end-to-end transactions

| Step | Transaction or address |
|---|---|
| Treasury account (Kernel v3.3, ML-DSA-44 root) | pending |
| Account deployed by its first post-quantum signed user operation | pending |
| Hot-key transfer inside the cap | pending |
| Hot-key transfer over the cap, reverted (`CapExceeded`) | pending |
| Drill tripwire claim marks secp256k1 broken | pending |
| Hot-key transfer after the trip, reverted (`ClassicalFamilyBroken`) | pending |
| Treasury account with an AWS KMS ML-DSA-44 root | pending |
| User operation signed by the AWS KMS key | pending |
| Drill registry created | pending |

## Arbitrum One

Chain id 42161. It runs the full module stack on the Solidity ML-DSA-44 verifier while Stylus activations are paused.

No `deployments/arbitrum-one.json` yet: every row below is pending.

| Contract | Address | Transactions | Notes |
|---|---|---|---|
| ML-DSA-44 verifier (Solidity) | pending | | |
| KeyStore | pending | | |
| QuantumValidator | pending | | |
| HotTierExecutor | pending | | |
| QuantumCanaryRegistry | pending | | |
| DrillRegistryFactory | pending | | |
| PQSafeOwnerFactory | pending | | |
| QanaryAccountFactory | pending | | |

### Arbitrum One: end-to-end transactions

| Step | Transaction or address |
|---|---|
| Treasury account (Kernel v3.3, ML-DSA-44 root) | pending |
| Account deployed by its first post-quantum signed user operation | pending |
| Hot-key transfer inside the cap | pending |
| Hot-key transfer over the cap, reverted (`CapExceeded`) | pending |
| Drill tripwire claim marks secp256k1 broken | pending |
| Hot-key transfer after the trip, reverted (`ClassicalFamilyBroken`) | pending |
| Treasury account with an AWS KMS ML-DSA-44 root | pending |
| User operation signed by the AWS KMS key | pending |
| Drill registry created | pending |

## ApeChain Curtis (testnet)

Chain id 33111. ApeChain’s testnet, used to rehearse the Stylus deployment.

Recorded in `deployments/apechain-curtis.json`: ArbOS 32, Stylus v2, deployer [`0xe46b3a14790f6fb24B0067475FC4C5875d1233cA`](https://curtis.apescan.io/address/0xe46b3a14790f6fb24B0067475FC4C5875d1233cA).

| Contract | Address | Transactions | Notes |
|---|---|---|---|
| ML-DSA-44 verifier (Stylus) | [`0x38Fc3687363F1A69cc7B07b79F54DeBF885f23e1`](https://curtis.apescan.io/address/0x38Fc3687363F1A69cc7B07b79F54DeBF885f23e1) | deploy [`0xee21…d236`](https://curtis.apescan.io/tx/0xee215e4aedea7eff1c3e800302cde17fa900fd8319557b06d2ba899d5860d236)<br>activate [`0x3077…e8f5`](https://curtis.apescan.io/tx/0x307713de90d035c5a141e0bdb13b0e985e1a5fdfaaf342728d7859f51eace8f5) | live `verify` → `0x024ad318`, 207,519 gas, 15,933 B, Stylus v2 |

## Why Arbitrum One runs the Solidity verifier

On 2 October 2026 the Arbitrum Security Council paused new Stylus activations on Arbitrum One and Nova. Programs that were already active keep running; new programs cannot be activated until the setting is reverted.

| Evidence | Link |
|---|---|
| Arbitrum One transaction that sets the WASM activation gas to `u64::MAX` | [`0x9eb3…c652`](https://arbiscan.io/tx/0x9eb3a4be3ba777f9fc82250eddc10f8356731cc97c09a70801d30ce33322c652) |
| Arbitrum Sepolia transaction, same change | [`0x123e…745b`](https://sepolia.arbiscan.io/tx/0x123ec40e38c2e9c51741c767d06fcbabd92c7d2ac40db242bcaeb193ed20745b) |
| Security Council announcement | [Security Council Emergency Action 2-10-2026](https://forum.arbitrum.foundation/t/security-council-emergency-action-2-10-2026/31530) |
