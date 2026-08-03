# @brainpilot/app

**BrainPilot** is an open-source, single-user multi-agent collaboration platform
built with TypeScript + the [Pi SDK](https://pi.dev) — a Principal agent
coordinating persistent specialists through a durable flat task ledger. Specialists
can launch bounded, context-isolated leaf workers for parallel work. The system is
served as a Hono backend + React SPA and runs as a local process; **no Docker required**.

This package (`@brainpilot/app`) is the CLI. It installs the `brainpilot`
command (`bnpt` is a built-in short alias).

## Prerequisites

- Node.js ≥ 22
- An Anthropic API key (or `BP_MOCK=1` for a no-key test run)

## Install

```bash
npm install -g @brainpilot/app
```

## Quick Start

```bash
# 1. Scaffold config under ./brainpilot
brainpilot init --api-key <your-anthropic-key>

# 2. Launch (foreground; Ctrl-C to stop)
brainpilot up
```

Then open the printed URL (default http://127.0.0.1:9001).

A missing key does **not** block launch — `brainpilot up` starts anyway, and you
can configure the provider URL / key / model in the web **Settings → Providers**
panel after it opens (the recommended path; it writes `providers.json` for you).

### No-key smoke run

```bash
BP_MOCK=1 brainpilot up
```

`BP_MOCK=1` runs a deterministic mock agent that makes no real LLM calls — handy
for verifying the install end-to-end without an API key.

### Configure a gateway / third-party endpoint

```bash
brainpilot init --api-key <key> \
  --base-url https://api.openai.com/v1 \
  --model <model-id> \
  --api openai-responses
```

`--api` accepts `anthropic-messages`, `openai-completions`, `openai-responses`, or
`azure-openai-responses`. If omitted, the provider uses the backward-compatible
`anthropic-messages` default.

You can also omit `--api-key` and supply credentials via the `ANTHROPIC_API_KEY`
environment variable instead.

## Detached mode

```bash
brainpilot up --detach    # run in the background, managed by the CLI
brainpilot status         # health + child pid
brainpilot logs           # tail backend log (add --runtime for the runtime log)
brainpilot down           # stop the detached backend
```

## Common flags

| Flag | Meaning |
|------|---------|
| `--port <n>` | Backend port (default 9001) |
| `--dir <path>` | Data directory (default `./brainpilot`) |
| `--detach` | Run in the background |
| `--no-open` | Don't open the browser on launch |

## Documentation

Full documentation, architecture notes, and advanced configuration live in the
GitHub README:

➡️ **https://github.com/NeuroAIHub/BrainPilot**

## License

AGPL-3.0-only
