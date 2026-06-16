#!/usr/bin/env bash
# extra-deps.gpu-libs.sh — gpu-base stage 的重依赖（科学栈 + CUDA 运行库 + PyTorch）。
# 不含 python 安装段：python3/pip/curl/镜像源已在 python-baseline stage 装好，
# gpu-base 继承该 stage（见 Dockerfile）。本脚本独立于 monorepo，故 gpu-base 层在
# monorepo 代码变更时命中缓存、不重装 ~2.7GB torch/cuda（分层设计的核心收益）。
#
# 瘦身策略（2026-06-16，见 docs/research/2026-06-16-gpu-sandbox-slimming.md）：
#   --no-cache-dir（省 ~2.1GB pip 缓存）+ torch 2.6.0（小 133MB）+ 卸 triton（省 ~0.69GB）。
#   实测 14.5GB → 9.25GB，零架构风险、零功能损失。
# torch cu124 走上海交大 pytorch-wheels 镜像（国内高速、绕开官方源经代理崩溃，见 §3 注释）。
set -euo pipefail

# 1) 科学/PDF 栈（最新稳定，走 /etc/pip.conf 配置的 pip 源）
pip3 install --no-cache-dir --break-system-packages \
  numpy pandas scipy matplotlib scikit-learn pillow pypdf pdfplumber

# 2) CUDA 12.4 runtime wheels（pip 默认源，国内由 PIP_INDEX_URL 指向阿里云/清华）
#    cusparselt 是 torch 2.6.0 新增的独立依赖（2.5.1 时 bundle 在 torch/lib 内）。
pip3 install --no-cache-dir --break-system-packages \
  nvidia-cuda-runtime-cu12==12.4.127 nvidia-cuda-nvrtc-cu12==12.4.127 \
  nvidia-cuda-cupti-cu12==12.4.127 \
  nvidia-cudnn-cu12==9.1.0.70 nvidia-cublas-cu12==12.4.5.8 \
  nvidia-cufft-cu12==11.2.1.3 nvidia-curand-cu12==10.3.5.147 \
  nvidia-cusolver-cu12==11.6.1.9 nvidia-cusparse-cu12==12.3.1.170 \
  nvidia-cusparselt-cu12==0.6.2 \
  nvidia-nccl-cu12==2.21.5 nvidia-nvtx-cu12==12.4.127 nvidia-nvjitlink-cu12==12.4.127

# 3) PyTorch cu124 —— curl 直下上海交大 wheel 文件，再 pip 装本地文件。
#    为什么不用 pip --index-url 交大：交大 simple 索引页（/cu124/torch/）里登记的 wheel 链接
#    指向官方 download.pytorch.org → 302 Cloudflare R2，pip 跟着去 R2，该流经 Clash 代理会
#    限速崩溃+哈希不匹配（2026-06-15 两次实测）。而直接拼文件 URL（/cu124/<wheel>）会 302 到
#    交大自有 S3（s3.jcloud.sjtu.edu.cn，国内 ~13MB/s），绕开 R2 与代理。故 curl 直下。
#    torch 的纯 Python 依赖（sympy/networkx/jinja2/fsspec…）仍由 pip 从 PIP_INDEX_URL 装。
#    源根可被 TORCH_WHEEL_BASE 覆盖（默认交大，Dockerfile 经 build-arg 透传）。
TORCH_WHEEL_BASE="${TORCH_WHEEL_BASE:-https://mirror.sjtu.edu.cn/pytorch-wheels/cu124}"
_tw=/tmp/torch-wheels
mkdir -p "$_tw"
for whl in \
  "torch-2.6.0%2Bcu124-cp311-cp311-linux_x86_64.whl" \
  "torchvision-0.21.0%2Bcu124-cp311-cp311-linux_x86_64.whl" \
  "torchaudio-2.6.0%2Bcu124-cp311-cp311-linux_x86_64.whl"; do
  # %2B 是 + 的 URL 编码；落地文件名解码回 +
  out="$_tw/$(printf '%s' "$whl" | sed 's/%2B/+/g')"
  echo "[extra-deps.gpu] downloading $out"
  curl -fSL --retry 5 --retry-delay 3 --connect-timeout 30 -o "$out" "$TORCH_WHEEL_BASE/$whl"
done
# pip 装本地 wheel；torch 依赖从 PIP_INDEX_URL（阿里云/官方）补齐
pip3 install --no-cache-dir --break-system-packages --retries 5 --timeout 120 "$_tw"/*.whl
rm -rf "$_tw"

# 4) 卸 triton —— torch 把它列为硬依赖（会随 torch wheel 装上），但仅 torch.compile/
#    自定义 kernel 路径需要。本沙盒只跑常规张量/推理/训练，故卸掉省 ~0.69GB。
#    注意：本镜像是 PEP 668 externally-managed，uninstall 同样需 --break-system-packages，
#    否则被静默拒绝（2026-06-16 实测漏卸）。不吞 stderr，便于发现问题。
pip3 uninstall -y --break-system-packages triton
# 卸载残留的 __pycache__/空目录兜底
rm -rf /usr/local/lib/python3.11/dist-packages/triton 2>/dev/null || true

echo "[extra-deps.gpu] sci stack + torch 2.6.0+cu124 installed (triton removed, no pip cache)"
