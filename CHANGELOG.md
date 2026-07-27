# Changelog

This file records notable changes to the public BrainPilot release. For the complete commit
history, follow the comparison links for each version.

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

[0.1.1]: https://github.com/NeuroAIHub/BrainPilot/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/NeuroAIHub/BrainPilot/releases/tag/v0.1.0
