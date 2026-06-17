#!/usr/bin/env bash
# extra-deps.sh — cpu sandbox 业务依赖注入点（由 cpu stage RUN 调用）。
# python3/pip/curl 已在 python-baseline stage 装好（见 _python-base.sh），此处不再重装。
# 默认空操作，保持 cpu 镜像轻量（agent 按需自装依赖，persona 本就要求 agent 管理依赖）。
# 如需给 cpu 镜像预装 pip 包，在此追加，例如：
#   pip3 install --no-cache-dir --break-system-packages <pkg>...
# GPU 变体的重依赖见 extra-deps.gpu-libs.sh。
set -euo pipefail

echo "[extra-deps] cpu baseline ready: $(python3 --version 2>&1) (no sci libs)"
