#!/usr/bin/env bash
set -euo pipefail

pinned_tag="v6.2.0"
pinned_commit="3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9"

release=$(curl --retry 5 --retry-all-errors --connect-timeout 10 --max-time 30 -fsSL \
  "https://api.github.com/repos/obra/superpowers/releases/latest")
latest_tag=$(printf '%s' "$release" | jq -r '.tag_name')
latest_commit=$(curl --retry 5 --retry-all-errors --connect-timeout 10 --max-time 30 -fsSL \
  "https://api.github.com/repos/obra/superpowers/commits/${latest_tag}" | jq -r '.sha')

printf 'pinned %s %s\n' "$pinned_tag" "$pinned_commit"
printf 'latest %s %s\n' "$latest_tag" "$latest_commit"
if [[ "$latest_tag" != "$pinned_tag" || "$latest_commit" != "$pinned_commit" ]]; then
  printf 'Superpowers compatibility baseline is stale\n' >&2
  exit 1
fi
