# =============================================================================
# brainpilot-sandbox / -gpu — runtime 代码镜像（@brainpilot/runtime + Pi SDK）。
#
#   经典构建器专用（DOCKER_BUILDKIT=0）。镜像切换靠多 stage + --target：
#     --target cpu  → brainpilot-sandbox      (python-baseline + 业务层)
#     --target gpu  → brainpilot-sandbox-gpu  (brainpilot-gpu-base + 业务层)
#
#   两层模型（torch/cuda 与代码解耦）：
#     - 重依赖（CUDA 12.4 + torch 2.6.0 + 科学栈，~2.7GB）住在 *独立发布* 的
#       base 镜像 brainpilot-gpu-base（见 docker/sandbox/Dockerfile.gpu-base），
#       低频更新、按依赖版本打 tag。
#     - 本文件的 gpu stage 只 `FROM ghcr.io/.../brainpilot-gpu-base:<tag>` + 业务层，
#       随 monorepo 版本迭代；代码变更只重建薄业务层，绝不重装 torch。
#     ⚠️ base tag 写死在下面的 FROM 里（经典构建器不支持 `FROM ${ARG}`）。升级
#        torch/cuda 时同步改：本文件 FROM、Dockerfile.gpu-base、release-images.sh。
#
#   业务层 6 行（COPY×3 + ENV + EXPOSE + HEALTHCHECK + CMD）在 cpu/gpu 两 stage
#   各写一份：父 stage 不同（cpu←python-baseline / gpu←brainpilot-gpu-base），
#   ENV/CMD/HEALTHCHECK 无法跨非父 stage 继承。SSOT 仍是 monorepo 源码 +
#   extra-deps 脚本，这 6 行是声明性常量。改动业务层时务必同步改两处。
# =============================================================================

# ---- builder: install + build the runtime project chain ----
FROM node:22-slim AS builder
ARG NPM_REGISTRY=""
ARG HTTP_PROXY=""
ARG HTTPS_PROXY=""
ENV HTTP_PROXY=${HTTP_PROXY} HTTPS_PROXY=${HTTPS_PROXY}
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY scripts ./scripts
COPY packages ./packages
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
    && npm ci
# sandbox runs only the runtime server — build just its project chain
# (protocol ← runtime), not the whole monorepo (web/cli/backend-core).
RUN npx tsc -b packages/runtime

# ---- python-baseline: node + python3 + pip + curl + 镜像源 ----
#   cpu 链的根，也是 gpu-base 的父（python+curl 层只构建一次，被两条链复用）。
FROM node:22-slim AS python-baseline
ARG APT_MIRROR=""
ARG PIP_INDEX_URL=""
ARG PIP_EXTRA_INDEX_URL=""
ENV APT_MIRROR=${APT_MIRROR} PIP_INDEX_URL=${PIP_INDEX_URL} PIP_EXTRA_INDEX_URL=${PIP_EXTRA_INDEX_URL}
COPY docker/sandbox/_python-base.sh /tmp/_python-base.sh
RUN bash /tmp/_python-base.sh

# ---- cpu: python-baseline + 业务层 ----
#   torch/cuda 已外移到独立 base 镜像，本文件不再有内联安装 torch 的 stage，故
#   cpu 与 gpu 的相对顺序不再有「误装 torch」风险（gpu 直接 FROM 外部 base）。
FROM python-baseline AS cpu
# cpu 业务依赖注入点（python 基线已在 python-baseline 装好；默认空操作）。
COPY docker/sandbox/extra-deps.sh /tmp/extra-deps.sh
RUN bash /tmp/extra-deps.sh
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/package.json ./package.json
ENV PORT=8081 AGENT_RUNTIME_PORT=8081 BP_DATA_DIR=/root/.bp-root
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f "http://localhost:${AGENT_RUNTIME_PORT:-8081}/health" || exit 1
CMD ["node", "packages/runtime/dist/server.js"]

# ---- gpu: 已发布的 brainpilot-gpu-base + 同一段业务层（与 cpu 逐字相同）----
#   torch/cuda/科学栈来自外部 base 镜像（docker/sandbox/Dockerfile.gpu-base），
#   不在此安装 → monorepo 代码变更只重建下面的业务层，base 层完全复用。
#   ⚠️ base tag 写死（经典构建器不支持 FROM ${ARG}）；升级须同步三处（见文件头）。
FROM ghcr.io/neuroaihub/brainpilot-gpu-base:cu124-torch2.6.0 AS gpu
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/package.json ./package.json
ENV PORT=8081 AGENT_RUNTIME_PORT=8081 BP_DATA_DIR=/root/.bp-root
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f "http://localhost:${AGENT_RUNTIME_PORT:-8081}/health" || exit 1
CMD ["node", "packages/runtime/dist/server.js"]
