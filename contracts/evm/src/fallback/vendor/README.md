# Vendored: fireblocks-labs/evm-ml-dsa-verifier

- Origin: <https://github.com/fireblocks-labs/evm-ml-dsa-verifier>, commit
  `cca262b537a5ac2ee55efb427e5c61de0308e566` (first public release, 2026-09-02)
- License: MIT, "Copyright (c) 2026 Fireblocks Ltd." The upstream `LICENSE` is in this directory,
  verbatim. Every source file keeps its SPDX header.
- Upstream calls this unaudited research code. Its `docs/SAFETY.md` and
  `docs/FORMAL_VERIFICATION.md` describe the evidence: NIST ACVP and Wycheproof vectors,
  differential fuzzing, and Z3 and Lean proofs of the arithmetic bounds.

| File | Upstream path | State |
|---|---|---|
| `MLDSA44Verifier.sol` | `src/MLDSA44Verifier.sol` | unmodified |
| `Decode.sol` | `src/Decode.sol` | unmodified |
| `FastKeccak170.sol` | `src/FastKeccak170.sol` | unmodified |
| `IMLDSAVerifier.sol` | `src/IMLDSAVerifier.sol` | unmodified |
| `Ntt.sol` | `src/Ntt.sol` | **modified**, see below |
| `InvNtt.sol` | `src/InvNtt.sol` | **modified**, see below |
| `f1600_170.hex` | `helpers/f1600_170.hex` | unmodified. Keccak-f[1600] helper runtime, `keccak256` = `0x4afb4435879cdf8e50474c7aab2bc3a679caed432550ad6dba64f509309a817b` |
| `LICENSE` | `LICENSE` | unmodified |

The unmodified files are byte-identical to the upstream git blobs at that commit.

## Modifications

Upstream `nttFwV3` and `nttInvV3` write `gas()` snapshots into a profiling array that verification
never reads. Upstream's own comments say these snapshots exist for gas profiling and as code
anchors for Z3 obligation C16. Each snapshot compiles to a `GAS` opcode that is not followed by a
`*CALL`. ERC-7562 (OP-012) bans that during ERC-4337 validation, so a bundler would reject every
UserOperation validated through the core. The built core contained 9 such opcodes, and one
verification executed them about 40 times.

The fix replaces the `gas()` operand of those 9 writes with `0`. Line numbers refer to upstream:

| File | Upstream line | Upstream | Here |
|---|---:|---|---|
| `Ntt.sol` (`nttFwV3`) | 507 | `mstore(PR, gas())` | `mstore(PR, 0)` |
| `Ntt.sol` (`nttFwV3`) | 594 | `mstore(add(PR, 0x20), gas())` | `mstore(add(PR, 0x20), 0)` |
| `Ntt.sol` (`nttFwV3`) | 696 | `mstore(add(PR, 0x40), gas())` | `mstore(add(PR, 0x40), 0)` |
| `Ntt.sol` (`nttFwV3`) | 819 | `mstore(add(PR, 0x60), gas())` | `mstore(add(PR, 0x60), 0)` |
| `InvNtt.sol` (`nttInvV3`) | 131 | `mstore(PR, gas())` | `mstore(PR, 0)` |
| `InvNtt.sol` (`nttInvV3`) | 258 | `mstore(add(PR, 0x20), gas())` | `mstore(add(PR, 0x20), 0)` |
| `InvNtt.sol` (`nttInvV3`) | 314 | `mstore(add(PR, 0x40), gas())` | `mstore(add(PR, 0x40), 0)` |
| `InvNtt.sol` (`nttInvV3`) | 362 | `mstore(add(PR, 0x60), gas())` | `mstore(add(PR, 0x60), 0)` |
| `InvNtt.sol` (`nttInvV3`) | 431 | `mstore(add(PR, 0x80), gas())` | `mstore(add(PR, 0x80), 0)` |

Each of the two files also gets a two-line comment under its SPDX header that points here.

Why the writes are kept rather than deleted:

- The memory stores into the unused profiling array stay in place, so the code layout that
  upstream's C16 obligation slices on is unchanged.
- Deleting them changes how solc's IR optimizer inlines the transforms. At the upstream settings
  (via-IR, 10,000 runs) that grows the core to 26,340 bytes, past the EIP-170 limit.
- With the `0` operand the core is 24,163 bytes, compared with 24,032 bytes upstream.

`nttFwV2` still contains `gas()` snapshots. It is upstream's benchmark transform: no deployed
contract reaches it and solc does not compile it into the core.

`test/fallback/SolidityMLDSA44Verifier.t.sol` (`test_erc7562_verifyPathHasNoBannedOpcodes`) scans
the deployed runtimes of the core, the helper and the adapter for ERC-7562-banned opcodes. The same
scan finds 9 offending `GAS` opcodes in the unmodified upstream core and none here.
