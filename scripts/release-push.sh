#!/usr/bin/env bash
# Release image push — 把本地已构建镜像 tag+push 到选定 registry。不重新构建。
# 用法:
#   bash scripts/release-push.sh                                 # 全部镜像 → 全部已配置 registry
#   bash scripts/release-push.sh --registry acr,intranet         # 只推这些 registry（跳过 ghcr）
#   bash scripts/release-push.sh --image sandbox-gpu             # 只推名字含该子串的镜像
#   bash scripts/release-push.sh --image sandbox-gpu --registry acr,intranet
#   bash scripts/release-push.sh --dry-run                       # 只打印 tag/push 计划，不真推
set -uo pipefail   # 注意：不用 -e，单个 registry 失败要继续推其他并汇总
cd "$(dirname "$0")/.."

source scripts/release-images.sh
VERSION="$(node -p "require('./package.json').version")"

IMAGE_FILTER=""; REGISTRY_FILTER=""; DRY_RUN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --image)    IMAGE_FILTER="$2"; shift 2 ;;
    --registry) REGISTRY_FILTER="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=1; shift ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

# 逗号分隔列表是否包含某键（精确匹配段）
_in_csv() { # _in_csv <键> <csv>
  local key="$1" csv="$2" IFS=','
  for k in $csv; do [ "$k" = "$key" ] && return 0; done
  return 1
}

declare -a OK_LIST=() FAIL_LIST=()   # 显式空数组初始化：否则 set -u 下空 FAIL_LIST 触发 unbound variable
for img_entry in "${RELEASE_IMAGES[@]}"; do
  IFS='|' read -r img _df _arg <<< "$img_entry"
  # 镜像子集：--image 是子串匹配（与 build 一致）
  if [ -n "$IMAGE_FILTER" ] && [[ "$img" != *"$IMAGE_FILTER"* ]]; then continue; fi

  if ! sudo docker image inspect "$img:$VERSION" >/dev/null 2>&1; then
    echo "缺本地镜像 $img:$VERSION —— 先跑 scripts/release-build.sh"; exit 1
  fi

  for reg_entry in "${RELEASE_REGISTRIES[@]}"; do
    IFS='|' read -r key prefix style <<< "$reg_entry"
    # registry 子集：--registry 是精确键匹配（逗号分隔）
    if [ -n "$REGISTRY_FILTER" ] && ! _in_csv "$key" "$REGISTRY_FILTER"; then continue; fi
    repo="$(remote_repo "$img" "$prefix" "$style")"
    for tag in "$VERSION" latest; do
      echo "==> $img:$tag → $repo:$tag"
      [ -n "$DRY_RUN" ] && { OK_LIST+=("(dry) $repo:$tag"); continue; }
      if sudo docker tag "$img:$tag" "$repo:$tag" && sudo docker push "$repo:$tag"; then
        OK_LIST+=("$repo:$tag")
      else
        FAIL_LIST+=("$repo:$tag")
      fi
    done
  done
done

echo ""; echo "==== 推送汇总 ===="
echo "成功 ${#OK_LIST[@]}:"; printf '  ✓ %s\n' "${OK_LIST[@]:-（无）}"
if [ "${#FAIL_LIST[@]}" -gt 0 ]; then
  echo "失败 ${#FAIL_LIST[@]}:"; printf '  ✗ %s\n' "${FAIL_LIST[@]}"
  exit 1
fi
