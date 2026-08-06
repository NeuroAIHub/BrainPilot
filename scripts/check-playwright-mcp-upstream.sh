#!/usr/bin/env bash
set -euo pipefail

pinned_version="0.0.78"
pinned_integrity="sha512-XLTUeA6mEN9sQ+hJ4dfG8EIkDbxS0K3Trc2RBkUJuf02TgE2FQRNTMtq/aJfhyRMINsRl/Ybc4sxcWLtFn4/TQ=="

metadata=$(npm view @playwright/mcp@latest version dist.integrity --json)
latest_version=$(printf '%s' "$metadata" | jq -r '.version')
latest_integrity=$(printf '%s' "$metadata" | jq -r '."dist.integrity"')

printf 'pinned %s %s\n' "$pinned_version" "$pinned_integrity"
printf 'latest %s %s\n' "$latest_version" "$latest_integrity"
if [[ "$latest_version" != "$pinned_version" || "$latest_integrity" != "$pinned_integrity" ]]; then
  printf 'Playwright MCP compatibility baseline is stale\n' >&2
  exit 1
fi
