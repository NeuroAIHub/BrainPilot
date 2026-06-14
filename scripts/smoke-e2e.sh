#!/usr/bin/env bash
# End-to-end mock smoke: backend spawns the runtime (mock), client-cli drives a
# session through the SSE passthrough and asserts a terminal event arrives.
# Usage: bash scripts/smoke-e2e.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=${PORT:-9097}
RT_PORT=${RT_PORT:-8097}
DATA_DIR=$(mktemp -d)
LOG="$DATA_DIR/backend.log"

echo "==> building TS packages"
npx tsc -b packages/protocol packages/runtime packages/backend-core packages/client-cli >/dev/null

echo "==> starting backend (mock) on :$PORT (runtime :$RT_PORT, data=$DATA_DIR)"
BP_MOCK=1 BP_MODE=local PORT="$PORT" AGENT_RUNTIME_PORT="$RT_PORT" BP_DATA_DIR="$DATA_DIR" \
  node packages/backend-core/dist/server.js >"$LOG" 2>&1 &
BPID=$!
trap 'kill $BPID 2>/dev/null || true; rm -rf "$DATA_DIR"' EXIT

for _ in $(seq 1 40); do
  curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 0.3
done

echo "==> driving a session via client-cli"
OUT=$(node packages/client-cli/dist/bin.js "smoke" --base-url "http://127.0.0.1:$PORT/api" --max-events 40 2>&1)
echo "$OUT"

if echo "$OUT" | grep -q "RUN_FINISHED"; then
  echo "==> SMOKE PASS"
else
  echo "==> SMOKE FAIL (no RUN_FINISHED)"; echo "--- backend log ---"; cat "$LOG"; exit 1
fi
