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
| Keccak-f[1600] helper | `vendor/f1600_170.hex`, 21,622 bytes of raw runtime | Unrolled permutation and a batched SHAKE-256 entry point, bound by code hash `0x4afb4435…817b` |
| `MLDSA44Verifier` (core) | `vendor/MLDSA44Verifier.sol`, vendored from Fireblocks (see `vendor/README.md`) | FIPS 204 ML-DSA-44 verification against an expanded key read from a data contract |
| `MLDSA44ExpandedKeyStore` | `MLDSA44ExpandedKeyStore.sol`, `MLDSA44KeyExpansion.sol` | Expands keys on-chain and deploys one blob per key |
| `SolidityMLDSA44Verifier` | `SolidityMLDSA44Verifier.sol`, `MLDSA44PublicKey.sol` | ERC-7913 adapter: key parsing, blob lookup, call into the core |
| Prepared blob, one per key | deployed by the store | `0x00 ‖ tr ‖ NTT(2^13·t1) ‖ ExpandA(rho)`, 20,545 bytes of code |

No published Solidity ML-DSA-44 verifier takes the raw 1,312-byte key. All of them (Fireblocks, and
ZKNox on both `main` and `exp/packed-verifier`) read a key that was expanded off-chain, and they
cannot check on-chain that the expanded key matches a real public key. Upstream `docs/SAFETY.md`
says the same thing: a forged expansion makes the verifier universally forgeable. This verifier
closes that gap with `MLDSA44ExpandedKeyStore`:

- `prepare(key)` takes the same key formats as `verify`. It computes the expansion on-chain:
  `tr = SHAKE256(pk, 64)`, the NTT of `2^13·t1`, and `ExpandA(rho)` by SHAKE-128 rejection
  sampling. SHAKE runs on the same pinned helper.
- The result is deployed with CREATE2 at `blobAddress(keccak256(pk))`. The CREATE2 init code is a
  constant: it staticcalls `pendingBlob()` on the store, which hands over the payload from
  transient storage. Only the store can create code at that address, and it only creates the
  expansion of that `pk`. The blob is therefore bound to the raw key on-chain, and the verifier
  finds it from the key alone.
- `prepare` is permissionless and idempotent. The verifier's `prepareKey(key)` forwards to it.
- Prepared keys survive a verifier redeployment: a new `SolidityMLDSA44Verifier` that points at
  the same store reuses them.

`verify` parses and checks `key` and `signature` the way the Stylus verifier does, derives the blob
address, and asks the core for `verify(blob, abi.encodePacked(hash), signature)`. If the key is
well formed but was never prepared, `verify` reverts with `KeyNotPrepared(bytes32 pkHash)`;
`isPrepared(key)` tells you in advance. The Stylus verifiers do not have this error.

**ERC-4337 / ERC-7562.** `verify` reads no storage. Its call tree is the adapter, the core and the
helper. None of their runtimes contains an opcode that ERC-7562 bans during validation: no
`GAS` unless a `*CALL` immediately follows, no block or environment opcodes, no
`CREATE`/`CREATE2`, no `SELFDESTRUCT`, and no `SLOAD`, `SSTORE`, `TLOAD` or `TSTORE`. A test checks
this by scanning the deployed bytecode. CREATE2 and transient storage live only in the store, which
`verify` never calls. Upstream's core had 9 profiling `GAS` reads; they are patched out in
`vendor/` (see `vendor/README.md`).

The expansion is byte-for-byte the output of upstream `prepare/prepare.py`. The tests check this on
17 keys (`vectors/mldsa/prepared-44.json`).

## Deployment

1. Deploy the helper runtime verbatim, using an init code that returns `vendor/f1600_170.hex`. Its
   `EXTCODEHASH` must be `0x4afb4435879cdf8e50474c7aab2bc3a679caed432550ad6dba64f509309a817b`. One
   helper per chain is enough.
2. Deploy `MLDSA44Verifier(helper)`, the core. Its constructor checks the helper's code hash.
3. Deploy `MLDSA44ExpandedKeyStore(helper)`. Its constructor checks the same hash.
4. Deploy `SolidityMLDSA44Verifier(core, store)`.
5. For each key, call `KeyStore.store(0x02 ‖ pk)`, then `prepareKey(abi.encodePacked(pointer))`, then
   install `QuantumValidator` with `(verifier, pointer)`.

The vendored core builds only through solc's IR pipeline. `foundry.toml` limits via-IR to
`vendor/{MLDSA44Verifier,Decode,Ntt,InvNtt}.sol` (`compilation_restrictions`), so every other
contract keeps legacy codegen. Settings are solc 0.8.30, EVM `prague`, 10,000 optimizer runs.

## Gas and size

Each figure is call-frame gas with every touched account cold. Intrinsic and calldata gas are not
included.

| Operation | Gas |
|---|---:|
| `verify`, inline key | 1,236,247 |
| `verify`, KeyStore pointer | 1,238,703 |
| `QuantumValidator.validateUserOp` (pointer) | 1,247,542 |
| `prepareKey`, once per key: ~5.5M expansion plus ~4.1M code deposit | 9,920,372 |

| Runtime | Bytes (EIP-170 limit 24,576) |
|---|---:|
| `SolidityMLDSA44Verifier` | 3,616 |
| `MLDSA44ExpandedKeyStore` | 4,950 |
| `MLDSA44Verifier` (core) | 24,163 |
| Keccak-f[1600] helper | 21,622 |
| Prepared blob | 20,545 |

## Third-party code

`vendor/` holds the core and helper from <https://github.com/fireblocks-labs/evm-ml-dsa-verifier> at
commit `cca262b537a5ac2ee55efb427e5c61de0308e566`. It is MIT licensed, "Copyright (c) 2026
Fireblocks Ltd.", and the upstream `LICENSE` is in `vendor/`. Two files carry a 9-line patch that
removes the GAS reads; the rest are byte-identical to upstream. `vendor/README.md` has the exact
modifications. Upstream `prepare/prepare.py` generated the reference hashes in
`vectors/mldsa/prepared-44.json`.

## Caveats

- No one has audited the core, the helper or this adapter. Upstream's `docs/SAFETY.md` and
  `docs/FORMAL_VERIFICATION.md` list what has been checked.
- The core and store addresses are fixed when the verifier is deployed. Both are bound to the
  helper by code hash. They are not pinned by code hash themselves, because their runtimes embed
  the helper address.
- Some ML-DSA public keys are degenerate: for example, keys with `t1 = 0`, or keys whose
  `2^13·t1` lifts to a value near 0 mod q. Anyone can forge signatures under such a key without a
  secret key. This is a property of FIPS 204 itself, so every conforming verifier accepts these
  signatures, the Stylus one included. Keys generated by KMS or by a real keygen are not
  degenerate. See upstream `docs/SAFETY.md` section 3.1.
- SampleInBall in the core keeps squeezing SHAKE-256 until it has drawn τ = 39 positions, as FIPS
  204 specifies. A second permutation is needed with probability below 2^-200, and gas bounds the
  loop. `prepare` caps RejNTTPoly at 32 SHAKE-128 blocks; an honest key needs 5 or 6.
- The core has 413 bytes of EIP-170 margin.

## Tests

`test/fallback/SolidityMLDSA44Verifier.t.sol` runs under plain `forge test`. The live dev-signer
tests call `scripts/devsign` over FFI. They need `node`, with `npm ci` run once in `scripts/devsign`,
and they are skipped when it is not available.
