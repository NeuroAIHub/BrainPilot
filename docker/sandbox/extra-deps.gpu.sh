#!/usr/bin/env bash
# extra-deps.gpu.sh — sandbox-gpu 变体依赖（构建期执行）。
# = cpu 的 python3 基础 + 预装科学/PDF 栈 + CUDA 12.4 PyTorch。
# torch 版本/源沿用 legacy 实测配置（legacy/docker/agent_runtime/Dockerfile.base，2026-05-29）。
# 镜像源经 ENV 注入（见 _python-base.sh）；torch 用专属 whl 源不受其影响。
set -euo pipefail

# 1) python3 + pip + 镜像源（与 cpu 共享）
source "$(dirname "$0")/_python-base.sh"

# 2) 科学/PDF 栈（最新稳定，走上面配置的 pip 源）
pip3 install --break-system-packages \
  numpy pandas scipy matplotlib scikit-learn pillow pypdf pdfplumber

# 3) CUDA 12.4 runtime wheels（pip 默认源，国内由 PIP_INDEX_URL 指向阿里云/清华）
pip3 install --break-system-packages \
  nvidia-cuda-runtime-cu12==12.4.127 nvidia-cuda-nvrtc-cu12==12.4.127 \
  nvidia-cudnn-cu12==9.1.0.70 nvidia-cublas-cu12==12.4.5.8 \
  nvidia-cufft-cu12==11.2.1.3 nvidia-curand-cu12==10.3.5.147 \
  nvidia-cusolver-cu12==11.6.1.9 nvidia-cusparse-cu12==12.3.1.170 \
  nvidia-nccl-cu12==2.21.5 nvidia-nvtx-cu12==12.4.127 nvidia-nvjitlink-cu12==12.4.127

# 4) PyTorch cu124（官方 whl 源——清华 pytorch-wheels 不同步 cu124 会 404；
#    此 index-url 是 torch 专属、不受镜像源外置影响。构建时 --network=host 借宿主代理）
pip3 install --break-system-packages \
  torch==2.5.1+cu124 torchvision==0.20.1+cu124 torchaudio==2.5.1+cu124 \
  --index-url https://download.pytorch.org/whl/cu124 \
  --extra-index-url "${PIP_INDEX_URL:-https://pypi.org/simple/}"

echo "[extra-deps.gpu] sci stack + torch 2.5.1+cu124 installed"
