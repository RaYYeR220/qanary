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
| KeyStore | [`0x12cF4EE4073d5F3E5DE8bFE6e34522cEb46854f6`](https://apescan.io/address/0x12cF4EE4073d5F3E5DE8bFE6e34522cEb46854f6) | deploy [`0x4611…c352`](https://apescan.io/tx/0x4611a987cc91ade2b43f003ecfd183cb4ecf44cf18cfe8092d78ec075515c352) |  |
| QuantumValidator | [`0x0057Fcac28c7094910D563Ad31E437d78a92036a`](https://apescan.io/address/0x0057Fcac28c7094910D563Ad31E437d78a92036a) | deploy [`0x83a6…7844`](https://apescan.io/tx/0x83a662a96d012536fccc04e10fc3b6c42a627edf82508e39a3a5fad080737844) |  |
| HotTierExecutor | [`0xE5A6EFCEAcdBFe96593f01F7770C1163B0C631f3`](https://apescan.io/address/0xE5A6EFCEAcdBFe96593f01F7770C1163B0C631f3) | deploy [`0xb4e1…326a`](https://apescan.io/tx/0xb4e1bbb147a1a4311fc1aa3d693f33be2ef8120c39c89995bf684170a15b326a) |  |
| QuantumCanaryRegistry | [`0x4848512a663F59fA23708C1Fa2f1cEA21B888A95`](https://apescan.io/address/0x4848512a663F59fA23708C1Fa2f1cEA21B888A95) | deploy [`0xe9f1…7aa8`](https://apescan.io/tx/0xe9f18e0a017f13a122ba54cc70a4db001eaf3cbbd1cffe6d50df7a1e5bd37aa8) |  |
| DrillRegistryFactory | [`0xA523899D17954a5BeE0Ee102124C458942878032`](https://apescan.io/address/0xA523899D17954a5BeE0Ee102124C458942878032) | deploy [`0x5279…4bd7`](https://apescan.io/tx/0x527999314b7514692ada5c45ee3a6bed93bbdae59b9c8d9a6de9cf82f4d34bd7) |  |
| PQSafeOwnerFactory | [`0x4Ce066c253d38bFF3012607B0D3B1B4b8E29ABA3`](https://apescan.io/address/0x4Ce066c253d38bFF3012607B0D3B1B4b8E29ABA3) | deploy [`0x0e5b…7362`](https://apescan.io/tx/0x0e5bba76af71954f43de042f53ff2078c94e60df3a79776b1035a73449977362) |  |
| QanaryAccountFactory | [`0xdbEEAA8CC79A925b42A5F42f3F1bA81afC132609`](https://apescan.io/address/0xdbEEAA8CC79A925b42A5F42f3F1bA81afC132609) | deploy [`0xff92…68fe`](https://apescan.io/tx/0xff925afb3b695beb2117c4100982af3d1b18b62e61636efd4383c182be5c68fe) |  |

### ApeChain: end-to-end transactions

| Step | Transaction or address |
|---|---|
| Treasury account (Kernel v3.3) whose root key is an AWS KMS ML-DSA-44 key | [`0x32D09d174725388116C3fB997262AA0D3944A958`](https://apescan.io/address/0x32D09d174725388116C3fB997262AA0D3944A958) |
| Root key stored in the KeyStore | [`0x3e14…86e8`](https://apescan.io/tx/0x3e144806b0d5807e34cbb2b1a2591b0c0f59d2fb686ea96564a5b7e7cb1886e8) |
| Account deployed by its first post-quantum signed user operation | [`0x8191…5801`](https://apescan.io/tx/0x819119f9af3b4f684fd46be95f7b32b4f435285a53f0cf29d79d0c6910015801) |
| Native transfer signed by the post-quantum root key | [`0xc60a…4f2e`](https://apescan.io/tx/0xc60a9ac330f5417e156d5c75e2754aad7bc573bedc0e5c42a41b27542a614f2e) |
| Hot tier installed by a root user operation | [`0xb732…0a9c`](https://apescan.io/tx/0xb732c41ac6fcf17e22cf39ea5d371dd9a20b7debe236b998666ad78a16740a9c) |
| Hot-key transfer inside the cap | [`0x16b8…68f3`](https://apescan.io/tx/0x16b86ab6745cbfd03e0dfc6fdfc26f54e0434a9741fb5af5bfcbc17ee8b368f3) |
| Hot-key transfer over the cap, reverted (`CapExceeded`) | [`0x95f5…5db4`](https://apescan.io/tx/0x95f55ce2439bba0f8c20696874a71893c855bc46dd4da6f1958c208930545db4) |
| Tampered post-quantum signature, reverted (`AA24 signature error`) | [`0x28bf…51db`](https://apescan.io/tx/0x28bfb6b686a638660a23fea20e7267dcc03c4ee36e0a7fac022cdd4d546351db) |
| Drill registry created | [`0x448b…222a`](https://apescan.io/tx/0x448be332520746d968ce427044340ebf3c3127df9ef0071b8bfd7710abbb222a) |
| Hot tier re-pointed at the drill registry by a root user operation | [`0xf0d4…7bfe`](https://apescan.io/tx/0xf0d476e1ee7d109c11af52bd94b7ed4e7c4e02af961cd60b79b1fd9ff46d7bfe) |
| Ladder rung L1 (secp160r1) claimed through the Stylus ladder verifier | [`0x5eb5…8b83`](https://apescan.io/tx/0x5eb595c6f188135e43c0d914c96a7e9d2708d8d4ce0ae33b92afa9bd210a8b83) |
| Drill tripwire claim marks secp256k1 broken | [`0x417d…13bd`](https://apescan.io/tx/0x417d49ae8e07749155f85003995adf34282d47c62aede8cdb91d99cb923813bd) |
| Hot-key transfer after the trip, reverted (`ClassicalFamilyBroken`) | [`0x4540…d3ad`](https://apescan.io/tx/0x45404f06fc5c1a284f332d517760dcec0bd09fdc0f72ca7a319a4d68fe8ad3ad) |
| ERC-1271 `isValidSignature` through Kernel (eth_call) | `0x1626ba7e` |
| Account with an ML-DSA-44 root from a mnemonic | [`0x399Cc157a748E0a48fDabFCc176fB818e8b32B6c`](https://apescan.io/address/0x399Cc157a748E0a48fDabFCc176fB818e8b32B6c) |
| Its first user operation (deploys it and transfers) | [`0xa9e7…903b`](https://apescan.io/tx/0xa9e7a1f8535315c006c7223b96363a6363d8fec13e3257407f03f2da727e903b) |
| Account with a Falcon-512 root | [`0xcF36878841001225392edcbe1d2d18f5d0b90AC4`](https://apescan.io/address/0xcF36878841001225392edcbe1d2d18f5d0b90AC4) |
| Its first user operation (deploys it and transfers) | [`0xbfc7…1fba`](https://apescan.io/tx/0xbfc7de527f0bcd019e7a4655db34decd6870473a4756dca52d5c464fa63f1fba) |
| `rootKey` | `aws-kms-ml-dsa-44` |
| `rootKeyPointer` | [`0xdb5CE807C92901e2a08ad2Eb6f231e3123889B5C`](https://apescan.io/address/0xdb5CE807C92901e2a08ad2Eb6f231e3123889B5C) |
| `fundAccountTx` | [`0x38a4…eb0a`](https://apescan.io/tx/0x38a4e788bbe2814d28c5e2fb4adcef19b2d880b816a992980d925a229ec3eb0a) |
| `hotKey` | [`0x1843da7839e800b01241be694dA2AE7695D00AEb`](https://apescan.io/address/0x1843da7839e800b01241be694dA2AE7695D00AEb) |
| `hotCapWei` | `2000000000000000` |
| `hotOverCapError` | `CapExceeded(0x0000000000000000000000000000000000000000, 2000000000000001, 1000000000000000)` |
| `tamperedSigError` | `FailedOp(0, AA24 signature error)` |
| `drillRegistry` | [`0xd73Eb697C4762AC8a8ED01dFb6db0C2b8e80B0C0`](https://apescan.io/address/0xd73Eb697C4762AC8a8ED01dFb6db0C2b8e80B0C0) |
| `effectiveBpsBeforeTrip` | `10000` |
| `ladderLevelAfterL1` | `1` |
| `effectiveBpsAfterL1` | `5000` |
| `ladderLevelAfterTrip` | `3` |
| `effectiveBpsAfterTrip` | `0` |
| `postTripError` | `ClassicalFamilyBroken(0)` |
| `erc1271Hash` | `0x6625d9660fd3d7c9d1122aefd96b751ac0493a956cb8a6045ef74fb70fac0ffd` |
| `erc1271OtherHashResult` | `0xffffffff` |
| `mnemonicKeyPointer` | [`0xE913AaC996B4A14049D37a1C652470877917F985`](https://apescan.io/address/0xE913AaC996B4A14049D37a1C652470877917F985) |
| `mnemonicStoreKeyTx` | [`0x5c78…209d`](https://apescan.io/tx/0x5c78b4344dfffa12e25de67b0a5d42af12dc9c7b54263e34e0523c816d38209d) |
| `mnemonicFundTx` | [`0xe305…db3d`](https://apescan.io/tx/0xe30537bf1c37b9b83f0d823da3af0bc30d51cff977bc38b8dfedd53f8eafdb3d) |
| `falconKeyPointer` | [`0xD8e7227Fca1F866f29Eed1D36cbc265BBd69e341`](https://apescan.io/address/0xD8e7227Fca1F866f29Eed1D36cbc265BBd69e341) |
| `falconStoreKeyTx` | [`0xa819…1685`](https://apescan.io/tx/0xa81905474d181a09a65541cb8329fca4d68844483818e35c19cad71a25fe1685) |
| `falconFundTx` | [`0xb0b8…da52`](https://apescan.io/tx/0xb0b871cd5c64b4e84029f527e379672fc037df5167b12d7a16e271303f68da52) |

## Arbitrum One

Chain id 42161. It runs the full module stack on the Solidity ML-DSA-44 verifier while Stylus activations are paused.

Recorded in `deployments/arbitrum-one.json`: deployer [`0xe46b3a14790f6fb24B0067475FC4C5875d1233cA`](https://arbiscan.io/address/0xe46b3a14790f6fb24B0067475FC4C5875d1233cA).

| Contract | Address | Transactions | Notes |
|---|---|---|---|
| ML-DSA-44 verifier (Solidity) | [`0xc9C7B3B71f4A3451adeb29604bd8eA789F3F2EfE`](https://arbiscan.io/address/0xc9C7B3B71f4A3451adeb29604bd8eA789F3F2EfE) | deploy [`0xe9ae…cc75`](https://arbiscan.io/tx/0xe9aedfd48a270a5b90bd12e0ec3e93ab8083c4dd46b6a2ae4d2ba4bde617cc75) |  |
| KeyStore | [`0x12cF4EE4073d5F3E5DE8bFE6e34522cEb46854f6`](https://arbiscan.io/address/0x12cF4EE4073d5F3E5DE8bFE6e34522cEb46854f6) | deploy [`0x1657…b2ec`](https://arbiscan.io/tx/0x1657bf58ef5b7d94216f0740ccebaf1848165ce2ab3e3e0789e19cc1bd75b2ec) |  |
| QuantumValidator | [`0x0057Fcac28c7094910D563Ad31E437d78a92036a`](https://arbiscan.io/address/0x0057Fcac28c7094910D563Ad31E437d78a92036a) | deploy [`0x7cd5…8c2a`](https://arbiscan.io/tx/0x7cd5248e26f893620a1c3786d8dd458d9ba29825591e0d8ac4b3d61f1e8a8c2a) |  |
| HotTierExecutor | [`0xE5A6EFCEAcdBFe96593f01F7770C1163B0C631f3`](https://arbiscan.io/address/0xE5A6EFCEAcdBFe96593f01F7770C1163B0C631f3) | deploy [`0x5762…b94e`](https://arbiscan.io/tx/0x5762ff05a3e7be175d666fce3feddfafcbde59e4fa886256facee11295c9b94e) |  |
| QuantumCanaryRegistry | [`0x4848512a663F59fA23708C1Fa2f1cEA21B888A95`](https://arbiscan.io/address/0x4848512a663F59fA23708C1Fa2f1cEA21B888A95) | deploy [`0xa06f…a317`](https://arbiscan.io/tx/0xa06ff3f26b825011c495d1c7966de5262e796c7a84ebeb99e49863e991c6a317) |  |
| DrillRegistryFactory | [`0xA523899D17954a5BeE0Ee102124C458942878032`](https://arbiscan.io/address/0xA523899D17954a5BeE0Ee102124C458942878032) | deploy [`0xf13f…1981`](https://arbiscan.io/tx/0xf13fdc9f34544eaf4f9a28d23cde66bf3fa5f9774a9b8665a8db3d4fde581981) |  |
| PQSafeOwnerFactory | [`0x4Ce066c253d38bFF3012607B0D3B1B4b8E29ABA3`](https://arbiscan.io/address/0x4Ce066c253d38bFF3012607B0D3B1B4b8E29ABA3) | deploy [`0x2480…f5e9`](https://arbiscan.io/tx/0x248003b7299f22858a5567c6d4c96dcb7fea2d10a5b790a3b0aad88eb2acf5e9) |  |
| QanaryAccountFactory | [`0xdbEEAA8CC79A925b42A5F42f3F1bA81afC132609`](https://arbiscan.io/address/0xdbEEAA8CC79A925b42A5F42f3F1bA81afC132609) | deploy [`0x853d…f398`](https://arbiscan.io/tx/0x853da640345e70ffbbed1a9361bcade614695357fd932812e4b2ff70fa11f398) |  |
| `ladderUnavailable` | [`0xBf33F4FE6D73fEcDE03E388f4FE985fe1d88b9D6`](https://arbiscan.io/address/0xBf33F4FE6D73fEcDE03E388f4FE985fe1d88b9D6) | deploy [`0xb37e…aad0`](https://arbiscan.io/tx/0xb37e0ef2feec4e4def108acf0cd8ce80f4e0319c68a65f89d0269f6a7056aad0) |  |
| `keccakF1600Helper` | [`0x68b5C1b28707AC3201880d59f27cFc6583D4FF8D`](https://arbiscan.io/address/0x68b5C1b28707AC3201880d59f27cFc6583D4FF8D) | deploy [`0x1397…bec2`](https://arbiscan.io/tx/0x1397a42d94b7037343b6651bffb64e9e8a6d2c7de1dd13ee20a2451a868abec2) |  |
| `mldsa44VerifierCore` | [`0xf2d5c07ae3817B8bbDf57970369a6604377e588E`](https://arbiscan.io/address/0xf2d5c07ae3817B8bbDf57970369a6604377e588E) | deploy [`0x1711…95ab`](https://arbiscan.io/tx/0x17118eb2a6351c0bfd960d4b7675442b2bbb5384e74f5181c3e6c7c313e395ab) |  |
| `mldsa44ExpandedKeyStore` | [`0x49fdfaCaf748cbe2F9adb4cAeE50F87582CEf8f5`](https://arbiscan.io/address/0x49fdfaCaf748cbe2F9adb4cAeE50F87582CEf8f5) | deploy [`0x671a…4a02`](https://arbiscan.io/tx/0x671ac654e13d58762241f27eadafb38821325421de65bcc8d4b00b73b1ce4a02) |  |

### Arbitrum One: end-to-end transactions

| Step | Transaction or address |
|---|---|
| Treasury account (Kernel v3.3) whose root key is an AWS KMS ML-DSA-44 key | [`0xA3d2E874C2643B53b166DCB94073A7AD621BEbEe`](https://arbiscan.io/address/0xA3d2E874C2643B53b166DCB94073A7AD621BEbEe) |
| Root key stored in the KeyStore | [`0xc523…f5b8`](https://arbiscan.io/tx/0xc523e78ac3248664fc5d89dc215f3942851df258552b856ef4d4d2e07f33f5b8) |
| Root key expanded on-chain for the Solidity verifier (once per key) | [`0x0fb1…20bd`](https://arbiscan.io/tx/0x0fb1bbaae742df92c9b2428ff07fdad036a5dd4be7bd3144794ed6b3244d20bd) |
| Account deployed by its first post-quantum signed user operation | [`0x0b98…6d0c`](https://arbiscan.io/tx/0x0b989fed5457af04e827e254f9afae443d411efeb80baa575c89360fb95d6d0c) |
| Native transfer signed by the post-quantum root key | [`0xa1f7…d821`](https://arbiscan.io/tx/0xa1f717c83ee25aad554aac6b33fc4e5a868c8e8386d594ec464c9ab6182cd821) |
| Hot tier installed by a root user operation | [`0xb6c8…fc60`](https://arbiscan.io/tx/0xb6c838feb81a0d98f8d746909b4835491b4bc65b9464f88debc53d1ab3defc60) |
| Hot-key transfer inside the cap | [`0x8e90…0a82`](https://arbiscan.io/tx/0x8e9069521f3cdf405b59ad37aaab0d442ce0c61c8ba5575e6b0c141697910a82) |
| Hot-key transfer over the cap, reverted (`CapExceeded`) | [`0xe2b4…d1dd`](https://arbiscan.io/tx/0xe2b477f0c523117b83aababbd3cc2d1688105bc1cc5a138428774bee975fd1dd) |
| Tampered post-quantum signature, reverted (`AA24 signature error`) | [`0x601c…a41b`](https://arbiscan.io/tx/0x601c02aaa9be012cd633c44ac7da30a151febe337f7b22461946b19f9e0ba41b) |
| Drill registry created | [`0xbc2f…01fd`](https://arbiscan.io/tx/0xbc2fd75b891fc886042b304cdaa70ce8d632fe380ed6812708c2c4e5fbda01fd) |
| Hot tier re-pointed at the drill registry by a root user operation | [`0x082f…9cd6`](https://arbiscan.io/tx/0x082ff00cd140d6355058b439cd3f77203e3939502a33c5b7a5d18f51a79a9cd6) |
| Ladder rung L1 claim fails closed (`LadderUnavailable`) | [`0x7d45…f7c4`](https://arbiscan.io/tx/0x7d453419b345b764ab3d58b8a02f50a9ec2bf4c75493a6bcc6aff6e89e4bf7c4) |
| Drill tripwire claim marks secp256k1 broken | [`0x08f2…5ceb`](https://arbiscan.io/tx/0x08f2ff7868afa9b8dd6c04ed91640867b18214e8696a3dd0d2c62b322bd75ceb) |
| Hot-key transfer after the trip, reverted (`ClassicalFamilyBroken`) | [`0xab82…0bd6`](https://arbiscan.io/tx/0xab822abc17b0c02edc4b1396a1b3e2c726fbecede7670d8c6068d48bb8bf0bd6) |
| ERC-1271 `isValidSignature` through Kernel (eth_call) | `0x1626ba7e` |
| `rootKey` | `aws-kms-ml-dsa-44` |
| `rootKeyPointer` | [`0xdb5CE807C92901e2a08ad2Eb6f231e3123889B5C`](https://arbiscan.io/address/0xdb5CE807C92901e2a08ad2Eb6f231e3123889B5C) |
| `fundAccountTx` | [`0x1e4c…4ece`](https://arbiscan.io/tx/0x1e4c75a813e8de0e7511961c7b1222e7e1ee0ee90d7bde34bac0d6eccf934ece) |
| `hotKey` | [`0x6af103367E898049c59BE75b336eE04Bb7CEDdeC`](https://arbiscan.io/address/0x6af103367E898049c59BE75b336eE04Bb7CEDdeC) |
| `hotCapWei` | `2000000000000` |
| `hotOverCapError` | `CapExceeded(0x0000000000000000000000000000000000000000, 2000000000001, 1000555555555)` |
| `tamperedSigError` | `FailedOp(0, AA24 signature error)` |
| `drillRegistry` | [`0xd73Eb697C4762AC8a8ED01dFb6db0C2b8e80B0C0`](https://arbiscan.io/address/0xd73Eb697C4762AC8a8ED01dFb6db0C2b8e80B0C0) |
| `effectiveBpsBeforeTrip` | `10000` |
| `ladderL1Error` | `LadderUnavailable()` |
| `ladderLevelAfterTrip` | `3` |
| `effectiveBpsAfterTrip` | `0` |
| `postTripError` | `ClassicalFamilyBroken(0)` |
| `erc1271Hash` | `0x3f32e8dc1b744dd4630f93ae154d6dd9788ac061922e8fd29c2b44d64c6e1367` |
| `erc1271OtherHashResult` | `0xffffffff` |

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
