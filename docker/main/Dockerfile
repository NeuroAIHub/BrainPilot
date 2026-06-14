# syntax=docker/dockerfile:1
# =============================================================================
# brainpilot-main — backend (Hono) serving the @brainpilot/web SPA.
# Connects to a pre-started sandbox runtime via BP_RUNTIME_URL (basic mode).
# =============================================================================

# ---- builder: install + build the whole monorepo (incl. web dist) ----
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
# `npm run build` runs `--workspaces`, which already builds @brainpilot/web (tsc -b && vite build).
RUN npm run build

# ---- runtime: backend server + built web dist ----
FROM node:22-slim AS runtime

ARG APT_MIRROR=""

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

# Deployment mode is chosen at run time via compose env (BP_RUNTIME_URL → static,
# BP_ORCHESTRATOR=docker → dynamic). Without those, the image defaults to local.
ENV PORT=9001 BP_HOST=0.0.0.0
EXPOSE 9001

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f "http://localhost:${PORT:-9001}/api/health" || exit 1

CMD ["node", "packages/backend-core/dist/server.js"]
