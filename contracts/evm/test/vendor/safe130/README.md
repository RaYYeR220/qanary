# Vendored: Safe 1.3.0 (test only)

- Origin: <https://github.com/safe-global/safe-smart-account>, tag `v1.3.0`, commit
  `186a21a74b327f17fc41217a927dea7064f74604`.
- License: LGPL-3.0-only. The upstream `LICENSE` is in this directory, verbatim, and every source
  file keeps its SPDX header.
- Contents: `GnosisSafe`, `GnosisSafeProxyFactory`, `CompatibilityFallbackHandler` and everything
  they import, under the upstream `contracts/` layout. Nothing in `src/` imports these files; the
  tests use them to run `PQSafeOwner` against the Safe version deployed for the Arbitrum Security
  Council, whose fallback handler forwards the raw message to contract owners.
- Modification: `handler/CompatibilityFallbackHandler.sol`, `isValidSignature(bytes,bytes)` takes
  its two parameters as `memory` instead of `calldata`, so solc 0.8.30 compiles the override. The
  logic is unchanged. Every other file is byte-identical to the upstream blob at the tag.
