#!/usr/bin/env bash
# Release image build — 读 release-images.sh 清单循环构建，打 latest + 版本号两 tag。
# 用法:
#   bash scripts/release-build.sh                 # 构建全部镜像
#   bash scripts/release-build.sh sandbox         # 只构建名字含 "sandbox" 的镜像（子集）
#   bash scripts/release-build.sh main sandbox-gpu# 多个子集
# 镜像源/代理来自 release-mirrors.local.sh（不提交），无则用官方源默认。
set -euo pipefail
cd "$(dirname "$0")/.."

source scripts/release-images.sh
# 镜像源外置：本地文件存在则覆盖官方源默认值（设 PIP_INDEX_URL/APT_MIRROR/NPM_REGISTRY 等）
[ -f scripts/release-mirrors.local.sh ] && source scripts/release-mirrors.local.sh

VERSION="$(node -p "require('./package.json').version")"
PROXY="${BUILD_PROXY:-http://127.0.0.1:7890}"

# 子集匹配：无参数=全建；有参数=镜像名包含任一参数子串才建
_matches() { # _matches <镜像名> <参数...>
  local name="$1"; shift
  local pat
  for pat in "$@"; do [[ "$name" == *"$pat"* ]] && return 0; done
  return 1
}

# 经典构建器：BuildKit 镜像解析器不吃 dockerd 的 systemd 代理、直连被墙的 Docker Hub；
# 经典构建器走守护进程代理路径（已验证 docker pull 可用）。这些 Dockerfile 无 BuildKit 专属语法。
# 注：DOCKER_BUILDKIT=0 必须内联给 sudo —— sudo 会清环境变量，export 不生效。
COMMON=(
  --network=host
  --build-arg "HTTP_PROXY=${PROXY}"
  --build-arg "HTTPS_PROXY=${PROXY}"
  --build-arg "NPM_REGISTRY=${NPM_REGISTRY:-}"
  --build-arg "APT_MIRROR=${APT_MIRROR:-}"
  --build-arg "PIP_INDEX_URL=${PIP_INDEX_URL:-}"
  --build-arg "PIP_EXTRA_INDEX_URL=${PIP_EXTRA_INDEX_URL:-}"
  --build-arg "TORCH_WHEEL_BASE=${TORCH_WHEEL_BASE:-}"
)

echo "==> version=${VERSION} proxy=${PROXY} (mirrors: pip=${PIP_INDEX_URL:-官方} apt=${APT_MIRROR:-官方})"

built=()
for entry in "${RELEASE_IMAGES[@]}"; do
  IFS='|' read -r name dockerfile target <<< "$entry"
  if [ $# -gt 0 ] && ! _matches "$name" "$@"; then
    echo "==> skip $name (不匹配子集)"
    continue
  fi
  # gpu runtime 镜像依赖外部 base 镜像 brainpilot-gpu-base 先就位（FROM 引用它）。
  # 缺则尝试 docker pull（registry 已发布时可拉），再失败给清晰指引、跳过本镜像。
  if [ "$target" = "gpu" ]; then
    if ! sudo docker image inspect "${GPU_BASE_IMAGE}:${GPU_BASE_TAG}" >/dev/null 2>&1; then
      echo "==> base 镜像 ${GPU_BASE_IMAGE}:${GPU_BASE_TAG} 本地缺失，尝试 pull…"
      _ghcr_repo="$(remote_repo "$GPU_BASE_IMAGE" "ghcr.io/neuroaihub" "flat")"
      if sudo docker pull "${_ghcr_repo}:${GPU_BASE_TAG}" 2>/dev/null; then
        sudo docker tag "${_ghcr_repo}:${GPU_BASE_TAG}" "${GPU_BASE_IMAGE}:${GPU_BASE_TAG}"
        echo "==> 已 pull 并 retag 为 ${GPU_BASE_IMAGE}:${GPU_BASE_TAG}"
      else
        echo "!!! 缺 GPU base 镜像且无法 pull。先构建 base：" >&2
        echo "      bash scripts/release-gpu-base.sh build" >&2
        echo "    然后重跑本命令。跳过 $name。" >&2
        continue
      fi
    fi
  fi
  target_arg=(); [ -n "$target" ] && target_arg=( --target "$target" )
  echo "==> building $name (tags: latest, $VERSION${target:+, target=$target})"
  sudo DOCKER_BUILDKIT=0 docker build "${COMMON[@]}" "${target_arg[@]}" \
    -f "$dockerfile" -t "$name:latest" -t "$name:$VERSION" .
  built+=("$name")
done

echo "==> BUILD DONE: ${built[*]:-(无匹配镜像)}"
sudo docker images | grep -E 'brainpilot-(main|sandbox)' || true
