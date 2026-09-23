# Workflow collaboration plan

## Current milestone

Make the existing native workflow implementation reproducible for contributors.
Preserve the accepted historical sources, original evidence, and current default behavior.
Add an offline check command, branch CI, and deterministic research lifecycle tests.
Publish the implementation and these documents on `feat/workflow-collaboration`.

The starting commit is `cfb2cd903fa05a67b9615defc6136c5429f058a0`.
The September 23 import includes 137 previously modified or untracked source, test, fixture, and license files.
The original worktree remains separate. Private experiment records stay outside the repository.

## Model roles

| Role | Model | Responsibility |
| --- | --- | --- |
| Lead | GPT-6 Astra | Scope, architecture, review, integration, and independent acceptance |
| Developer | GPT-6 Sol | Implementation and fixes across files |
| Test contributor | GPT-6 Luna | Bounded tests and local fixes |

These are development-agent roles. They do not change the models used by BrainPilot workflows.
The historical product runs used Kimi K3 with low thinking.

## Completion criteria

- A clean checkout installs with `npm ci` on Node.js 22.
- `npm run check:workflows` passes without provider credentials or model calls.
- Research lifecycle tests cover successful delivery and preserved evidence after failure or cancellation.
- The shared branch contains source, tests, fixtures, provenance, licenses, and contributor instructions.
- The remote branch commit matches the accepted local commit.
- The original source worktree and historical run artifacts remain intact.

## Follow-up work packages

| Work package | Boundary | Required evidence |
| --- | --- | --- |
| Scientific workflow | Native TS/Pi implementation for the selected BrainPilotBench task | Matched inputs, model binding, budget, artifacts, and comparison with the existing Skill |
| Live research | Existing library and Tavily adapters | Real source admission, permission denial, cutoff handling, cancellation, and source hashes |
| Quality evaluation | Fresh cases with unchanged original outputs | Independent claim review, disclosed gaps, resource accounting, and failure cases |
| Shared-host settings | User-scoped workflow availability | Isolation and authorization tests across distinct users |

Do not combine historical results with new runs as one acceptance result.
Record the candidate SHA, inputs, environment, model binding, budgets, outputs, and cleanup for each new run.
Preserve failed runs. Compare report quality separately from process completion.
Choose default integration only after fresh evaluation supports it.
