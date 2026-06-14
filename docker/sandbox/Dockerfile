# syntax=docker/dockerfile:1
# =============================================================================
# brainpilot-sandbox — runtime container (@brainpilot/runtime + Pi SDK).
# Lightweight baseline (Node only). Extra deps via docker/sandbox/extra-deps.sh.
# =============================================================================

# ---- builder: install + build the whole monorepo ----
FROM node:22-slim AS builder

# Optional registry/proxy acceleration (default = official; pass via --build-arg).
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

# ---- runtime: minimal image running the runtime server ----
FROM node:22-slim AS runtime

ARG APT_MIRROR=""
ARG NPM_REGISTRY=""

# curl is needed for the HEALTHCHECK probe.
RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|http://deb.debian.org|$APT_MIRROR|g" /etc/apt/sources.list.d/*.sources 2>/dev/null || true; \
    fi \
    && apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/package.json ./package.json

# User-editable dependency injection point (runs at build time).
COPY docker/sandbox/extra-deps.sh /tmp/extra-deps.sh
RUN chmod +x /tmp/extra-deps.sh && bash /tmp/extra-deps.sh

ENV PORT=8081 AGENT_RUNTIME_PORT=8081 BP_DATA_DIR=/root/.bp-root
EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f "http://localhost:${AGENT_RUNTIME_PORT:-8081}/health" || exit 1

CMD ["node", "packages/runtime/dist/server.js"]
