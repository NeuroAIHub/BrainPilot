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
ARG VITE_KB_SETTINGS_ENABLED="1"
ENV HTTP_PROXY=${HTTP_PROXY} HTTPS_PROXY=${HTTPS_PROXY}

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY scripts ./scripts
COPY packages ./packages
# KnowledgeBase/ is the SSOT for the Python pipeline; @brainpilot/kb-scripts's
# `prepack` hook mirrors this dir into packages/kb-scripts/kb/ at pack time.
# Docker images don't go through `npm pack`, so we do the same copy explicitly
# here — otherwise the materialize-kb hook has no source and the "Set up
# Python environment" button in the web UI fails inside the container. See
# issue #378 Part 1 and PR #379 review.
COPY KnowledgeBase ./KnowledgeBase
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
    && npm ci \
    && node packages/kb-scripts/scripts/stage.mjs
# `npm run build` runs `--workspaces`, which already builds @brainpilot/web (tsc -b && vite build).
RUN npm run build

# ---- runtime: backend server + built web dist ----
FROM node:22-slim AS runtime

ARG APT_MIRROR=""

RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|http://deb.debian.org|$APT_MIRROR|g" /etc/apt/sources.list.d/*.sources 2>/dev/null || true; \
    fi \
    && apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/package.json ./package.json

# Deployment mode is chosen at run time via compose env (BP_RUNTIME_URL → static,
# BP_ORCHESTRATOR=docker → dynamic). Without those, the image defaults to local.
#
# Optional memory budget (issue #20 / R-4): a host that caps container memory can
# set BP_MEM_LIMIT_MB=<budget MB> to make the runtime soft-throttle at ~85% before
# the kernel OOM-kills it. Pair it with a V8 heap cap at the launcher (the runtime
# never sets one itself), e.g. NODE_OPTIONS=--max-old-space-size=<~75% of budget>.
# Both are strictly opt-in: unset → no behavior change.
ENV PORT=9001 BP_HOST=0.0.0.0
EXPOSE 9001

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f "http://localhost:${PORT:-9001}/api/health" || exit 1

CMD ["node", "packages/backend-core/dist/server.js"]
