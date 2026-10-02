#!/usr/bin/env bash
# Deploy, activate and smoke-test the Qanary Stylus programs on an Arbitrum chain (Arbitrum One/Nova,
# an Orbit chain such as ApeChain, or the local Nitro dev node), then record them in
# deployments/<network-name>.json.
#
# Usage: scripts/deploy-stylus.sh <rpc-url> <network-name> [contract ...]
#   contract: mldsa44-verifier | mldsa65-verifier | falcon512-verifier | ladder-verifier (default: all four)
#   e.g.   scripts/deploy-stylus.sh https://rpc.apechain.com/http apechain
#          scripts/deploy-stylus.sh http://127.0.0.1:8547 devnode
#
# Env:
#   DEPLOYER_PRIVATE_KEY     hex key of the funded deployer (required unless DRY_RUN=1). cargo-stylus reads it
#                            from a private temp file mounted read-only into its container (removed on exit);
#                            it is never written to the repository, logs or deployments/*.json.
#   DEPLOYER_ADDRESS         sender used for estimates when DRY_RUN=1 without a key
#   DRY_RUN=1                build, check and estimate only; send nothing
#   MAX_SPEND=<ether>        abort before sending anything if the estimated total cost exceeds this
#   DEPLOY_STYLUS_DEPLOYER=1 also deploy StylusDeployer (0xcEcba2F1...A990) through the CREATE2 factory when it is
#                            missing. Only contracts with a Stylus constructor need it; the Qanary verifiers have
#                            none, so cargo-stylus deploys them with a plain CREATE followed by
#                            ArbWasm.activateProgram and the deployer is skipped by default.
#   DOCKER_RPC=<url>         RPC URL as seen from inside the cargo-stylus container (default: <rpc-url> with
#                            127.0.0.1/localhost replaced by host.docker.internal)
#   DEPLOY_VIA=cast          send the deploy and activation transactions with cast instead of cargo-stylus, for
#                            nodes whose eth_call cannot simulate activation with the unbounded balance override
#                            that `cargo stylus check/deploy` uses (ApeChain Curtis answers "method handler
#                            crashed"). Build, initcode and verification are unchanged; activation is simulated
#                            here with a bounded override instead.
#
# Steps: cargo stylus check (size + activation data fee) -> estimate deploy and activation gas for every
# contract -> abort if balance < 1.2 x estimated total -> cargo stylus deploy (CREATE + activateProgram) ->
# confirm ArbWasm programVersion / codehashVersion -> cache bid 0 where a CacheManager exists -> eth_call
# verify() with a fixture from vectors/ and record its gas. Re-running is safe: a recorded program that is
# already active is skipped, a recorded program that is deployed but not active is only activated.
#
# Requires: docker (image qanary/stylus:0.10.9, see docker/stylus.Dockerfile), cast (Foundry), curl, python 3.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC="${1:?usage: scripts/deploy-stylus.sh <rpc-url> <network-name> [contract ...]}"
NETWORK="${2:?usage: scripts/deploy-stylus.sh <rpc-url> <network-name> [contract ...]}"
shift 2
CONTRACTS=("$@")
if [[ ${#CONTRACTS[@]} -eq 0 ]]; then
  CONTRACTS=(mldsa44-verifier mldsa65-verifier falcon512-verifier ladder-verifier)
fi

ARBWASM=0x0000000000000000000000000000000000000071
ARBWASMCACHE=0x0000000000000000000000000000000000000072
ARBSYS=0x0000000000000000000000000000000000000064
CREATE2_FACTORY=0x4e59b44847b379578588920ca78fbf26c0b4956c
STYLUS_DEPLOYER=0xcEcba2F1DC234f70Dd89F2041029807F8D03A990
ZERO_SALT=0x0000000000000000000000000000000000000000000000000000000000000000
ERC7913_MAGIC=0x024ad318
ERC7913_FAIL=0xffffffff

DOCKER_RPC="${DOCKER_RPC:-$(sed -E 's#//(127\.0\.0\.1|localhost)([:/]|$)#//host.docker.internal\2#' <<<"$RPC")}"
OUT="$ROOT/deployments/$NETWORK.json"
WORK="$ROOT/target-linux/deploy/$NETWORK"   # gitignored; /work/target-linux/... inside the container
mkdir -p "$WORK" "$ROOT/deployments"

die() { echo "error: $*" >&2; exit 1; }
log() { echo "==> $*"; }
for t in docker cast curl; do command -v "$t" >/dev/null || die "$t not found"; done
PY=""
for p in python3 python; do
  if command -v "$p" >/dev/null && "$p" -c 'import sys; assert sys.version_info >= (3, 8)' 2>/dev/null; then PY="$p"; break; fi
done
[[ -n "$PY" ]] || die "python 3 not found"
py() { "$PY" "$@" | tr -d '\r'; }   # no CRLF from Windows Python

# Integer arithmetic on wei amounts (bash arithmetic overflows above 2^63 wei, about 9.2 ether).
big() { py -c 'import sys; print(eval(sys.argv[1], {"__builtins__": {}}))' "$1"; }
# Host path for `docker -v` (Windows-style under Git Bash).
host_path() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else echo "$1"; fi; }
strip_ansi() { sed -E 's/\x1b\[[0-9;]*m//g'; }

# ---- deployer key ----------------------------------------------------------------------------------
KEYDIR=""
cleanup() { if [[ -n "$KEYDIR" ]]; then rm -rf "$KEYDIR"; fi; }
trap cleanup EXIT INT TERM
if [[ -n "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
  DEPLOYER="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"
  KEYDIR="$(mktemp -d)"
  chmod 700 "$KEYDIR"
  (umask 077; printf '%s' "$DEPLOYER_PRIVATE_KEY" >"$KEYDIR/key")
elif [[ "${DRY_RUN:-}" == 1 ]]; then
  DEPLOYER="${DEPLOYER_ADDRESS:?set DEPLOYER_ADDRESS (or DEPLOYER_PRIVATE_KEY) for a dry run}"
else
  die "set DEPLOYER_PRIVATE_KEY (or DRY_RUN=1)"
fi

stylus() { # stylus <contract> <cargo stylus args...>; key mounted at /secrets/key when present
  local c="$1"; shift
  if [[ -n "$KEYDIR" ]]; then
    SECRETS_DIR="$(host_path "$KEYDIR")" "$ROOT/scripts/stylus.sh" "contracts/stylus/$c" "$@"
  else
    "$ROOT/scripts/stylus.sh" "contracts/stylus/$c" "$@"
  fi
}

# ---- chain facts -----------------------------------------------------------------------------------
CHAIN_ID="$(cast chain-id -r "$RPC")"
ARBOS=$(( $(cast call -r "$RPC" $ARBSYS 'arbOSVersion()(uint256)') - 55 ))
STYLUS_VERSION="$(cast call -r "$RPC" $ARBWASM 'stylusVersion()(uint16)')"
GAS_PRICE="$(cast gas-price -r "$RPC")"
BALANCE="$(cast balance -r "$RPC" "$DEPLOYER")"
CACHE_MANAGERS="$(cast call -r "$RPC" $ARBWASMCACHE 'allCacheManagers()(address[])')"
log "$NETWORK: chain $CHAIN_ID, ArbOS $ARBOS, Stylus v$STYLUS_VERSION, gas price $(cast from-wei "$GAS_PRICE" gwei) gwei"
log "deployer $DEPLOYER, balance $(cast from-wei "$BALANCE")"
log "cache managers: $CACHE_MANAGERS"

# ---- JSON record -----------------------------------------------------------------------------------
# record <contractKey|-> key=value ...  (values that parse as JSON are stored as JSON, others as strings)
record() {
  py - "$OUT" "$NETWORK" "$CHAIN_ID" "$RPC" "$DEPLOYER" "$ARBOS" "$STYLUS_VERSION" "$@" <<'PY'
import json, os, sys
out, network, chain_id, rpc, deployer, arbos, sv, key, *kvs = sys.argv[1:]
data = json.load(open(out)) if os.path.exists(out) else {}
data.update({"network": network, "chainId": int(chain_id), "rpc": rpc, "deployer": deployer,
             "arbos": int(arbos), "stylusVersion": int(sv),
             "toolchain": {"image": "qanary/stylus:0.10.9", "cargoStylus": "0.10.9", "rust": "1.95.0"}})
entry = data.setdefault("stylus", {}).setdefault(key, {}) if key != "-" else data
for kv in kvs:
    k, v = kv.split("=", 1)
    try:
        v = json.loads(v)
    except ValueError:
        pass
    entry[k] = v
with open(out, "w", newline="\n") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY
}
recorded() { # recorded <contractKey> <field>
  py - "$OUT" "$1" "$2" <<'PY'
import json, os, sys
out, key, field = sys.argv[1:]
d = json.load(open(out)) if os.path.exists(out) else {}
v = d.get("stylus", {}).get(key, {}).get(field)
print("" if v is None else v)
PY
}
json_key() { # mldsa44-verifier -> mldsa44Verifier
  py -c 'import sys; a=sys.argv[1].split("-"); print(a[0]+"".join(x.title() for x in a[1:]))' "$1"
}

# ---- estimates (all contracts, before sending anything) ---------------------------------------------
# estimate <initcode-file>: prints "<deployGas> <activationGas> <dataFeeWei> <runtimeBytes>"
estimate() {
  py - "$RPC" "$DEPLOYER" "$1" <<'PY'
import json, sys, urllib.request
rpc, sender, path = sys.argv[1:]
ARBWASM = "0x0000000000000000000000000000000000000071"
PROBE = "0x00000000000000000000000000000000000c0de1"
PROBE_SENDER = "0x00000000000000000000000000000000000c0de2"  # funded by a bounded override (some nodes crash on 2^256-1)
def call(method, params, may_fail=False):
    req = urllib.request.Request(rpc, headers={"Content-Type": "application/json", "User-Agent": "curl/8"},
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode())
    r = json.loads(urllib.request.urlopen(req, timeout=120).read())
    if "error" in r:
        if may_fail:
            return None
        sys.exit(f"{method}: {r['error']}")
    return r["result"]
initcode = open(path).read().strip()
initcode = initcode if initcode.startswith("0x") else "0x" + initcode
deploy_gas = int(call("eth_estimateGas", [{"from": sender, "data": initcode}, "latest"]), 16)
runtime = call("eth_call", [{"from": sender, "data": initcode}, "latest"])
override = {PROBE: {"code": runtime}, PROBE_SENDER: {"balance": hex(10**24)}}
arg = PROBE[2:].rjust(64, "0")
# programVersion(address) succeeds iff this code hash is already active (activation is per code hash)
if call("eth_call", [{"to": ARBWASM, "data": "0xcc8f4e88" + arg}, "latest", override], may_fail=True):
    print(deploy_gas, 0, 0, (len(runtime) - 2) // 2)
    sys.exit(0)
activate = "0x58c780c2" + arg  # activateProgram(address)
sim = call("eth_call", [{"from": PROBE_SENDER, "to": ARBWASM, "data": activate, "value": hex(10**18)}, "latest", override])
data_fee = int(sim[2 + 64:2 + 128], 16)
act_gas = int(call("eth_estimateGas", [{"from": PROBE_SENDER, "to": ARBWASM, "data": activate,
                                         "value": hex(data_fee * 12 // 10)}, "latest", override]), 16)
print(deploy_gas, act_gas, data_fee, (len(runtime) - 2) // 2)
PY
}

declare -A EST_DEPLOY EST_ACT
TOTAL=0
for c in "${CONTRACTS[@]}"; do
  [[ -d "$ROOT/contracts/stylus/$c" ]] || die "unknown contract $c"
  k="$(json_key "$c")"
  addr="$(recorded "$k" address)"
  if [[ -n "$addr" && "$(cast call -r "$RPC" $ARBWASM 'programVersion(address)(uint16)' "$addr" 2>/dev/null || echo 0)" != 0 ]]; then
    log "$c: already active at $addr, skipping estimate"
    continue
  fi
  if [[ "${DEPLOY_VIA:-}" != cast ]]; then
    log "$c: cargo stylus check"
    set +e
    stylus "$c" check --endpoint "$DOCKER_RPC" 2>&1 | strip_ansi >"$WORK/$c.check.log"
    rc=${PIPESTATUS[0]}
    set -e
    grep -E "contract size|data fee|rror" "$WORK/$c.check.log" || true
    (( rc == 0 )) || die "$c: check failed, see $WORK/$c.check.log (try DEPLOY_VIA=cast if the node crashes on the simulation)"
  fi
  stylus "$c" get-initcode --output "/work/target-linux/deploy/$NETWORK/$c.initcode" >/dev/null 2>&1 \
    || die "$c: get-initcode failed"
  read -r dg ag fee size < <(estimate "$WORK/$c.initcode") || true
  [[ -n "${size:-}" ]] || die "$c: gas estimation failed"
  EST_DEPLOY[$c]=$dg; EST_ACT[$c]=$ag
  cost=$(big "($dg + $ag) * $GAS_PRICE + $fee * 12 // 10")
  TOTAL=$(big "$TOTAL + $cost")
  log "$c: $size bytes, deploy gas $dg, activation gas $ag, data fee $fee wei -> ~$(cast from-wei $cost)"
done
log "estimated total: $(cast from-wei $TOTAL) (balance $(cast from-wei "$BALANCE"))"
if [[ -n "${MAX_SPEND:-}" && "$(big "$TOTAL > $(cast to-wei "$MAX_SPEND")")" == True ]]; then
  die "estimated total exceeds MAX_SPEND=$MAX_SPEND"
fi
[[ "$(big "$BALANCE >= $TOTAL * 12 // 10")" == True ]] || die "balance below 1.2 x estimated total"

# ---- StylusDeployer (only for contracts with a constructor) ------------------------------------------
if [[ "$(cast code -r "$RPC" $STYLUS_DEPLOYER)" == 0x ]]; then
  if [[ "${DEPLOY_STYLUS_DEPLOYER:-}" == 1 ]]; then
    initcode="$(tr -d ' \r\n' <"$ROOT/scripts/nitro-devnode/stylus-deployer-bytecode.txt")"
    predicted="$(cast create2 --deployer $CREATE2_FACTORY --salt $ZERO_SALT --init-code "$initcode" | awk '{print $1}')"
    [[ "${predicted,,}" == "${STYLUS_DEPLOYER,,}" ]] || die "StylusDeployer CREATE2 address mismatch: $predicted"
    [[ "$(cast code -r "$RPC" $CREATE2_FACTORY)" != 0x ]] || die "CREATE2 factory missing"
    if [[ "${DRY_RUN:-}" == 1 ]]; then
      log "StylusDeployer missing; would deploy via CREATE2 (gas $(cast estimate -r "$RPC" --from "$DEPLOYER" $CREATE2_FACTORY "$ZERO_SALT$initcode"))"
    else
      log "deploying StylusDeployer via CREATE2"
      tx="$(cast send -r "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" --json $CREATE2_FACTORY "$ZERO_SALT$initcode" \
        | py -c 'import json,sys; print(json.load(sys.stdin)["transactionHash"])')"
      [[ "$(cast code -r "$RPC" $STYLUS_DEPLOYER)" != 0x ]] || die "StylusDeployer deployment failed ($tx)"
      record - "stylusDeployer={\"address\":\"$STYLUS_DEPLOYER\",\"deployTx\":\"$tx\"}"
    fi
  else
    log "StylusDeployer not present; not needed (no Stylus constructors)"
  fi
fi

[[ "${DRY_RUN:-}" == 1 ]] && { log "dry run: nothing sent"; exit 0; }

# ---- smoke test fixtures ---------------------------------------------------------------------------
hexf() { printf '0x%s' "$(tr -d ' \r\n' <"$ROOT/vectors/$1")"; }
flip_last() { # flip the low bit of the last byte of a 0x-hex string
  local h="$1" last="${1: -2}"
  printf '%s%02x' "${h:0:${#h}-2}" $(( 0x$last ^ 1 ))
}
ladder_vec() { # ladder_vec <file> -> "qx qy digest r s" of the first valid vector
  py - "$ROOT/vectors/ladder/$1" <<'PY'
import json, sys
v = next(x for x in json.load(open(sys.argv[1]))["vectors"] if x["valid"] is True)
print(*(v[k] for k in ("qx", "qy", "digest", "r", "s")))
PY
}
VERIFY_SIG='verify(bytes,bytes32,bytes)'

# smoke <contract> <address> <contractKey>: eth_call verify() on a valid fixture (+ a negative), record result + gas
smoke() {
  local c="$1" a="$2" k="$3" key hash sig res bad gas
  case "$c" in
    ladder-verifier)
      local curves=(secp160r1 p192 p224) ids=(1 2 3) i gasmap="" first_gas=""
      for i in 0 1 2; do
        read -r qx qy d r s < <(ladder_vec "${curves[$i]}.json")
        res="$(cast call -r "$RPC" "$a" 'verify(uint8,bytes32,bytes32,bytes32,bytes32,bytes32)(bool)' "${ids[$i]}" "$qx" "$qy" "$d" "$r" "$s")"
        bad="$(cast call -r "$RPC" "$a" 'verify(uint8,bytes32,bytes32,bytes32,bytes32,bytes32)(bool)' "${ids[$i]}" "$qx" "$qy" "$d" "$r" "$(flip_last "$s")")"
        [[ "$res" == true && "$bad" == false ]] || die "$c: ${curves[$i]} smoke test failed (valid=$res tampered=$bad)"
        gas="$(cast estimate -r "$RPC" --from "$DEPLOYER" "$a" 'verify(uint8,bytes32,bytes32,bytes32,bytes32,bytes32)' "${ids[$i]}" "$qx" "$qy" "$d" "$r" "$s")"
        log "$c: ${curves[$i]} valid=$res tampered=$bad gas=$gas"
        gasmap+="${gasmap:+,}\"${curves[$i]}\":$gas"
        first_gas="${first_gas:-$gas}"
      done
      record "$k" "verifyCallGas=$first_gas" "verify={\"fixture\":\"vectors/ladder/{secp160r1,p192,p224}.json (first valid vector)\",\"result\":true,\"tamperedResult\":false,\"gasByCurve\":{$gasmap}}"
      return ;;
    mldsa44-verifier)   key="0x02$(tr -d ' \r\n' <"$ROOT/vectors/mldsa44.pk")"; hash="$(hexf mldsa44.msg)"; sig="$(hexf mldsa44.sig)"; fx="vectors/mldsa44.{pk,msg,sig}, key 0x02||pk" ;;
    mldsa65-verifier)   key="0x03$(tr -d ' \r\n' <"$ROOT/vectors/mldsa65.pk")"; hash="$(hexf mldsa65.msg)"; sig="$(hexf mldsa65.sig)"; fx="vectors/mldsa65.{pk,msg,sig}, key 0x03||pk" ;;
    falcon512-verifier) key="0x04$(tr -d ' \r\n' <"$ROOT/vectors/falcon512_devsign.pk")"; hash="$(hexf falcon512_devsign.msg)"; sig="$(hexf falcon512_devsign.sig)"; fx="vectors/falcon512_devsign.{pk,msg,sig}, key 0x04||pk" ;;
    *) die "no fixture for $c" ;;
  esac
  res="$(cast call -r "$RPC" "$a" "$VERIFY_SIG(bytes4)" "$key" "$hash" "$sig")"
  bad="$(cast call -r "$RPC" "$a" "$VERIFY_SIG(bytes4)" "$key" "$(flip_last "$hash")" "$sig")"
  [[ "$res" == "$ERC7913_MAGIC" && "$bad" == "$ERC7913_FAIL" ]] || die "$c: smoke test failed (valid=$res wrong-hash=$bad)"
  gas="$(cast estimate -r "$RPC" --from "$DEPLOYER" "$a" "$VERIFY_SIG" "$key" "$hash" "$sig")"
  log "$c: verify valid=$res wrong-hash=$bad gas=$gas"
  local extra=""
  if [[ "$c" == falcon512-verifier ]]; then # FN-DSA-512 (scheme 1) on the same program
    local k1="0x01$(tr -d ' \r\n' <"$ROOT/vectors/fndsa512.pk")" r1 g1
    r1="$(cast call -r "$RPC" "$a" "$VERIFY_SIG(bytes4)" "$k1" "$(hexf fndsa512.msg)" "$(hexf fndsa512.sig)")"
    [[ "$r1" == "$ERC7913_MAGIC" ]] || die "$c: FN-DSA smoke test failed ($r1)"
    g1="$(cast estimate -r "$RPC" --from "$DEPLOYER" "$a" "$VERIFY_SIG" "$k1" "$(hexf fndsa512.msg)" "$(hexf fndsa512.sig)")"
    log "$c: FN-DSA-512 (scheme 1) valid=$r1 gas=$g1"
    extra=",\"fndsa512\":{\"fixture\":\"vectors/fndsa512.{pk,msg,sig}, key 0x01||pk\",\"result\":\"$r1\",\"gas\":$g1}"
  fi
  record "$k" "verifyCallGas=$gas" "verify={\"fixture\":\"$fx\",\"result\":\"$res\",\"wrongHashResult\":\"$bad\",\"gas\":$gas$extra}"
}

# ---- deploy + activate -----------------------------------------------------------------------------
# cast_send <gas-limit> <cast send args...>: sends at the current gas price + 5% (Arbitrum charges the base fee
# only); prints "<status> <txHash> <contractAddress|->"
cast_send() {
  local gl="$1"; shift
  cast send -r "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" --gas-limit "$gl" \
    --gas-price "$(big "$(cast gas-price -r "$RPC") * 105 // 100")" --priority-gas-price 0 --json "$@" \
    | py -c 'import json, sys; r = json.load(sys.stdin); print(int(r["status"], 16), r["transactionHash"], r.get("contractAddress") or "-")'
}
activation_fee() { # activation_fee <address>: data fee (wei) to activate the code at <address>
  py - "$RPC" "$1" <<'PY'
import json, sys, urllib.request
rpc, addr = sys.argv[1:]
sender = "0x00000000000000000000000000000000000c0de2"
req = urllib.request.Request(rpc, headers={"Content-Type": "application/json", "User-Agent": "curl/8"},
    data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [
        {"from": sender, "to": "0x0000000000000000000000000000000000000071", "value": hex(10**18),
         "data": "0x58c780c2" + addr[2:].lower().rjust(64, "0")}, "latest", {sender: {"balance": hex(10**24)}}]}).encode())
r = json.loads(urllib.request.urlopen(req, timeout=120).read())
if "error" in r:
    sys.exit(f"activation simulation: {r['error']}")
print(int(r["result"][2 + 64:2 + 128], 16))
PY
}
activate_via_cast() { # activate_via_cast <contract> <address>: sets act_tx
  local c="$1" a="$2" fee value gl status
  fee="$(activation_fee "$a")" || die "$c: activation simulation failed"
  value="$(big "$fee * 12 // 10")"   # ArbWasm refunds whatever exceeds the data fee
  gl="${EST_ACT[$c]:-$(cast estimate -r "$RPC" --from "$DEPLOYER" $ARBWASM 'activateProgram(address)' "$a" --value "$value")}"
  read -r status act_tx _ < <(cast_send "$(big "$gl * 12 // 10")" $ARBWASM 'activateProgram(address)' "$a" --value "$value")
  [[ "$status" == 1 ]] || die "$c: activation tx failed (${act_tx:-not sent}); deployed at $a, re-run to retry"
  log "$c: activated, tx $act_tx"
}
deploy_via_cast() { # deploy_via_cast <contract> <contractKey>: sets addr deploy_tx act_tx
  local c="$1" k="$2" initcode status
  initcode="$(tr -d ' \r\n' <"$WORK/$c.initcode")"
  [[ "$initcode" == 0x* ]] || initcode="0x$initcode"
  if command -v cygpath >/dev/null && (( ${#initcode} > 32400 )); then
    die "$c: initcode (${#initcode} hex chars) exceeds the Windows command-line limit for cast; run DEPLOY_VIA=cast from Linux, macOS or WSL"
  fi
  read -r status deploy_tx addr < <(cast_send "$(big "${EST_DEPLOY[$c]} * 11 // 10")" --create "$initcode")
  [[ "$status" == 1 && "$addr" != - ]] || die "$c: deploy tx failed (${deploy_tx:-not sent})"
  addr="$(cast to-check-sum-address "$addr")"
  record "$k" "address=$addr" "deployTx=$deploy_tx"
  log "$c: deployed at $addr, tx $deploy_tx"
  if [[ "$(cast call -r "$RPC" $ARBWASM 'programVersion(address)(uint16)' "$addr" 2>/dev/null || echo 0)" != 0 ]]; then
    log "$c: code hash already active"; act_tx=""; return
  fi
  activate_via_cast "$c" "$addr"
}
# cargo-stylus prints: successfully activated contract 0x<addr> with tx "<hash>"
parse_act_tx() {
  { grep -oE 'activated contract 0x[0-9a-fA-F]{40} with tx "?(0x)?[0-9a-fA-F]{64}' "$1" || true; } \
    | awk '{print $NF}' | tr -d '"' | tail -1
}
for c in "${CONTRACTS[@]}"; do
  k="$(json_key "$c")"
  addr="$(recorded "$k" address)"
  deploy_tx="" act_tx=""
  version=0
  if [[ -n "$addr" ]]; then version="$(cast call -r "$RPC" $ARBWASM 'programVersion(address)(uint16)' "$addr" 2>/dev/null || echo 0)"; fi

  if [[ -n "$addr" && "$version" != 0 ]]; then
    log "$c: already active at $addr (program version $version)"
  else
    before="$(cast balance -r "$RPC" "$DEPLOYER")"
    if [[ -n "$addr" && "$(cast code -r "$RPC" "$addr" | head -c 8)" == 0xeff000 ]]; then
      log "$c: deployed at $addr but not active, activating"
      if [[ "${DEPLOY_VIA:-}" == cast ]]; then
        activate_via_cast "$c" "$addr"
      else
        stylus "$c" activate --address "$addr" --endpoint "$DOCKER_RPC" --private-key-path /secrets/key 2>&1 \
          | strip_ansi | tee "$WORK/$c.activate.log"
        act_tx="$(parse_act_tx "$WORK/$c.activate.log")"
      fi
    elif [[ "${DEPLOY_VIA:-}" == cast ]]; then
      log "$c: deploying with cast"
      deploy_via_cast "$c" "$k"
    else
      log "$c: deploying"
      set +e
      stylus "$c" deploy --endpoint "$DOCKER_RPC" --private-key-path /secrets/key --no-verify 2>&1 \
        | strip_ansi | tee "$WORK/$c.deploy.log"
      rc=${PIPESTATUS[0]}
      set -e
      addr="$( { grep -oE 'deployed code at address: 0x[0-9a-fA-F]{40}' "$WORK/$c.deploy.log" || true; } | awk '{print $NF}' | tail -1)"
      deploy_tx="$( { grep -oE 'deployment tx hash: 0x[0-9a-fA-F]{64}' "$WORK/$c.deploy.log" || true; } | awk '{print $NF}' | tail -1)"
      act_tx="$(parse_act_tx "$WORK/$c.deploy.log")"
      if [[ -n "$addr" ]]; then
        addr="$(cast to-check-sum-address "$addr")"
        record "$k" "address=$addr" "deployTx=$deploy_tx"
      fi
      (( rc == 0 )) || die "$c: cargo stylus deploy failed (exit $rc); see $WORK/$c.deploy.log${addr:+ (deployed at $addr, re-run to activate)}"
      [[ -n "$addr" ]] || die "$c: no address in deploy output"
      if grep -q "wasm already activated" "$WORK/$c.deploy.log"; then act_tx=""; fi
    fi
    if [[ -n "${act_tx:-}" && "$act_tx" != 0x* ]]; then act_tx="0x$act_tx"; fi
    after="$(cast balance -r "$RPC" "$DEPLOYER")"

    version="$(cast call -r "$RPC" $ARBWASM 'programVersion(address)(uint16)' "$addr")"
    codehash="$(cast codehash -r "$RPC" "$addr")"
    chv="$(cast call -r "$RPC" $ARBWASM 'codehashVersion(bytes32)(uint16)' "$codehash")"
    [[ "$version" != 0 && "$chv" == "$version" ]] || die "$c: not active after deploy (programVersion=$version codehashVersion=$chv)"
    size="$(cast codesize -r "$RPC" "$addr")"
    fee="" act_gas="" deploy_gas=""
    if [[ -n "${act_tx:-}" ]]; then
      # ProgramActivated(bytes32 indexed codehash, bytes32 moduleHash, address program, uint256 dataFee, uint16 version)
      fee="$(cast receipt -r "$RPC" "$act_tx" --json | py -c '
import json, sys
topic = sys.argv[1].lower()
for l in json.load(sys.stdin)["logs"]:
    if l["topics"] and l["topics"][0].lower() == topic:
        print(int(l["data"][2 + 128:2 + 192], 16)); break' \
        "$(cast keccak 'ProgramActivated(bytes32,bytes32,address,uint256,uint16)')")"
      [[ -n "$fee" ]] || die "$c: no ProgramActivated event in $act_tx"
      act_gas="$(cast receipt -r "$RPC" "$act_tx" gasUsed)"
    fi
    deploy_tx="${deploy_tx:-$(recorded "$k" deployTx)}"
    fee_json=null; [[ -n "$fee" ]] && fee_json="\"$fee\""
    [[ -n "$deploy_tx" ]] && deploy_gas="$(cast receipt -r "$RPC" "$deploy_tx" gasUsed)"
    record "$k" "address=$addr" "deployTx=$deploy_tx" "activationTx=${act_tx:-null}" "sizeBytes=$size" \
      "dataFeeWei=$fee_json" "codehash=$codehash" "programVersion=$version" \
      "deployGasUsed=${deploy_gas:-null}" "activationGasUsed=${act_gas:-null}" "costWei=\"$(big "$before - $after")\""
    log "$c: active at $addr (version $version), cost $(cast from-wei "$(big "$before - $after")")"

    if [[ "$CACHE_MANAGERS" != "[]" ]]; then
      log "$c: cache bid 0"
      stylus "$c" cache bid "$addr" 0 --endpoint "$DOCKER_RPC" --private-key-path /secrets/key 2>&1 | strip_ansi | tail -3 \
        || echo "warning: cache bid failed for $c" >&2
    fi
  fi
  smoke "$c" "$addr" "$k"
done

log "done: $OUT"
