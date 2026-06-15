#!/usr/bin/env bash
# extra-deps.sh — cpu sandbox 基线依赖（构建期执行，由 Dockerfile RUN 调用）。
# 装 python3 + pip + venv，让 agent 能通过 Pi SDK 的 bash 工具运行 Python 代码
# （persona 指示 agent "write/edit 文件 + bash 运行"）。
# 不预装科学库 —— agent 按需自装（persona 本就要求 agent 管理依赖），保持镜像轻量。
# GPU 变体见 extra-deps.gpu.sh。镜像源经 ENV 注入（见 _python-base.sh）。
set -euo pipefail

source "$(dirname "$0")/_python-base.sh"

echo "[extra-deps] cpu baseline: python3 $(python3 --version 2>&1) installed (no sci libs)"
