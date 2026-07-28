# Changelog

This file records notable changes to the public BrainPilot release. For the complete commit
history, follow the comparison links for each version.

## [0.1.2] - 2026-07-28

This release improves tool-state accuracy, managed MCP configuration, knowledge-base packaging,
scientific Markdown rendering, onboarding, and Docker distribution.

### Runtime and user experience

- Made tool execution lifecycle authoritative across the runtime and web client so running,
  completed, interrupted, and rehydrated tool states remain consistent. Individual shell-script
  runs can now be interrupted without stopping unrelated work.
- Added bring-your-own-key configuration for managed MCP presets while keeping preset definitions
  read-only and redacting managed credentials from API responses.
- Added mathematical Markdown rendering and normalization that recovers common collapsed-table
  output before display.

### Knowledge base

- Added the publishable `@brainpilot/kb-scripts` package and first-run materialization so npm
  installations include the knowledge-base build scripts previously available only from source.
- Unified knowledge-base root discovery between the backend builder and runtime retrieval tools.
- Updated the model-download progress adapter for current `tqdm` and `huggingface_hub` behavior,
  preventing repeated compatibility errors and stalled progress reporting.

### Docker distribution

- Published versioned `linux/amd64` CPU and GPU sandbox images to GHCR and to a public Alibaba
  Cloud ACR endpoint in mainland China, with anonymous pulls supported on both distribution paths.
- Added configurable sandbox image names to the static CPU and GPU Compose files so deployments
  can select a registry without retagging images locally.
- Documented fixed-version tags, `latest` update behavior, NVIDIA Container Toolkit requirements,
  cloud image configuration, and the security boundary of Docker-based multi-user deployments.

### Documentation

- Added a dedicated bilingual Docker guide covering source builds, prebuilt sandbox images,
  CPU/GPU selection, static and dynamic deployment, cloud configuration, upgrades, and common
  failure modes.
- Expanded the bilingual getting-started guide with guided provider setup, first-task, and trace
  inspection walkthroughs, including lightweight video and GIF demonstrations.
- Updated the GitHub READMEs to point users to the appropriate global or mainland China image
  endpoint and removed the outdated statement that the GPU sandbox image was private.

### Maintenance

- Updated Next.js, PostCSS, and `js-yaml` within their supported release lines.

### Upgrade

```bash
npm install -g @brainpilot/app@0.1.2
```

Mainland China users can pre-pull the matching sandbox images from ACR:

```bash
docker pull brainpilot-registry.cn-wulanchabu.cr.aliyuncs.com/brainpilot/sandbox:0.1.2
docker pull brainpilot-registry.cn-wulanchabu.cr.aliyuncs.com/brainpilot/sandbox-gpu:0.1.2
```

## [0.1.1] - 2026-07-24

This patch release focuses on interaction reliability and recovery from temporary model-provider
failures.

### Reliability

- Made `ask_user` requests durable and queue-aware. Each session now exposes one question at a
  time, preserves pending requests across restoration, expires unanswered questions after five
  minutes, and records answered, cancelled, and expired states explicitly.
- Serialized user-input transitions through a bounded FIFO queue and added explicit conflict and
  persistence-failure responses for stale or unavailable requests.
- Added same-turn retries for narrowly classified transient provider failures while keeping
  deterministic authentication and request errors non-retryable.
- Persisted health results for the model that was actually probed and reported untested configured
  models as `unknown` instead of inferring their status.
- Treated interrupted retry backoff as a cancellation so user-initiated stops do not appear as
  provider failures.

### User experience

- Aligned the web interface with pending, submitting, answered, cancelled, and expired user-input
  states.
- Improved public documentation, community links, and references to the BrainPilot technical
  report and Graph of Trace paper.

### Maintenance

- Updated Hono, `@hono/node-server`, `js-yaml`, and `fast-uri` within their supported release
  lines.

### Upgrade

```bash
npm install -g @brainpilot/app@0.1.1
```

## [0.1.0] - 2026-07-17

First public open-source release of BrainPilot, including the PI-led multi-agent research
workflow, Graph of Trace, the built-in scientific skills library, provider configuration, MCP
integration, local CLI, web interface, and Docker sandbox support.

[0.1.2]: https://github.com/NeuroAIHub/BrainPilot/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/NeuroAIHub/BrainPilot/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/NeuroAIHub/BrainPilot/releases/tag/v0.1.0
