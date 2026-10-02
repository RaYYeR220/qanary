# Solidity ML-DSA-44 fallback verifier

`SolidityMLDSA44Verifier` is an ERC-7913 verifier for ML-DSA-44 written for the plain EVM. It is
meant for chains where the Stylus verifiers cannot be activated. On 2026-10-02 the Arbitrum Security
Council paused new Stylus activations on Arbitrum One and Nova, so on those chains this contract is
the ML-DSA-44 verifier.

It exposes the same interface as the Stylus `mldsa44-verifier` (`IQanaryPQVerifier`):

- `verify(bytes key, bytes32 hash, bytes signature) view returns (bytes4)` returns `0x024ad318` for
  a valid signature and `0xffffffff` for a well-formed one that does not verify.
- `schemes()` returns `[2]`.
- Malformed input reverts with the same errors in the same order: `InvalidKeyLength(1, 0)` for an
  empty key, `InvalidKey()` for a pointer whose code is shorter than 2 bytes or does not start with
  `0x00`, `UnsupportedScheme(s)` for a scheme byte other than 2, `InvalidKeyLength(1312, n)` for a
  wrong public-key length, and `InvalidSignatureLength(2420, n)` for a wrong signature length.
- The key formats are the same: a 20-byte `key` is a KeyStore pointer whose code is
  `0x00 || 0x02 || pk`, and any other length is an inline `0x02 || pk`.
- The semantics are the same: FIPS 204 pure ML-DSA-44 with an empty context over the 32-byte `hash`
  as the message. That is what AWS KMS `ML_DSA_SHAKE_256` with `MessageType: RAW` and
  `@noble/post-quantum` `ml_dsa44.sign(msg, sk)` produce.

The validator modules call whatever ERC-7913 verifier they are configured with, so an account on
Arbitrum One installs `QuantumValidator` with this verifier and its KeyStore pointer. When Stylus
activations resume, the account moves to the Stylus verifier with `rotateKey(stylusVerifier, keyPtr)`
and keeps the same pointer.

## How it works

| Contract | Source | Role |
|---|---|---|
| Keccak-f[1600] helper | `lib/evm-ml-dsa-verifier/helpers/f1600_170.hex`, 21,622 bytes of raw runtime | Unrolled permutation and a batched SHAKE-256 entry point, bound by code hash `0x4afb4435…817b` |
| `MLDSA44Verifier` (core) | `lib/evm-ml-dsa-verifier/src/MLDSA44Verifier.sol`, built through `MLDSA44Core.sol` | FIPS 204 ML-DSA-44 verification against an expanded key read from a data contract |
| `SolidityMLDSA44Verifier` | this directory | ERC-7913 adapter, key parsing and on-chain key preparation |
| Prepared blob, one per key | deployed by `prepareKey` | `0x00 ‖ tr ‖ NTT(2^13·t1) ‖ ExpandA(rho)`, 20,545 bytes of code |

No published Solidity ML-DSA-44 verifier takes the raw 1,312-byte key. All of them (Fireblocks, and
ZKNox on both `main` and `exp/packed-verifier`) read a key that was expanded off-chain, and they
cannot check on-chain that the expanded key matches a real public key. Upstream `docs/SAFETY.md`
says the same thing: a forged expansion makes the verifier universally forgeable. This adapter
closes that gap in the following way.

- `prepareKey(key)` takes the same key formats as `verify`. It computes the expansion on-chain in
  `MLDSA44KeyExpansion.sol`: `tr = SHAKE256(pk, 64)`, the NTT of `2^13·t1`, and `ExpandA(rho)` by
  SHAKE-128 rejection sampling. SHAKE runs on the same pinned helper. The result is deployed with
  CREATE2 at `blobAddress(keccak256(pk))`. The CREATE2 init code is a constant: it staticcalls
  `pendingBlob()` on the verifier, which hands over the payload from transient storage. Only the
  verifier can create code at that address, and it only creates the expansion of that `pk`. The
  blob is therefore bound to the raw key on-chain, and `verify` finds it from the key alone with no
  storage read, which keeps ERC-4337 validation within the ERC-7562 rules. `prepareKey` is
  permissionless and idempotent.
- `verify` parses and checks `key` and `signature` the way the Stylus verifier does, derives the
  blob address, and asks the core for `verify(blob, abi.encodePacked(hash), signature)`.
- `verify` with a well-formed key that was never prepared reverts with
  `KeyNotPrepared(bytes32 pkHash)`. `isPrepared(key)` tells you in advance. The Stylus verifiers do
  not have this error.

The expansion is byte-for-byte the output of upstream `prepare/prepare.py`. The tests check this on
17 keys (`vectors/mldsa/prepared-44.json`).

## Deployment

1. Deploy the helper runtime verbatim, using an init code that returns
   `lib/evm-ml-dsa-verifier/helpers/f1600_170.hex`. Its `EXTCODEHASH` must be
   `0x4afb4435879cdf8e50474c7aab2bc3a679caed432550ad6dba64f509309a817b`. One helper per chain is
   enough.
2. Deploy the core: `MLDSA44Verifier.sol:MLDSA44Verifier` with constructor argument `helper`. Its
   constructor checks the helper's code hash.
3. Deploy `SolidityMLDSA44Verifier(core, helper)`. Its constructor checks the same hash.
4. For each key, call `KeyStore.store(0x02 ‖ pk)`, then `prepareKey(abi.encodePacked(pointer))`, then
   install `QuantumValidator` with `(verifier, pointer)`.

The core builds only through solc's IR pipeline. `foundry.toml` limits via-IR to
`lib/evm-ml-dsa-verifier/src/MLDSA44Verifier.sol` (`compilation_restrictions`), so every other
contract keeps legacy codegen. Settings are solc 0.8.30, EVM `prague`, 10,000 optimizer runs.

## Gas and size

Each figure is call-frame gas with every touched account cold. Intrinsic and calldata gas are not
included.

| Operation | Gas |
|---|---:|
| `verify`, inline key | 1,234,975 |
| `verify`, KeyStore pointer | 1,237,441 |
| `QuantumValidator.validateUserOp` (pointer) | 1,246,034 |
| `prepareKey`, once per key: ~5.5M expansion plus ~4.1M code deposit | 9,916,566 |

| Runtime | Bytes (EIP-170 limit 24,576) |
|---|---:|
| `SolidityMLDSA44Verifier` | 6,199 |
| `MLDSA44Verifier` (core) | 24,032 |
| Keccak-f[1600] helper | 21,622 |
| Prepared blob | 20,545 |

## Third-party code

`lib/evm-ml-dsa-verifier` is a git submodule. Nothing in it is copied or modified.

- Origin: <https://github.com/fireblocks-labs/evm-ml-dsa-verifier>, pinned at commit
  `cca262b537a5ac2ee55efb427e5c61de0308e566` (the first public release, 2026-09-02)
- License: MIT, "Copyright (c) 2026 Fireblocks Ltd." (see `lib/evm-ml-dsa-verifier/LICENSE`)
- Used: `src/MLDSA44Verifier.sol`, `src/Decode.sol`, `src/Ntt.sol`, `src/InvNtt.sol`,
  `src/FastKeccak170.sol`, `src/IMLDSAVerifier.sol` and `helpers/f1600_170.hex`. Upstream
  `prepare/prepare.py` generated the reference hashes in `vectors/mldsa/prepared-44.json`.
- Upstream calls this unaudited research code. Its `docs/SAFETY.md` and
  `docs/FORMAL_VERIFICATION.md` list what has been checked: NIST ACVP and Wycheproof vectors,
  differential fuzzing, and Z3 and Lean proofs of the arithmetic bounds.

## Caveats

- No one has audited the core, the helper or this adapter.
- The core and helper addresses are fixed at deployment. The helper is pinned by code hash. The core
  is not, because its runtime embeds the helper address.
- Some ML-DSA public keys are degenerate: for example, keys with `t1 = 0`, or keys whose
  `2^13·t1` lifts to a value near 0 mod q. Anyone can forge signatures under such a key without a
  secret key. This is a property of FIPS 204 itself, so every conforming verifier accepts these
  signatures, the Stylus one included. Keys generated by KMS or by a real keygen are not
  degenerate. See upstream `docs/SAFETY.md` section 3.1.
- SampleInBall in the core keeps squeezing SHAKE-256 until it has drawn τ = 39 positions, as FIPS
  204 specifies. A second permutation is needed with probability below 2^-200, and gas bounds the
  loop. `prepareKey` caps RejNTTPoly at 32 SHAKE-128 blocks; an honest key needs 5 or 6.
- The core has 544 bytes of EIP-170 margin, so it cannot absorb more code. This is why the adapter
  is a separate contract.

## Tests

`test/fallback/SolidityMLDSA44Verifier.t.sol` runs under plain `forge test`. It needs `node`, with
`npm ci` run once in `scripts/devsign`, for the live dev-signer signatures it gets over FFI.
