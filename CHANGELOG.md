# Changelog

This file records notable changes to the public BrainPilot release. For the complete commit
history, follow the comparison links for each version.

## [0.2.2] - 2026-08-22

This patch makes the hosted plugin experience accurately reflect Cloud availability. Hosted
deployments previously opened the local plugin marketplace even when its Cloud control plane was
not enabled, which exposed raw 404 responses and could make the marketplace look broken.

### Cloud plugin experience

- Shows a compact, localized “not yet available in Cloud” state when hosted users open Plugins.
- Does not mount the local marketplace in hosted mode, avoiding unsupported marketplace,
  installation, update, and MCP-status requests from that page.
- Keeps the existing plugin marketplace unchanged for local and self-hosted installations.

### Upgrade

```bash
npm install -g @brainpilot/app@0.2.2
brainpilot --version
```

Docker and hosted deployments should use the matching `0.2.2` CPU or GPU sandbox image. No manual
user-data migration is required.

## [0.2.1] - 2026-08-22

This patch release makes **Stop** a hard boundary for model, tool, and Trace work. In v0.2.0, an
interrupted turn could remain in the underlying model context: the next user message was answered,
but unfinished tools and Trace processing from the cancelled request could then resume and write
files or append an obsolete result.

### Stop and recovery

- Captures the last completed model-context checkpoint before every top-level user turn.
- After Stop fully settles, branches both the persisted Pi session and the live in-memory message
  state back to that checkpoint, while preserving BrainPilot's visible audit history.
- Keeps steering and follow-up queue clearing on both sides of abort settlement, so queued internal
  reminders and partially persisted tool calls cannot survive into the recovery prompt.
- Adds regression coverage for interrupted tool-producing turns and verifies the exact production
  scenario with a real provider on a 208 CPU sandbox.

### Upgrade

```bash
npm install -g @brainpilot/app@0.2.1
brainpilot --version
```

Docker and hosted deployments should use the matching `0.2.1` CPU or GPU sandbox image. No manual
user-data migration is required.

## [0.2.0] - 2026-08-22

BrainPilot v0.2.0 turns the research workspace into a more capable, inspectable, and reliable
environment for real multi-agent work. The release adds a public plugin platform, durable expert
tasks, richer research traces and workspace recovery, managed background execution, public
neuroscience datasets, and a substantially simpler model and file workflow.

### Highlights

- Added a public plugin SDK and an in-product marketplace. BrainPilot can discover and run native
  plugins as well as compatible Pi, Codex, and Claude Code packages, with provenance, permissions,
  requirements, and compatibility visible before activation.
- Upgraded the research trace into a structured record of episodes, evidence, artifacts,
  checkpoints, and decisions. Users can inspect how a result was produced, preview workspace
  changes, and restore an earlier checkpoint with the restored state visible across Chat, Trace,
  and Files.
- Added durable expert tasks and subagents. Long or parallel work can continue in the background,
  completed results return to the correct agent, superseded work is cancelled deterministically,
  and silent background jobs notify the agent when they finish.
- Added a neuroscience dataset marketplace and reusable public-download workflows, together with
  a guided Knowledge Base PDF workflow for indexing and retrieval.

### User experience

- Combined provider, model, and reasoning selection in the composer so users can switch among
  configured services and supported reasoning levels without returning to Settings.
- Replaced the large unconfigured-provider panel with compact first-run guidance and added
  actionable recovery for authentication, rate-limit, timeout, and provider-availability errors.
- Preserved unsent drafts and attachments across reloads, exposed persistent-library files to `@`
  mentions, supported pasted clipboard images, and made linked workspace files directly
  previewable and editable.
- Made user questions require explicit confirmation, kept queued follow-ups attached to the
  correct run, and improved Stop and resume behavior so cancelled instructions and internal
  control messages do not leak into the conversation.
- Fixed new-conversation and deep-link navigation, restored keyboard focus after Settings closes,
  kept per-turn duration accurate, and removed duplicate replies for literal-output prompts.
- Improved mobile Settings and Live Demo layouts, reduced internal terminology in Agent and Trace
  views, and made checkpoint and restore results readable in user-facing language.
- Improved Live Demo import and export so real artifacts remain canonical while internal
  checkpoint files stay out of the user-facing bundle.

### Plugins and integrations

- Added official Auditor, research-workflow, Graph of Trace, and Monitor plugins.
- Added Playwright MCP integration and verified Superpowers package compatibility.
- Added runtime validation and clearer activation errors for MCP servers and external plugin
  projections.
- Added managed model-context and session-wide reasoning controls for newly created agents.

### Reliability and safety

- Added bounded foreground shell execution and managed finite background jobs with timeout,
  cancellation, progress, and terminal notifications.
- Made task delivery, cancellation, retries, and session work state durable across busy agents,
  interruptions, restarts, and overlapping work.
- Bounded checkpoint provenance and excluded generated environments so dependency trees do not
  overwhelm prompts or trace artifacts.
- Improved streaming, retry, error, and tool-schema compatibility across Anthropic,
  OpenAI-compatible, OpenAI Responses, and Azure OpenAI Responses APIs.
- Updated Pi, Docker, and documentation dependencies; the release ships with a clean npm security
  audit.

### Packaging and deployment

- Publishes 12 public `@brainpilot/*` packages, including the first public releases of
  `plugin-sdk`, `plugin-auditor`, `plugin-got`, `plugin-research`, and `plugin-monitor`.
- Publishes matching CPU and GPU sandbox images through GHCR and mainland China ACR. The main
  process continues to ship through `@brainpilot/app` and BrainPilot Cloud.
- Keeps the heavy CUDA and PyTorch GPU base separate from the thin versioned BrainPilot runtime
  layer, avoiding repeated framework downloads for ordinary application updates.

### Upgrade

```bash
npm install -g @brainpilot/app@0.2.0
brainpilot --version
```

Docker and hosted deployments should use the matching `0.2.0` CPU or GPU sandbox image. Existing
user data, sessions, workspace files, and provider/MCP configuration remain in their durable
roots.

### Breaking changes and migration

- No manual user-data migration is required.
- Plugin authors must declare a BrainPilot engine range that includes 0.2.0 and should validate
  packages against the public plugin SDK before distribution.

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

[0.2.2]: https://github.com/NeuroAIHub/BrainPilot/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/NeuroAIHub/BrainPilot/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/NeuroAIHub/BrainPilot/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/NeuroAIHub/BrainPilot/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/NeuroAIHub/BrainPilot/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/NeuroAIHub/BrainPilot/releases/tag/v0.1.0
