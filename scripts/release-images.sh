#!/usr/bin/env bash
# release-images.sh — SSOT for image build + multi-registry push.
# Sourced by release-build.sh and release-push.sh. Defines:
#   RELEASE_IMAGES      本地镜像 → Dockerfile + 构建 target
#   RELEASE_REGISTRIES  推送目标 → 前缀 + 命名风格
#   remote_repo()       本地镜像名 → 某 registry 的完整仓库路径
# 私有 registry 地址在 release-targets.local.sh（不提交）里 append。

# 随 monorepo 版本迭代的镜像清单: "本地镜像名|Dockerfile 路径|构建 target(可空)"
#   main 无 target（单链 Dockerfile）；sandbox 用同一 Dockerfile 靠 --target 切 cpu/gpu
#   （cpu = python-baseline + 业务层；gpu = brainpilot-gpu-base + 业务层）。
#   ⚠️ sandbox-gpu 依赖独立 base 镜像 brainpilot-gpu-base 先就位（本地或可拉），
#      见下方 GPU_BASE_* 与 scripts/release-gpu-base.sh。
RELEASE_IMAGES=(
  "brainpilot-main|docker/main/Dockerfile|"
  "brainpilot-sandbox|docker/sandbox/Dockerfile|cpu"
  "brainpilot-sandbox-gpu|docker/sandbox/Dockerfile|gpu"
)

# GPU 重依赖 base 镜像（CUDA+torch+科学栈）—— 与 monorepo 版本解耦、低频更新。
#   按依赖版本打 tag；runtime 的 gpu stage `FROM ...:<tag>` 引用它。
#   ⚠️ 改 GPU_BASE_TAG 时必须同步 docker/sandbox/Dockerfile 的 gpu stage FROM
#      和 docker/sandbox/Dockerfile.gpu-base 里的 torch/cuda 版本。
#   构建/推送走独立脚本 scripts/release-gpu-base.sh（不在 RELEASE_IMAGES 里，
#   故 release-build/push 不会随版本反复重建这层）。
GPU_BASE_IMAGE="brainpilot-gpu-base"
GPU_BASE_TAG="cu124-torch2.6.0"
GPU_BASE_DOCKERFILE="docker/sandbox/Dockerfile.gpu-base"

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
