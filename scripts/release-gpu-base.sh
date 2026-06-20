#!/usr/bin/env bash
# release-gpu-base.sh — GPU 重依赖 base 镜像（brainpilot-gpu-base）的构建 + 推送。
#
# 与 release-build.sh / release-push.sh（随 monorepo 版本迭代的 main/sandbox 镜像）
# 分开：base 镜像与代码解耦、低频更新（仅 torch/cuda 升级时重建），故独立成脚本，
# 避免发版时被反复重建。
#
# 用法:
#   bash scripts/release-gpu-base.sh build            # 构建 base（打 <tag> + latest 两 tag）
#   bash scripts/release-gpu-base.sh push             # 推到所有已配置 registry（ghcr + 私有）
#   bash scripts/release-gpu-base.sh build push       # 先构建后推送
#   bash scripts/release-gpu-base.sh push --registry ghcr        # 只推某些 registry
#   bash scripts/release-gpu-base.sh push --dry-run             # 只打印推送计划
#
# 镜像源/代理来自 release-mirrors.local.sh（不提交），无则用官方源默认。
# tag/源 SSOT 在 release-images.sh（GPU_BASE_IMAGE/TAG/DOCKERFILE、RELEASE_REGISTRIES）。
set -uo pipefail   # 不用 -e：push 单 registry 失败要继续推其他并汇总
cd "$(dirname "$0")/.."

source scripts/release-images.sh
[ -f scripts/release-mirrors.local.sh ] && source scripts/release-mirrors.local.sh

PROXY="${BUILD_PROXY:-http://127.0.0.1:7890}"

# ---- 解析子命令 + 选项 ----
DO_BUILD=""; DO_PUSH=""; REGISTRY_FILTER=""; DRY_RUN=""
while [ $# -gt 0 ]; do
  case "$1" in
    build)      DO_BUILD=1; shift ;;
    push)       DO_PUSH=1; shift ;;
    --registry) REGISTRY_FILTER="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=1; shift ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done
if [ -z "$DO_BUILD" ] && [ -z "$DO_PUSH" ]; then
  echo "用法: bash scripts/release-gpu-base.sh build|push [build push] [--registry k,..] [--dry-run]" >&2
  exit 2
fi

_in_csv() { local key="$1" csv="$2" IFS=','; for k in $csv; do [ "$k" = "$key" ] && return 0; done; return 1; }

# ---- build ----
if [ -n "$DO_BUILD" ]; then
  echo "==> building ${GPU_BASE_IMAGE} (tags: ${GPU_BASE_TAG}, latest)"
  echo "    proxy=${PROXY} mirrors: pip=${PIP_INDEX_URL:-官方} apt=${APT_MIRROR:-官方} torch=${TORCH_WHEEL_BASE:-交大默认}"
  # 经典构建器（与 release-build.sh 一致，理由见该文件注释）。DOCKER_BUILDKIT=0 内联给 sudo。
  sudo DOCKER_BUILDKIT=0 docker build \
    --network=host \
    --build-arg "HTTP_PROXY=${PROXY}" \
    --build-arg "HTTPS_PROXY=${PROXY}" \
    --build-arg "APT_MIRROR=${APT_MIRROR:-}" \
    --build-arg "PIP_INDEX_URL=${PIP_INDEX_URL:-}" \
    --build-arg "PIP_EXTRA_INDEX_URL=${PIP_EXTRA_INDEX_URL:-}" \
    --build-arg "TORCH_WHEEL_BASE=${TORCH_WHEEL_BASE:-}" \
    -f "$GPU_BASE_DOCKERFILE" \
    -t "${GPU_BASE_IMAGE}:${GPU_BASE_TAG}" \
    -t "${GPU_BASE_IMAGE}:latest" .
  echo "==> BUILD DONE: ${GPU_BASE_IMAGE}:${GPU_BASE_TAG} (+latest)"
fi

# ---- push ----
if [ -n "$DO_PUSH" ]; then
  if ! sudo docker image inspect "${GPU_BASE_IMAGE}:${GPU_BASE_TAG}" >/dev/null 2>&1; then
    echo "缺本地镜像 ${GPU_BASE_IMAGE}:${GPU_BASE_TAG} —— 先跑 bash scripts/release-gpu-base.sh build" >&2
    exit 1
  fi
  declare -a OK_LIST=() FAIL_LIST=()
  for reg_entry in "${RELEASE_REGISTRIES[@]}"; do
    IFS='|' read -r key prefix style <<< "$reg_entry"
    if [ -n "$REGISTRY_FILTER" ] && ! _in_csv "$key" "$REGISTRY_FILTER"; then continue; fi
    repo="$(remote_repo "$GPU_BASE_IMAGE" "$prefix" "$style")"
    for tag in "$GPU_BASE_TAG" latest; do
      echo "==> ${GPU_BASE_IMAGE}:${tag} → ${repo}:${tag}"
      [ -n "$DRY_RUN" ] && { OK_LIST+=("(dry) ${repo}:${tag}"); continue; }
      if sudo docker tag "${GPU_BASE_IMAGE}:${tag}" "${repo}:${tag}" && sudo docker push "${repo}:${tag}"; then
        OK_LIST+=("${repo}:${tag}")
      else
        FAIL_LIST+=("${repo}:${tag}")
      fi
    done
  done
  echo ""; echo "==== base 推送汇总 ===="
  echo "成功 ${#OK_LIST[@]}:"; printf '  ✓ %s\n' "${OK_LIST[@]:-（无）}"
  if [ "${#FAIL_LIST[@]}" -gt 0 ]; then
    echo "失败 ${#FAIL_LIST[@]}:"; printf '  ✗ %s\n' "${FAIL_LIST[@]}"
    exit 1
  fi
fi
