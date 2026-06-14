#!/usr/bin/env bash
# =============================================================================
# extra-deps.sh — 自定义 sandbox 镜像依赖（构建期执行，由 Dockerfile RUN 调用）
# =============================================================================
# 这个脚本在 sandbox 镜像构建时运行。默认轻量基线只含 Node + @brainpilot/runtime
# + Pi SDK，不含 Python / 系统包 / 终端。需要更多依赖时，编辑本文件即可，
# 无需改 Dockerfile 本体。重新 `docker compose build sandbox` 生效。
#
# 镜像源加速：通过 build-arg 注入 APT_MIRROR / NPM_REGISTRY（见 Dockerfile），
# 此处可直接读取环境变量 $APT_MIRROR / $NPM_REGISTRY。
#
# ---------------------------------------------------------------------------
# 示例 1：安装 Python3 + pip 包
# ---------------------------------------------------------------------------
#   set -euo pipefail
#   apt-get update
#   apt-get install -y --no-install-recommends python3 python3-pip
#   pip3 install --no-cache-dir numpy pandas
#   rm -rf /var/lib/apt/lists/*
#
# ---------------------------------------------------------------------------
# 示例 2：安装系统包（如 git、curl 已在基础镜像，这里加 ripgrep）
# ---------------------------------------------------------------------------
#   set -euo pipefail
#   apt-get update && apt-get install -y --no-install-recommends ripgrep
#   rm -rf /var/lib/apt/lists/*
#
# ---------------------------------------------------------------------------
# 示例 3：安装 npm 全局工具
# ---------------------------------------------------------------------------
#   npm install -g --no-fund --no-audit some-cli-tool
#
# ---------------------------------------------------------------------------
# 默认：不装任何额外依赖（no-op）。删掉下面这行并填入你的命令即可。
# ---------------------------------------------------------------------------
echo "[extra-deps] no extra dependencies (lightweight baseline)"
