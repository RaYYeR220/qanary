#!/usr/bin/env bash
# Builds release wasm for every Stylus contract (used by arbos-forge tests via vm.deployStylusCode).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/contracts/evm/stylus-wasm"
mkdir -p "$OUT"
for c in mldsa44 mldsa65 falcon512 ladder; do
  (cd "$ROOT" && cargo build --release --target wasm32-unknown-unknown -p "${c}-verifier" --lib)
  cp "$ROOT/target/wasm32-unknown-unknown/release/${c}_verifier.wasm" "$OUT/${c}_verifier.wasm"
done
ls -la "$OUT"
