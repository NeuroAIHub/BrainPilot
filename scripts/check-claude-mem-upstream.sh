#!/usr/bin/env bash
set -euo pipefail

repo="https://github.com/thedotmack/claude-mem.git"
pinned_tag="v13.13.1"
pinned_commit="f9e330199c411cb49b1874915b9a1736d33b2703"

refs=""
for attempt in 1 2 3; do
  if refs=$(git ls-remote --tags "$repo" 'refs/tags/v*'); then break; fi
  if [[ "$attempt" == "3" ]]; then exit 1; fi
done

latest_tag=$(printf '%s\n' "$refs" \
  | sed -n 's#^[^[:space:]]*[[:space:]]refs/tags/\(v[0-9][0-9.]*\)$#\1#p' \
  | sort -V \
  | tail -1)
latest_commit=$(printf '%s\n' "$refs" | awk -v ref="refs/tags/${latest_tag}^{}" '$2 == ref { print $1 }')
if [[ -z "$latest_commit" ]]; then
  latest_commit=$(printf '%s\n' "$refs" | awk -v ref="refs/tags/${latest_tag}" '$2 == ref { print $1 }')
fi

printf 'pinned %s %s\n' "$pinned_tag" "$pinned_commit"
printf 'latest %s %s\n' "$latest_tag" "$latest_commit"
if [[ "$latest_tag" != "$pinned_tag" || "$latest_commit" != "$pinned_commit" ]]; then
  printf 'claude-mem compatibility baseline is stale\n' >&2
  exit 1
fi
