# Contributing to BrainPilot

Thanks for your interest in contributing to BrainPilot! This guide covers how to set up a
dev environment, the branch model, what to run before opening a PR, and how releases work.

## How to Contribute

| Contribution type | What to do |
| --- | --- |
| **Bug fix** | Open a PR directly (link the issue if one exists) |
| **New skill** | Open a PR directly — see [Contributing a skill](#contributing-a-skill) |
| **Extending existing features** (e.g. a new model provider, a new tool) | Open a PR directly |
| **New feature or architecture change** | Open an issue or discussion **before** opening a PR |
| **Refactor-only PR** | Not accepted unless a maintainer explicitly requests it |
| **Documentation** | Open a PR directly |
| **Question** | Open an issue, or reach out in the [community group](README.md#-community) |

## Prerequisites

- **[Node.js](https://nodejs.org/) ≥ 22**
- **npm** (bundled with Node)
- An **Anthropic API key** for real runs — or use `BP_MOCK=1` to develop without one

## Getting Started (run from source)

```bash
# Clone the repository
git clone https://github.com/NeuroAIHub/BrainPilot.git
cd BrainPilot

# Install dependencies and build all packages
npm install
npm run build

# Launch from source (equivalent to `brainpilot up --port 9005`)
npm run bp -- up --port 9005
```

> **Pass flags after `--`.** With `npm run`, the `--` separator is required so npm forwards
> `up --port 9005` to the CLI instead of consuming `--port` itself. `npm run bp up --port
> 9005` (no `--`) silently drops the flag and falls back to the default port. To skip npm
> entirely, call the built binary directly:
>
> ```bash
> node packages/cli/dist/bin.js up --port 9005
> ```
>
> (the runtime uses `port + 1`).

For a no-key smoke run: `BP_MOCK=1 npm run bp -- up`.

## Development Workflow

BrainPilot follows a simple GitHub Flow: **`main` is the single source of truth.**
You branch off `main`, open a PR, and merge back into `main` once CI is green and a
maintainer approves.

1. **Fork** the repository and create a branch from `main`:
   ```bash
   git checkout -b feat/your-feature main
   ```
2. **Branch naming:**
   - `feat/` — new features or enhancements
   - `fix/` — bug fixes
   - `docs/` — documentation changes
   - `ci/` / `chore/` — tooling and maintenance
3. Make your changes and **test locally**.
4. Run **all checks** before committing (see below).
5. Open a **Pull Request** against `main`.

### How your PR is verified

Two layers, with different jobs:

- **Public CI (the merge gate)** — every PR runs the GitHub Actions workflow
  (typecheck + unit tests + web build + the fast black-box suites). This is the
  authoritative gate: it is fully public and reproducible, so you can see exactly
  what is checked and reproduce any failure locally. **A PR merges once this is
  green** (and a maintainer approves).
- **Maintainer regression (pre-release)** — maintainers additionally run a fuller
  regression (real provider / real sessions) on internal infrastructure before
  cutting a release. This is a release-time smoke check, **not** a per-PR gate, so
  it never blocks external contributors. Test cases from it are continuously
  de-identified and folded back into the public CI above, so the public gate keeps
  getting stronger over time.

## Before You Submit a PR

Run these locally — CI runs them too, but catching issues early saves everyone time:

```bash
npm run typecheck                    # tsc -b across non-web packages
BP_MOCK=1 npx vitest run             # all non-web tests, deterministic mock (no API quota)
( cd packages/web && npm test && npm run build )   # web: vitest + vite build
```

`BP_MOCK=1` selects a deterministic mock agent so tests never consume API quota.

Optional end-to-end smoke tests:

```bash
bash scripts/smoke-e2e.sh            # backend → runtime(mock) → SSE → client smoke
bash scripts/smoke-docker.sh         # manual real-Docker smoke (needs a local daemon)
```

### Local verification

Before marking a PR **Ready for Review**, please:

1. **Verify your goal** — confirm the PR does what it set out to do (bug fixed, feature works).
2. **Regression-check** — make sure existing behavior still works (key flows, related features).
3. **Run the checks above.**

If you haven't completed local verification, keep the PR in **Draft**.

### PR Guidelines

- **Link an issue** — use `Closes #123` / `Fixes #456` in the description. If no issue
  exists, create one first.
- **Keep PRs focused** — one concern per PR; don't mix unrelated changes.
- **Describe what and why** — fill out the [PR template](.github/pull_request_template.md).
- **Include screenshots / recordings** for UI changes (before/after).
- **Ensure CI passes** before requesting review.

## Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`, `style`

Examples:

```
feat(runtime): add result_deliver mailbox message type
fix(web): stop trace panel from resetting on session switch
docs: add bilingual README and CONTRIBUTING
```

## AI-Assisted PRs 🤖

PRs built with AI tools (Claude, Codex, Cursor, etc.) are welcome — we just ask for
transparency and self-review:

- **Mark it** — note in the PR title or description that the PR is AI-assisted.
- **AI-review your own code first** — before requesting maintainer review, run an AI code
  review on your changes and address the findings. This is **required** for AI-assisted PRs
  so maintainers aren't handed large amounts of unreviewed generated code.
- **You own what you submit** — understand the code, not just the prompt.

AI-assisted PRs are held to the same quality standard as any other PR.

## Project Structure

BrainPilot is a TypeScript monorepo of six packages under `packages/`:

```
BrainPilot/
├── packages/
│   ├── protocol/        # zod wire SSOT: AG-UI events, domain types, HTTP route contract
│   ├── runtime/         # Pi SDK orchestration, SessionManager, mailbox, system tools,
│   │                    #   MCP bridge, Hono + SSE server
│   ├── backend-core/    # Hono REST + SSE passthrough, Orchestrator (Local/Static/Docker)
│   ├── web/             # React/Vite SPA (AG-UI consumer)
│   ├── cli/             # @brainpilot/app — `brainpilot` / `bnpt` Docker-free launch
│   ├── client-cli/      # @brainpilot/client-cli — headless verification client (private)
│   └── skills/          # @brainpilot/skills — built-in skills content library
├── docker/              # Dockerfiles & sandbox build hooks
├── scripts/            # smoke tests, release tooling
└── .github/            # issue/PR templates, CI workflows
```

## Contributing a skill

Skills encode validated domain methodology and live in `packages/skills/skills/` as a
two-level `<category>/<skill-name>/SKILL.md` tree. They are loaded via Pi's native skill
pipeline and materialized into the data dir at launch. See the
[Built-in skills library](README.md#-resources--knowledge-base) section of the README for
the folder layout, required YAML frontmatter, and quality guidelines. In short:

1. Add `<category>/<skill-name>/SKILL.md` with `name` / `description` / `domain` / `version`
   frontmatter (the `description` goes into the agent's system prompt and decides relevance).
2. Put drill-down material under `references/` rather than inline; keep `SKILL.md` under 500
   lines; cite every numerical parameter.
3. `npm run build -w packages/skills`, then restart the runtime to pick it up.

The `contribute-skills-via-pr` and `verify-skill` Meta-Skills document the full workflow.

## Releasing (maintainers)

### npm packages

```bash
npm login                 # account with @brainpilot scope access
npm run version:check     # verify all workspace package versions are aligned
npm run release:dry       # pack-preview all public packages (no upload)
npm run release           # version-sync, build, then publish protocol → runtime → backend-core → web → app
```

`@brainpilot/client-cli` stays private and is never published.

### Docker images

Image versions match the npm version (root `package.json`). Three images:
`brainpilot-main`, `brainpilot-sandbox` (CPU), `brainpilot-sandbox-gpu` (CUDA torch).

```bash
# one-time: copy the example configs and fill in your mirrors / private registries
cp scripts/release-mirrors.example.sh scripts/release-mirrors.local.sh   # pip/apt mirrors
cp scripts/release-targets.example.sh scripts/release-targets.local.sh   # ACR / intranet registry

# build (default = all; pass a substring to build a subset)
bash scripts/release-build.sh                # all three images
bash scripts/release-build.sh main           # main only
bash scripts/release-build.sh sandbox-gpu    # GPU variant only (large, slow)

# push (docker login each registry first)
bash scripts/release-push.sh --dry-run                              # preview the plan
bash scripts/release-push.sh                                        # all images → all registries
bash scripts/release-push.sh --image sandbox-gpu --registry acr,intranet
```

The GPU image is ~6 GB; pushing to public registries may time out, so
`--registry acr,intranet` is often preferable for it.

## Reporting Bugs

Use the [Bug Report](https://github.com/NeuroAIHub/BrainPilot/issues/new?template=bug_report.yml)
template. Include reproduction steps, expected vs. actual behavior, your deployment method
(npm / Docker / from source), Node version, and any logs (`brainpilot logs`).

## Requesting Features

Use the [Feature Request](https://github.com/NeuroAIHub/BrainPilot/issues/new?template=feature_request.yml)
template. For larger features, please open an issue or discussion first.

## Security Vulnerabilities

**Do not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md)
for private reporting via GitHub Security Advisories.

## License

By contributing to BrainPilot, you agree that your contributions will be licensed under the
[GNU AGPL v3](LICENSE).
