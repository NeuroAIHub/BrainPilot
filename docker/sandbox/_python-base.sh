#!/usr/bin/env bash
# _python-base.sh — cpu/gpu sandbox 共享的 Python、网络与文件工具安装段。
# 由 Dockerfile 的 python-baseline stage 直接 RUN（gpu-base 继承该 stage，无需重跑）。
# curl/ca-certificates 供 HEALTHCHECK 探活；Git 供 GoT workspace checkpoint；
# ripgrep/fd/file 供 agent 搜索代码、发现文件与识别上传文件。它们都是 cpu/gpu 运行时依赖。
# 镜像源来自 ENV（Dockerfile 经 build-arg 透传），为空则用镜像自带官方源
# （pypi.org / deb.debian.org）。
set -euo pipefail

# apt 源：APT_MIRROR 注入则替换官方源
[ -n "${APT_MIRROR:-}" ] && sed -i "s|http://deb.debian.org|$APT_MIRROR|g" \
  /etc/apt/sources.list.d/*.sources /etc/apt/sources.list 2>/dev/null || true
apt-get update && apt-get install -y --no-install-recommends \
  python3 python3-pip python3-venv curl ca-certificates git ripgrep fd-find file
rm -rf /var/lib/apt/lists/*

# Fail the image build rather than shipping a runtime whose checkpoint feature
# can only report unavailable.
git --version >/dev/null
rg --version >/dev/null
fdfind --version >/dev/null
file --version >/dev/null

# pip 源：PIP_INDEX_URL 注入则固化 /etc/pip.conf，否则用 pip 官方默认
if [ -n "${PIP_INDEX_URL:-}" ]; then
  { echo '[global]'
    echo "index-url = ${PIP_INDEX_URL}"
    [ -n "${PIP_EXTRA_INDEX_URL:-}" ] && echo "extra-index-url = ${PIP_EXTRA_INDEX_URL}"
    echo 'timeout = 60'
  } > /etc/pip.conf
fi
