#!/usr/bin/env bash
# release-images.sh — SSOT for image build + multi-registry push.
# Sourced by release-build.sh and release-push.sh. Defines:
#   RELEASE_IMAGES      本地镜像 → Dockerfile + 额外 build-arg
#   RELEASE_REGISTRIES  推送目标 → 前缀 + 命名风格
#   remote_repo()       本地镜像名 → 某 registry 的完整仓库路径
# 私有 registry 地址在 release-targets.local.sh（不提交）里 append。

# 本地镜像清单: "本地镜像名|Dockerfile 路径|额外 build-arg(空格分隔，可空)"
RELEASE_IMAGES=(
  "brainpilot-main|docker/main/Dockerfile|"
  "brainpilot-sandbox|docker/sandbox/Dockerfile|SANDBOX_EXTRA_DEPS=extra-deps.sh"
  "brainpilot-sandbox-gpu|docker/sandbox/Dockerfile|SANDBOX_EXTRA_DEPS=extra-deps.gpu.sh"
)

# registry 清单: "registry键|前缀|命名风格(flat|acr)"
# ghcr 地址本就公开，写死在提交版本里。
RELEASE_REGISTRIES=( "ghcr|ghcr.io/neuroaihub|flat" )

# 私有目标（ACR 实例 ID / 内网 IP）从不提交的本地文件 append。
_REL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$_REL_DIR/release-targets.local.sh" ] && source "$_REL_DIR/release-targets.local.sh"

# remote_repo <本地镜像名> <前缀> <风格>
#   flat → 前缀/本地名               (brainpilot-main)
#   acr  → 前缀/去 brainpilot- 前缀  (main)
remote_repo() {
  local local_name="$1" prefix="$2" style="$3"
  case "$style" in
    flat) echo "${prefix}/${local_name}" ;;
    acr)  echo "${prefix}/${local_name#brainpilot-}" ;;
    *)    echo "remote_repo: unknown style '$style'" >&2; return 1 ;;
  esac
}
