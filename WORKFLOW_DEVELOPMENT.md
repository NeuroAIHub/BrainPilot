# Workflow development

Use `feat/workflow-collaboration` as the shared development branch for native BrainPilot workflows.
This branch preserves the implementation developed from commit `cfb2cd903fa05a67b9615defc6136c5429f058a0`.
It includes the workflow SDK, host integration, writing workflow, experimental research workflow, tests, and acceptance drivers.

## Start development

Use Node.js 22 or newer. Linux is the reference environment for the acceptance drivers.

```sh
git clone --branch feat/workflow-collaboration https://github.com/NeuroAIHub/BrainPilot.git
cd BrainPilot
npm ci
npm run check:workflows
git switch -c feat/workflow-your-change
```

The check command runs deterministic tests and build checks. It does not call a model or require provider credentials.
Dependency installation needs network access. Some transport tests use a local HTTP server.

Open contribution PRs against `feat/workflow-collaboration`.
Describe the changed behavior, test commands, and remaining validation in each PR.
Keep runtime, plugin, UI, and evaluation changes in separate commits where practical.
The branch CI checks pushes and contribution PRs.

## Current implementation

| Component | Entry point | Status |
| --- | --- | --- |
| SDK contracts | `packages/plugin-sdk/src/workflow.ts` | Definition, run, context, artifact, and schema contracts |
| Host and lifecycle | `packages/runtime/src/workflows/host.ts`, `run-manager.ts`, `stage-lifecycle.ts` | Dispatch, model binding, cancellation, persistence, and artifacts |
| Session integration | `packages/runtime/src/session-manager.ts` | Workflow tools, provider capacity, usage, and result delivery |
| Plugin integration | `packages/backend-core/src/plugins.ts` | Trusted bundled workflows and availability settings |
| Writing | `packages/runtime/src/workflows/paper-writing.ts` | Native PaperOrchestra-inspired writing pipeline |
| Research | `packages/runtime/src/workflows/deep-research.ts` | Experimental evidence-led research pipeline |
| Source access | `packages/runtime/src/workflows/research-tools.ts` | Existing paper-library and Tavily adapters |

Agent and Workflow are peer dispatch targets. Skills remain capabilities that an agent can use.
The host freezes the effective provider, model, and thinking configuration when it accepts a run.
Workflow stages use that binding. They do not choose another model.
Each run preserves artifact paths, hashes, source records, and terminal status.

The writing plugin is disabled by default. Plugin settings currently support an explicitly declared single-user host.
Deep Research is registered by its experimental pilot driver. It is absent from the default session implementation list.
The existing librarian remains the default literature route.
See the [SDK guide](packages/plugin-sdk/README.md#experimental-native-workflows) and [writing plugin guide](packages/backend-core/plugins/paper-writing/0.1.0/README.md).

## Evidence and limits

The previous development task completed two real engineering runs on an isolated Linux test host.
The [acceptance history](docs/workflow/acceptance-history.json) records their scope and source hashes.
These historical results apply to the recorded candidates. They are not fresh model tests of every later commit.

| Historical run | Result |
| --- | --- |
| Writing, September 15 | Completed in 95m43s: 54 stages, 71 provider requests, and editable TeX/PDF delivery |
| Research, September 16 | Fixed seven-paper run completed in 25m13s: 22 requests, 29 registered artifacts, and one retained evidence gap |
| Matched librarian comparison | Delivered its report, then exceeded the token soft limit during task closeout |

The writing result still had citation and scientific-quality problems.
Both research reports had statistical or condition-wording problems.
The comparison does not establish general quality superiority, lower monetary cost, or readiness to replace librarian.
The fixed-corpus research driver disables external retrieval. Open-ended literature search remains unvalidated.
Scientific-workflow comparisons, provider compatibility, shared-host settings, and production acceptance remain pending.

## Real acceptance runs

Use an isolated Linux checkout, a new output directory, and explicit provider configuration.
Real acceptance calls models and can incur provider charges.
Keep credentials, provider responses, private papers, user data, and raw session logs outside Git.
Keep the source candidate fixed throughout each run.

The [writing fixture guide](scripts/fixtures/workflow-real/README.md) describes the synthetic materials and driver.
The research driver accepts a caller-supplied, seven-source packet and a matching request JSON.
Its CLI contract is documented in `scripts/deepresearch-pilot.mjs`.
Real runs need a separate evidence review after the deterministic checks pass.
Check output provenance, delivery, cleanup, input hashes, budget accounting, and scientific content separately.

## Next work

1. Add a BrainPilotBench scientific workflow and compare it with the existing Skill under matched resource budgets.
2. Validate live research retrieval with source admission, cutoff dates, permissions, cancellation, and preserved evidence.
3. Expand quality evaluation across fresh cases before changing the default literature route.
4. Resolve shared-host plugin ownership before multi-user runtime deployment.

Use the [development plan](docs/workflow/DEVELOPMENT_PLAN.md) for work boundaries and acceptance criteria.
This is a development branch. Release versions, published artifacts, and production services require separate release preparation and approval.
