#!/usr/bin/env bash
# Run cargo-stylus 0.10.9 (Linux, Docker) against the workspace.
# cargo-stylus 0.10.9 does not build natively on Windows (src/commands/debug_hook.rs uses std::os::unix).
# Usage: scripts/stylus.sh <contract-dir> <cargo stylus args...>
# e.g.   scripts/stylus.sh contracts/stylus/falcon512-verifier check --endpoint http://host.docker.internal:8547
# Env:   PQ_STACK_SIZE=<bytes> is forwarded to the contract build.rs (shadow-stack size).
#        SECRETS_DIR=<path> is mounted read-only at /secrets when set.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -W 2>/dev/null || pwd)"
dir="$1"; shift
extra=()
if [[ -n "${PQ_STACK_SIZE:-}" ]]; then extra+=(-e "PQ_STACK_SIZE=$PQ_STACK_SIZE"); fi
if [[ -n "${SECRETS_DIR:-}" ]]; then extra+=(-v "$SECRETS_DIR:/secrets:ro"); fi
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$ROOT:/work" \
  -v qanary-cargo-registry:/usr/local/cargo/registry \
  -e CARGO_TARGET_DIR=/work/target-linux \
  "${extra[@]}" \
  -w "/work/$dir" \
  --add-host host.docker.internal:host-gateway \
  qanary/stylus:0.10.9 cargo stylus "$@"
