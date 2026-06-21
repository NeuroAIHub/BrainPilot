# BrainPilot

BrainPilot is an open-source, single-user multi-agent collaboration platform built with TypeScript + the Pi SDK (a Principal agent coordinating specialist agents over a file-based mailbox), served as a Hono backend + React SPA.

## 🚀 Quick Start (npm)

BrainPilot runs as a local process via `@brainpilot/app` — no Docker required.
This is the recommended way to get started.

### Prerequisites
- Node.js ≥ 22
- An Anthropic API key (or `BP_MOCK=1` for a no-key test run)

### 1. Install
```bash
npm install -g @brainpilot/app
```
This installs the `brainpilot` CLI (`bnpt` is a built-in short alias for the same command).

### 2. Initialize
```bash
brainpilot init --api-key <your-anthropic-key>   # scaffold config under ./brainpilot
```
The key is persisted to `brainpilot/bp_template/providers.json`. You can also omit
`--api-key` and supply the key via the `ANTHROPIC_API_KEY` environment variable
instead. A missing key no longer blocks launch — `brainpilot up` starts anyway
and you can configure the **provider url / key / model** in the web **Settings
UI** after it opens (the recommended path; it writes `providers.json` for you).
Without a key (and without `BP_MOCK=1`), agents simply can't make a real LLM call
until one is set.

To configure a gateway / third-party endpoint in one command, add `--base-url`
(and optionally `--model`):
```bash
brainpilot init --api-key <key> --base-url https://your-gateway.example.com/api --model kimi-k2.6
```
`init` always ends by reporting whether a key is currently resolvable and where
to set one, so re-running it on an already-initialized dir is safe and informative.

### 3. Launch
```bash
brainpilot up        # foreground by default; Ctrl-C to stop
```
No API key needed for a smoke run: `BP_MOCK=1 brainpilot up`.

Use detached mode when you want a background process managed by the CLI:
```bash
brainpilot up --detach
brainpilot status    # health + child pid (detached mode)
brainpilot logs      # tail backend log; add --runtime for runtime log
brainpilot down      # stop the detached backend
```

### Where your files live

`brainpilot up` resolves a single **data directory** and keeps everything under
it. Precedence: `--dir <path>` > `BP_DATA_DIR` env > `./brainpilot` under the
current working directory. So a plain `brainpilot up` uses `./brainpilot/`.

```
brainpilot/                       # data root (default: ./brainpilot)
├── workspaces/<sessionId>/       # the agent's working directory (cwd) — one per
│                                 #   session; every file an agent reads/writes
│                                 #   or generates lands here
├── bp_template/                  # configuration (written by `brainpilot init`)
│   ├── providers.json            #   API key / base URL / model (providers)
│   ├── settings.json             #   runtime settings
│   ├── mcp_servers.json          #   MCP server connections
│   ├── agents/                   #   custom agent personas
├── .bp/<sessionId>/              # per-session state (metadata, trace graph)
├── brainpilot.config.json        # local top-level config
├── .env                          # environment variables
└── .runtime/                     # process state: logs/, pid files, server.json
```

> **Trust boundary.** In local (non-Docker) mode there is **no container
> isolation** — agents read and write directly on your machine, under
> `brainpilot/workspaces/<sessionId>/`. The UI hides the *Sandbox* control in
> this mode because there is no Docker sandbox to attach. If you need isolation,
> use the Docker deployment below, which runs agents inside a sandbox container.

## 💻 Run from source (contributors)

From a local BrainPilot checkout:
```bash
npm install
npm run build
npm run bp -- up --port 9005     # equivalent to `brainpilot up --port 9005`
```

> **Pass flags after `--`.** With `npm run`, the `--` separator is required so
> npm forwards `up --port 9005` to the CLI instead of consuming `--port` itself.
> `npm run bp up --port 9005` (no `--`) silently drops the flag and falls back to
> the default port. To skip npm entirely, call the built binary directly:
> ```bash
> node packages/cli/dist/bin.js up --port 9005
> ```
> (the runtime uses `port + 1`).

## 🐳 Docker deployment

The npm path above is the recommended single-user, local-process setup. Docker is
the third option — reach for it when you want a containerized, reproducible
deployment or the static `main` + `sandbox` topology.

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

GPU sandbox (needs an NVIDIA GPU + driver and the
[NVIDIA Container Toolkit](https://github.com/NVIDIA/nvidia-container-toolkit)):
```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```
This override points `sandbox` at the `brainpilot-sandbox-gpu` image (CUDA +
PyTorch, see Publishing below) and reserves the host GPUs into the container.
Without a GPU + toolkit, omit this file — the default `sandbox` is CPU-only.

### 3. Stop
```bash
docker compose down
```

### 🧩 Customizing sandbox dependencies

The `brainpilot-sandbox` (cpu) image ships a **lightweight baseline** (Node +
Python3 + runtime only — no sci stack, no GPU). For CUDA + PyTorch use the
`brainpilot-sandbox-gpu` image instead (see the GPU launch above and Publishing
below). To add dependencies to the cpu image, edit
**`docker/sandbox/extra-deps.sh`** — a build-time hook with worked examples for:
- installing Python3 + pip packages,
- installing system packages (apt),
- installing global npm tools.

After editing, rebuild: `docker compose build sandbox`.

Build-time acceleration (optional, default = official sources): pass
`NPM_REGISTRY` / `APT_MIRROR` / `HTTP_PROXY` via `.env` (consumed as build args).

### 🔀 Deployment modes

Deployment mode is a **Docker-only** concern. The npm path (above) is always a
single-user, local-process setup and needs none of these variables.

| Mode | Sandbox topology | Selected by | This repo |
|------|------|------|-----------|
| `static` | 1 shared `main` + 1 fixed `sandbox` (compose-managed), single user | `BP_RUNTIME_URL` set (points main at the sandbox) | ✅ shipped |
| `dynamic` | shared `main` + **per-user** sandbox started on demand via docker.sock | `BP_ORCHESTRATOR=docker` (and leave `BP_RUNTIME_URL` unset) | 🚧 skeleton only (`docker-compose.dynamic.yml`); implemented in a downstream multi-user repo, reusing these images unchanged |

A Docker-free local path also exists (`@brainpilot/app`, `brainpilot up`) — see the npm Quick Start above. It runs a single user on the local orchestrator; deployment-mode variables do not apply.

### Memory budget (`BP_MEM_LIMIT_MB`, optional)

For container deployments that cap memory (`docker run --memory` / a cgroup
ceiling), you can also tell the runtime its budget so it **self-throttles before
the kernel OOM-kills it**. Set `BP_MEM_LIMIT_MB` to the per-container budget in MB:

```bash
BP_MEM_LIMIT_MB=2048          # MB of container RSS the runtime should stay under
NODE_OPTIONS=--max-old-space-size=1536   # ~75% of the budget — set this at the launcher
```

- **Strictly opt-in.** Unset → no change at all (the runtime runs to host RAM as
  today; this is the correct default for single-user self-hosting). Only the
  cgroup `--memory` ceiling, if any, applies.
- **When set,** a soft watchdog watches RSS; past **~85%** of the budget it refuses
  new sessions/messages and emits a system message, rather than accepting work it
  can't hold. The kernel OOM-killer + Docker `restart` policy remain the backstop.
- **The heap cap is the launcher's job.** The runtime never sets
  `--max-old-space-size` for you (a non-empty default would wrongly cap single-user
  heaps); pass it via `NODE_OPTIONS` at ~75% of the budget if you want a V8 ceiling.
- **Recommended floor: ~2 GB** for a single-user sandbox running the full platform
  (runtime + agents + their tool subprocesses). The dominant driver is concurrent
  agents × model-context size (each agent holds its message history) plus transient
  bash/tool subprocess RSS; raise the budget for heavier multi-agent research.

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
cp models.example.json brainpilot/models.json   # brainpilot/ = your data dir (BP_DATA_DIR under Docker, ./brainpilot from `brainpilot init` locally)
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

## 🔌 Connecting MCP servers

Agents can call tools served over the **Model Context Protocol**. The runtime
bridges every configured MCP server into the agents' toolset: each remote tool
shows up namespaced as `mcp__<server>__<tool>`. Three transports are supported —
**stdio** (spawned local process), **streamable-http**, and **sse** (remote).

The built-in skills library (see below) is separate from MCP — it is loaded
through Pi's native skill pipeline, not as an MCP server, and needs no
configuration.

### 📚 Built-in skills library

Skills sources: 
- [https://github.com/NeuroAIHub/awesome_cognitive_and_neuroscience_skills.git](https://github.com/NeuroAIHub/awesome_cognitive_and_neuroscience_skills.git)
- [https://github.com/Yuan1z0825/nature-skills.git](https://github.com/Yuan1z0825/nature-skills.git)

The built-in skills ship in the `@brainpilot/skills` content package
(`packages/skills/skills/` inside the BrainPilot repo). At deploy time they are
**materialized into your data dir** at `<data-dir>/bp_template/skills/` (a
user-editable copy; an existing skill is never overwritten). The runtime loads
skills from there through **Pi's native skill pipeline** — each skill's
`name` + `description` is placed in the agent's system prompt, and the full
`SKILL.md` body is read on demand (progressive disclosure). Agents can also
force-load a skill with `/skill:<name>`.

They are organised as a two-level directory tree:

```
skills/
├── <category>/                  # e.g. 05_EEG_ERP, 14_Writing
│   ├── <skill-name>/            # one sub-folder per skill
│   │   ├── SKILL.md             # required: YAML frontmatter + Markdown body
│   │   └── references/          # optional: supplementary files
│   │       └── <topic>.md
```

**Adding a new skill:**

1. Pick (or create) a category folder under `packages/skills/skills/`.
   Existing categories:

   | Folder | Domain |
   |--------|--------|
   | `01_Meta-Skills` | Skill authoring & review |
   | `02_Cross-Domain_Foundation` | Statistics, visualisation, research literacy |
   | `03_Cognitive_Psychology` | Paradigms, scoring, DDM, SDT |
   | `04_Psycholinguistics` | Reading time, SPR, stimulus norming |
   | `05_EEG_ERP` | EEG preprocessing, ERP analysis, MNE-Python |
   | `06_fMRI_Neuroimaging` | fMRI preprocessing, GLM, pycortex, decoding |
   | `07_Computational_Modeling` | ACT-R, Bayesian modelling, parameter recovery |
   | `08_Computational_Neuroscience` | Neural population analysis, spiking networks |
   | `09_Cellular_Molecular_Neuroscience` | Calcium imaging, optogenetics |
   | `10_Clinical_Neuropsychology` | Lesion-symptom mapping, battery selection |
   | `11_Developmental_Cognition` | Infant looking-time design |
   | `12_Social_Cognition` | Theory-of-mind task selection |
   | `13_Visualization` | Nature-figure creation & chart design |
   | `14_Writing` | Markdown report writing |
   | `15_Others` | Neuroimaging power/sample-size guides |

2. Create `<category>/<skill-name>/SKILL.md` with required YAML frontmatter:

   ```yaml
   ---
   name: "<skill-name>"
   description: "<one-line summary used for keyword matching>"
   domain: "<domain>"
   version: "1.0.0"
   ---
   ```

   The `description` field is placed in every agent's system prompt and is how
   the model decides when a skill is relevant — make it keyword-rich and
   specific. (`name` + `description` are required; a skill with no description
   is not loaded.)

3. (Optional) Add reference files under `references/` for deeper detail
   (parameter tables, API docs, worked examples, formula guides). The agent
   reads these on demand with its `read` tool — progressive disclosure keeps the
   system prompt compact while drill-down material stays available.

4. Build and restart: `npm run build -w packages/skills` then restart the
   BrainPilot runtime. The new skill is materialized into
   `<data-dir>/bp_template/skills/` on next launch (existing files are not
   overwritten — copy it in manually or remove the stale copy to refresh), and
   agents discover it on their next turn. You can also drop a skill directly
   into `<data-dir>/bp_template/skills/` without rebuilding the package.

**Quality guidelines:** skills encode validated domain methodology — every
numerical parameter needs a citation; keep SKILL.md under 500 lines; put raw
reference material under `references/` rather than inline. See the
`contribute-skills-via-pr` and `verify-skill` Meta-Skills for the full
contributor workflow.

### Configuring your own servers

`brainpilot init` (and `brainpilot up`, which scaffolds on first launch) writes
an empty `mcp_servers.json` into your **data dir** — it is generated at runtime,
not stored in the repo. The data dir is resolved as `--dir` > `$BP_DATA_DIR` >
`./brainpilot` under the directory you run the command from, so the file lands at
`<data-dir>/bp_template/mcp_servers.json`.

> Scaffolding is idempotent: an existing `mcp_servers.json` is never overwritten.

Edit `<data-dir>/bp_template/mcp_servers.json` (global, shared by every session)
or `<data-dir>/.bp/<session-id>/mcp_servers.json` (per session) — where
`<data-dir>` is your generated data dir (e.g. `./brainpilot`), not a path in the
repo. The format is the standard MCP/Claude `mcpServers` map; pick a transport
with `type`:

```jsonc
{
  "mcpServers": {
    // Local process over stdio (type defaults to "stdio" if omitted):
    "fs": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
      "env": {}
    },
    // Remote over streamable-http, with an auth header:
    "my-api": {
      "type": "http",
      "url": "https://your-host.example.com/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    },
    // Remote over server-sent events:
    "my-events": {
      "type": "sse",
      "url": "https://your-host.example.com/sse",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

Field reference:
- `type` — `"stdio"` | `"http"` | `"sse"`. Omitted ⇒ `"stdio"`.
- `command` / `args` / `env` — stdio only: the executable to spawn and its env.
- `url` — http/sse only: the server endpoint.
- `headers` — http/sse only: extra HTTP headers (e.g. `Authorization`) sent on
  every request.

An http/sse entry whose `url` is left blank (or a stdio entry with no `command`)
is treated as an unconfigured placeholder and skipped silently at startup, so you
can keep a slot in the file before wiring up its address. A ready-to-copy example
covering all three transports is written to `bp_template/mcp_servers.example.json`.

## 📦 Publishing (maintainers)

```bash
npm login                 # account with @brainpilot scope access
npm run version:check     # verify all workspace package versions are aligned
npm run release:dry       # pack-preview all 5 public packages (no upload)
npm run release           # version-sync, build, then publish protocol→runtime→backend-core→web→app
```
`@brainpilot/client-cli` stays private and is never published.

### Docker 镜像发布

**两层模型**：重依赖（CUDA + PyTorch + 科学栈，~9GB）住在 *独立发布* 的 base 镜像
`brainpilot-gpu-base`，按依赖版本打 tag（如 `cu124-torch2.6.0`），**低频更新**；随版本
迭代的代码镜像有三个：`brainpilot-main`、`brainpilot-sandbox`（cpu）、
`brainpilot-sandbox-gpu`（`FROM` 上述 base + 业务层）。GPU runtime 镜像因此只重建薄薄的
业务层，发版不再重装 torch。

```bash
# 一次性：复制示范配置，填入国内镜像源 / 私有 registry 地址（两个 .local 文件均不提交）
cp scripts/release-mirrors.example.sh scripts/release-mirrors.local.sh   # pip/apt 镜像源
cp scripts/release-targets.example.sh scripts/release-targets.local.sh   # ACR/内网 registry
```

**① GPU base 镜像**（仅在 torch/cuda 升级时重建；其余发版跳过本步）：
```bash
bash scripts/release-gpu-base.sh build         # 构建（下载 ~2.7GB torch，慢；打 <tag> + latest）
bash scripts/release-gpu-base.sh push          # 推到全部 registry（ghcr + 私有）
bash scripts/release-gpu-base.sh push --registry acr,intranet   # 体积大，可跳过公网 ghcr
```
升级 torch/cuda 时改三处保持一致：`docker/sandbox/Dockerfile.gpu-base` 的版本、
`docker/sandbox/Dockerfile` 的 `gpu` stage `FROM ...:<tag>`、`scripts/release-images.sh`
的 `GPU_BASE_TAG`。

**② 随版本迭代的代码镜像**（镜像版本号 = 根 `package.json` 的 `version`）：
```bash
# 构建（默认全部；可传子串只建子集）。构建 sandbox-gpu 前 base 须已就位
# （本地有或 ghcr 可拉，否则脚本会提示先跑 release-gpu-base.sh build）。
bash scripts/release-build.sh                # 全部三个代码镜像
bash scripts/release-build.sh main           # 只建 main
bash scripts/release-build.sh sandbox-gpu    # 只建 GPU 变体（薄业务层，秒级）

# 推送（需先 docker login 各 registry）
bash scripts/release-push.sh --dry-run                       # 先看计划
bash scripts/release-push.sh                                 # 全部 → 全部 registry
bash scripts/release-push.sh --image sandbox-gpu --registry acr,intranet  # GPU 跳过公网 ghcr
```

推送目标 registry 在 `scripts/release-images.sh`（ghcr，公开）+ `release-targets.local.sh`
（ACR / 内网，私有）声明。base 与 GPU runtime 镜像较大，推公网 ghcr 可能超时，建议
`--registry acr,intranet`。runtime 的 `gpu` stage 只 `FROM` base 的版本 tag（绝不 `latest`，
避免静默漂移）。

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
