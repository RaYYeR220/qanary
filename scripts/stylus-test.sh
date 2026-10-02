#!/usr/bin/env bash
# Stylus integration suite: runs contracts/evm/test/stylus under arbos-forge, which executes the real
# Stylus WASM verifiers inside `forge test` (vm.deployStylusCode) next to the Solidity modules, with
# live post-quantum signatures from scripts/devsign over FFI.
#
# Requirements:
#   - arbos-foundry v0.1.1 (iosiro): download the archive for your platform from
#     https://github.com/iosiro/arbos-foundry/releases/tag/v0.1.1, unpack it and point ARBOS_FORGE
#     at the arbos-forge binary, e.g. ARBOS_FORGE=$HOME/arbos-foundry/arbos-forge
#   - the Rust wasm32-unknown-unknown target (scripts/build-wasm.sh)
#   - node, with `npm ci` run once in scripts/devsign
#
# Usage: ARBOS_FORGE=/path/to/arbos-forge scripts/stylus-test.sh [extra forge test args]
#   e.g. scripts/stylus-test.sh --match-contract StylusModules
#
# Plain `forge test` compiles test/stylus but skips it: the suite only runs with STYLUS_TESTS=true.
# arbos-forge uses its own out/cache directories so it never invalidates the regular forge build.
#
# Key-pointer tests (a verifier reading a KeyStore pointer: pointer verify paths, QuantumValidator,
# PQSafeOwner on Safe) are skipped unless STYLUS_POINTER_TESTS=true. arbos-foundry v0.1.1 bundles an
# arbos-revm that prices the Stylus account_code hostio at 700 * maxCodeSize / 24576 gas, and forge
# runs tests with an unlimited max code size, so every pointer read runs out of gas. arbos-revm fixed
# this upstream (constant 700, as on Nitro) in a5b5232; with an arbos-forge built on that, run
#   STYLUS_POINTER_TESTS=true scripts/stylus-test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

: "${ARBOS_FORGE:?set ARBOS_FORGE to the arbos-forge binary (iosiro/arbos-foundry v0.1.1)}"
if [[ ! -d "$ROOT/scripts/devsign/node_modules" ]]; then
  echo "scripts/devsign/node_modules is missing: run 'npm ci' in scripts/devsign" >&2
  exit 1
fi

"$ROOT/scripts/build-wasm.sh"
cd "$ROOT/contracts/evm"
STYLUS_TESTS=true FOUNDRY_OUT=out-stylus FOUNDRY_CACHE_PATH=cache-stylus \
  "$ARBOS_FORGE" test --match-path 'test/stylus/*' -vv "$@"
