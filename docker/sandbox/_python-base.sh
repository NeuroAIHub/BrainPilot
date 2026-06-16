#!/usr/bin/env bash
# _python-base.sh — cpu/gpu sandbox 共享的 python3 + pip + curl + 镜像源安装段。
# 由 Dockerfile 的 python-baseline stage 直接 RUN（gpu-base 继承该 stage，无需重跑）。
# curl/ca-certificates 供 HEALTHCHECK 探活用，cpu/gpu 都需要，故装在此共享层。
# 镜像源来自 ENV（Dockerfile 经 build-arg 透传），为空则用镜像自带官方源
# （pypi.org / deb.debian.org）。
set -euo pipefail

# apt 源：APT_MIRROR 注入则替换官方源
[ -n "${APT_MIRROR:-}" ] && sed -i "s|http://deb.debian.org|$APT_MIRROR|g" \
  /etc/apt/sources.list.d/*.sources /etc/apt/sources.list 2>/dev/null || true
apt-get update && apt-get install -y --no-install-recommends \
  python3 python3-pip python3-venv curl ca-certificates
rm -rf /var/lib/apt/lists/*

# pip 源：PIP_INDEX_URL 注入则固化 /etc/pip.conf，否则用 pip 官方默认
if [ -n "${PIP_INDEX_URL:-}" ]; then
  { echo '[global]'
    echo "index-url = ${PIP_INDEX_URL}"
    [ -n "${PIP_EXTRA_INDEX_URL:-}" ] && echo "extra-index-url = ${PIP_EXTRA_INDEX_URL}"
    echo 'timeout = 60'
  } > /etc/pip.conf
fi
