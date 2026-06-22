# Security Policy

Thank you for helping keep BrainPilot and its users secure. We take the security of the
platform, its multi-agent runtime, and the systems it connects to seriously.

## Supported Versions

We provide security updates for the latest release and the active `development` branch.
Please make sure you're running a recent version before reporting.

| Version | Supported |
| ------- | --------- |
| Latest release | :white_check_mark: |
| `development` (active) | :white_check_mark: |
| Older versions | :x: |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.** Public
disclosure can put other users and self-hosted instances at risk.

Instead, report it privately:

- **GitHub Private Vulnerability Reporting** — go to the
  [Security tab](https://github.com/NeuroAIHub/BrainPilot/security) of the repository,
  open **Advisories**, and click **Report a vulnerability**.

**Please include:**

- A description of the vulnerability and its potential impact.
- Detailed steps to reproduce.
- Relevant logs, screenshots, or code snippets.
- (Optional) A suggested mitigation or patch.

We aim to acknowledge your report within **48 hours** and will keep you updated on our
progress.

## Disclosure Process

Once a vulnerability is confirmed and patched, we will publish a GitHub Security Advisory
describing the issue, the affected versions, and the fix. We'll credit the reporter unless
they prefer to remain anonymous.

## Trust Boundary (please read before self-hosting)

BrainPilot agents execute tools and read/write files on the machine that runs them. The
isolation guarantees depend on how you deploy:

- **Local (npm / `brainpilot up`) mode has _no_ container isolation.** Agents read and
  write directly on your machine under `brainpilot/workspaces/<sessionId>/`. Run it only
  with workloads and API keys you trust, and avoid pointing it at directories with
  sensitive data you don't want an agent to touch.
- **Docker mode** runs agents inside a sandbox container — prefer it when you need
  isolation, are exposing BrainPilot to others, or are running untrusted inputs.
- **Connecting MCP servers and custom models means trusting them.** A configured MCP server
  can be invoked by agents as a tool, and a custom gateway sees your prompts and data. Only
  connect endpoints you control or trust, and keep API keys and auth headers out of version
  control.

These are deployment characteristics, not vulnerabilities — but if you find a way to
**escape** an intended boundary (e.g. break out of the Docker sandbox, or read outside the
session workspace in a way the design forbids), please report it privately as above.
