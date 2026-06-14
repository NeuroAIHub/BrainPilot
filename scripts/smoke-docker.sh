#!/usr/bin/env bash
# Manual real-Docker smoke (requires a local Docker daemon — NOT run in CI).
# Builds + starts the basic compose stack in mock mode, hits /api/health, and
# tears down. Usage: bash scripts/smoke-docker.sh
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${BP_MAIN_PORT:-9001}"
export BP_MOCK=1

cleanup() { docker compose down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> building + starting basic stack (mock) on :$PORT"
docker compose up -d --build

echo "==> waiting for main /api/health"
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "==> DOCKER SMOKE PASS (main healthy)"
    exit 0
  fi
  sleep 2
done

echo "==> DOCKER SMOKE FAIL (main never healthy)"
echo "--- main logs ---";    docker compose logs main    | tail -40
echo "--- sandbox logs ---"; docker compose logs sandbox | tail -40
exit 1
