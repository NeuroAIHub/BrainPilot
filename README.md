# BrainPilot

BrainPilot is an open-source, single-user multi-agent collaboration platform built with TypeScript + the Pi SDK (a Principal agent coordinating specialist agents over a file-based mailbox), served as a Hono backend + React SPA.

## 🚀 Quick Start (Docker)

### Prerequisites
- Docker 20.10+ and Docker Compose v2
- An Anthropic API key (or `BP_MOCK=1` for a no-key test run)

### 1. Configure
```bash
cp .env.example .env
# edit .env: set ANTHROPIC_API_KEY, adjust BP_MAIN_PORT / BP_SANDBOX_PORT if needed
```

### 2. Launch (static: 1 main + 1 fixed sandbox)
```bash
docker compose up -d --build
```
Open http://localhost:9001 (or your `BP_MAIN_PORT`).

Host networking instead of bridge:
```bash
docker compose -f docker-compose.yml -f docker-compose.host.yml up -d --build
```

### 3. Stop
```bash
docker compose down
```

## 🤖 Using a third-party / custom model

By default BrainPilot talks to Pi's built-in Anthropic endpoint. Pi does **not**
read `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` on its own — BrainPilot bridges
them into a Pi provider for you. Two tiers:

**Simple — an Anthropic-compatible gateway.** Set these in `.env`:
```bash
ANTHROPIC_BASE_URL=https://your-gateway.example.com/api
ANTHROPIC_MODEL=kimi-k2.6
ANTHROPIC_API_KEY=<your gateway key>
# optional limits (defaults: 200000 / 8192)
ANTHROPIC_CONTEXT_WINDOW=262144
ANTHROPIC_MAX_TOKENS=8192
```
BrainPilot auto-generates a one-provider `models.json` pointed at the gateway
(wire protocol = Anthropic Messages, `{baseUrl}/v1/messages`).

**Advanced — your own `models.json`** (multiple providers, custom headers,
`compat` flags, or OpenAI-compatible endpoints like Ollama/vLLM). Copy the
template and edit it:
```bash
cp models.example.json brainpilot/models.json   # brainpilot/ = your BP_DATA_DIR
```
Then in `.env`:
```bash
# Docker: this is the in-container path. BP_DATA_DIR mounts to /root/.bp-root,
# so a file at ./brainpilot/models.json is /root/.bp-root/models.json inside.
BP_MODELS_JSON=/root/.bp-root/models.json
ANTHROPIC_MODEL=<a model id from that file>
BP_MODEL_PROVIDER=<provider name>   # optional; default = file's first provider
```
(Without Docker, `BP_MODELS_JSON` is just a normal filesystem path.)

Full `models.json` schema — `api` types, `compat` flags, `$ENV` key
interpolation, per-model cost/limits — is documented at
<https://pi.dev/docs/latest/models>.

## 🧩 Customizing sandbox dependencies

The `brainpilot-sandbox` image ships a **lightweight baseline** (Node + runtime
only — no Python, no GPU, no terminal). To add dependencies, edit
**`docker/sandbox/extra-deps.sh`** — a build-time hook with worked examples for:
- installing Python3 + pip packages,
- installing system packages (apt),
- installing global npm tools.

After editing, rebuild: `docker compose build sandbox`.

Build-time acceleration (optional, default = official sources): pass
`NPM_REGISTRY` / `APT_MIRROR` / `HTTP_PROXY` via `.env` (consumed as build args).

## 🔀 Deployment modes

Deployment mode is a **Docker-only** concern. The npm path (below) is always a
single-user, local-process setup and needs none of these variables.

| Mode | Sandbox topology | Selected by | This repo |
|------|------|------|-----------|
| `static` | 1 shared `main` + 1 fixed `sandbox` (compose-managed), single user | `BP_RUNTIME_URL` set (points main at the sandbox) | ✅ shipped |
| `dynamic` | shared `main` + **per-user** sandbox started on demand via docker.sock | `BP_ORCHESTRATOR=docker` (and leave `BP_RUNTIME_URL` unset) | 🚧 skeleton only (`docker-compose.dynamic.yml`); implemented in a downstream multi-user repo, reusing these images unchanged |

A Docker-free local path also exists (`@brainpilot/app`, `brainpilot up`) — see the app package. It runs a single user on the local orchestrator; deployment-mode variables do not apply.

## 💻 Install without Docker

BrainPilot runs without Docker via `@brainpilot/app` — a local launcher that
spawns the backend + runtime as child processes.

### Path A — npm (end users)
```bash
npm install -g @brainpilot/app
brainpilot init      # scaffold config under ./brainpilot
brainpilot up        # foreground by default; Ctrl-C to stop
```
Use detached mode when you want a background process managed by the CLI:
```bash
brainpilot up --detach
brainpilot status    # health + child pid (detached mode)
brainpilot logs      # tail backend log; add --runtime for runtime log
brainpilot down      # stop the detached backend
```
No API key needed for a smoke run: `BP_MOCK=1 brainpilot up`.

### Path B — from source (contributors)
From a local BrainPilot checkout:
```bash
npm install
npm run build
npm run bp -- up     # equivalent to `brainpilot up` from the built CLI
```

### Publishing (maintainers)
```bash
npm login                 # account with @brainpilot scope access
npm run version:check     # verify all workspace package versions are aligned
npm run release:dry       # pack-preview all 5 public packages (no upload)
npm run release           # version-sync, build, then publish protocol→runtime→backend-core→web→app
```
`@brainpilot/client-cli` stays private and is never published.

## 🧪 Testing

```bash
npm run typecheck                    # tsc -b across non-web packages
BP_MOCK=1 npx vitest run             # all non-web tests, deterministic mock (no API quota)
bash scripts/smoke-e2e.sh            # backend → runtime(mock) → SSE → client smoke
bash scripts/smoke-docker.sh         # manual real-Docker smoke (needs a local daemon)
( cd packages/web && npm test && npm run build )   # web: vitest + vite build
```

`BP_MOCK=1` selects a deterministic mock agent so tests never consume API quota.

## 🧱 Monorepo layout

| Package | Role |
|---------|------|
| `@brainpilot/protocol` | zod wire SSOT: AG-UI event union, domain types, HTTP route contract |
| `@brainpilot/runtime` | Pi SDK orchestration, SessionManager (state authority), mailbox, system tools, MCP bridge, Hono+SSE server |
| `@brainpilot/backend-core` | Hono REST + SSE byte-passthrough, Orchestrator abstraction (Local / Static / Docker) |
| `@brainpilot/web` | React/Vite SPA (AG-UI consumer) |
| `@brainpilot/app` | `brainpilot` / `bnpt` — Docker-free local launch |
| `@brainpilot/client-cli` | `bp-client` — headless end-to-end verification client |

## 📄 License

See LICENSE.
