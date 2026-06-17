# =============================================================================
# brainpilot-sandbox / -gpu — 分层 runtime 镜像（@brainpilot/runtime + Pi SDK）。
#
#   经典构建器专用（DOCKER_BUILDKIT=0）—— 故不用 `FROM ${ARG}`（经典构建器不支持，
#   实测报 "base name should not be blank"）。镜像切换靠多 stage + --target：
#     --target cpu  → brainpilot-sandbox      (python-baseline + 业务层)
#     --target gpu  → brainpilot-sandbox-gpu  (gpu-base[+sci/cuda/torch] + 业务层)
#
#   分层设计目的：把 torch/cuda（~2.7GB）沉到 monorepo 业务层之下的 gpu-base 中间
#   stage。monorepo 代码变更不触达 gpu-base，故发版时 torch 层命中缓存、不重装。
#
#   业务层 6 行（COPY×3 + ENV + EXPOSE + HEALTHCHECK + CMD）在 cpu/gpu 两 stage
#   各写一份：父 stage 不同（cpu←python-baseline / gpu←gpu-base），ENV/CMD/
#   HEALTHCHECK 无法跨非父 stage 继承。SSOT 仍是 monorepo 源码 + extra-deps 脚本，
#   这 6 行是声明性常量。改动业务层时务必同步改两处。
# =============================================================================

# ---- builder: install + build the runtime project chain ----
FROM node:22-slim AS builder
ARG NPM_REGISTRY=""
ARG HTTP_PROXY=""
ARG HTTPS_PROXY=""
ENV HTTP_PROXY=${HTTP_PROXY} HTTPS_PROXY=${HTTPS_PROXY}
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
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
#   放在 gpu-base 之前：经典构建器（DOCKER_BUILDKIT=0）按 Dockerfile 文本顺序执行到
#   --target 指定的 stage（不做 BuildKit 那样的依赖图剪枝）。cpu 在前 → --target cpu
#   执行到此即止，不会触发下面 gpu-base 的 torch 安装。✅ 实测：cpu 在 gpu-base 之后会
#   误装 torch。务必保持 cpu 在 gpu-base 之前。
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

# ---- gpu-base: cpu 之后 + 科学栈 + CUDA + torch（重依赖，独立于 monorepo）----
#   缓存收益的核心层：不 COPY monorepo，故业务代码变更不会让这层失效、torch 不重装。
#   FROM python-baseline：复用 python+curl 层；ENV（APT_MIRROR/PIP_*）继承，无需重声明。
#   位于 cpu 之后、gpu 之前：仅 --target gpu 会执行它（gpu 是文本最末 stage）。
FROM python-baseline AS gpu-base
ARG TORCH_WHEEL_BASE=""
ENV TORCH_WHEEL_BASE=${TORCH_WHEEL_BASE}
COPY docker/sandbox/extra-deps.gpu-libs.sh /tmp/extra-deps.gpu-libs.sh
RUN bash /tmp/extra-deps.gpu-libs.sh

# ---- gpu: gpu-base + 同一段业务层（与 cpu 逐字相同，见文件头说明）----
FROM gpu-base AS gpu
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/package.json ./package.json
ENV PORT=8081 AGENT_RUNTIME_PORT=8081 BP_DATA_DIR=/root/.bp-root
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f "http://localhost:${AGENT_RUNTIME_PORT:-8081}/health" || exit 1
CMD ["node", "packages/runtime/dist/server.js"]
