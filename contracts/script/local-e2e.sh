#!/usr/bin/env bash
# LOCAL SIMULATION ONLY. Starts (or reuses) an anvil node on 127.0.0.1:8545 (chain 31337), installs the
# Omni-compatible MockReactiveSystem at the Reactive system address, deploys the full BASTION stack with
# LocalSimulationDeploy, then runs the TypeScript Reactive relay scenario (tools/local-e2e).
# Nothing here talks to a public network. Usage: contracts/script/local-e2e.sh [--keep-anvil] [--deploy-only]
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
RPC="${LOCAL_RPC_URL:-http://127.0.0.1:8645}" # dedicated port, never a shared/public node
KEEP=0; DEPLOY_ONLY=0
for a in "$@"; do
  case "$a" in --keep-anvil) KEEP=1 ;; --deploy-only) DEPLOY_ONLY=1; KEEP=1 ;; esac
done
case "$RPC" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "refusing non-local RPC: $RPC" >&2; exit 1 ;; esac

ANVIL_PID=""
if ! cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; then
  anvil --chain-id 31337 --port "${RPC##*:}" --silent --block-time 1 >/dev/null 2>&1 &
  ANVIL_PID=$!
  for _ in $(seq 1 50); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.2; done
fi
[ "$(cast chain-id --rpc-url "$RPC")" = "31337" ] || { echo "not a local 31337 chain" >&2; exit 1; }
cleanup() { if [ -n "$ANVIL_PID" ] && [ "$KEEP" = 0 ]; then kill "$ANVIL_PID" 2>/dev/null || true; fi; }
trap cleanup EXIT

cd "$HERE"
forge build --quiet
CODE=$(jq -r '.deployedBytecode.object' out/MockReactiveSystem.sol/MockReactiveSystem.json)
cast rpc --rpc-url "$RPC" anvil_setCode 0x8888888888888888888888888888888888888888 "$CODE" >/dev/null
mkdir -p out-evidence/local
forge script script/LocalSimulationDeploy.s.sol --rpc-url "$RPC" --broadcast --slow -q
echo "addresses: $HERE/out-evidence/local/addresses.json"
[ "$DEPLOY_ONLY" = 1 ] && { echo "anvil left running (pid ${ANVIL_PID:-external})"; trap - EXIT; exit 0; }
cd "$ROOT"
LOCAL_RPC_URL="$RPC" LOCAL_ADDRESSES="$HERE/out-evidence/local/addresses.json" pnpm --filter @bastion/local-e2e run scenario
