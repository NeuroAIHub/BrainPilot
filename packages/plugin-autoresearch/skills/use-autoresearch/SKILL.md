---
name: use-autoresearch
description: Explain, evaluate, and operate BrainPilot Autoresearch for bounded engineering optimization. Use when a user asks what Autoresearch is, how or when to use it, whether a task fits an experiment loop, or wants to optimize measurable properties such as runtime, memory, bundle size, model loss, throughput, or test performance through repeated benchmarked edits. Do not use for qualitative goals, one-off fixes, irreversible external actions, or work without a repeatable metric and correctness checks.
---

# Use Autoresearch

## Explain it

Describe Autoresearch as an Engineer-owned optimization loop:

```text
snapshot → change → benchmark → accept improvement / restore regression → repeat
```

Engineer defines the experiment and verifies the result. Prefer delegating iterations to the persistent `autoresearch-worker` expert so experiment logs do not consume Engineer's main context. PI receives the final evidence-backed report rather than approving routine iterations.

## Decide whether it fits

Use Autoresearch only when all of these are true:

- A command can reproduce the workload.
- One numeric primary metric determines better versus worse.
- Correctness can be protected by tests or another fixed checks command.
- Editable files can be bounded with explicit path patterns.
- Repeated runs fit within the time and compute budget.
- Candidate changes are reversible and have no uncontrolled external side effects.

Good fits include test or build speed, memory, bundle size, throughput, model loss, decoding accuracy, and stable scientific-pipeline benchmarks.

Do not use it for unclear product quality, architectural exploration without a metric, literature review, writing quality, one-off bug diagnosis, production mutation, data collection with irreversible effects, or benchmarks that can be gamed more easily than they measure the real goal. Use ordinary Engineer work first when creating the benchmark is harder than implementing the likely fix.

## Prepare the contract

Before editing, specify:

- `objective`: one optimization target.
- `benchmarkCommand`: fixed command emitting `METRIC <name>=<number>`.
- `metricName` and `direction`: `lower` or `higher`.
- `editablePaths`: exact paths or bounded patterns such as `src/**`.
- `checksCommand`: tests, typecheck, lint, or scientific validity checks.
- Optional budgets: at most 30 iterations, 120 minutes, and 600 seconds per command.

Example benchmark output:

```text
METRIC duration_ms=842.6
```

Never optimize against wall-clock anecdotes or change the benchmark midway through a session.

## Run the loop

1. Install and enable BrainPilot Autoresearch from Marketplace. Enabling executable code requires explicit trust for the exact plugin version.
2. Have Engineer dispatch the bounded task to `autoresearch-worker`, or run it directly for a small loop.
3. Call `autoresearch_init` before modifying files.
4. Immediately call `autoresearch_run`, then `autoresearch_record`, without edits, to establish the baseline.
5. Form one hypothesis, edit only allowed paths, call `autoresearch_run`, then `autoresearch_record`.
6. Let the runtime decide acceptance. Never claim `keep` or manually undo a regression:
   - Improved metric + passing checks + in-scope files → save a new best checkpoint.
   - Regression, crash, failed checks, or out-of-scope change → restore the parent checkpoint.
7. Repeat until the budget is exhausted or no strong hypotheses remain.
8. Call `autoresearch_finish`; it restores the best checkpoint, reruns benchmark and checks, captures the final checkpoint, and releases the workspace lease.

Use `autoresearch_status`, `autoresearch_pause`, `autoresearch_resume`, and `autoresearch_stop` for lifecycle control. A stale workspace or checkpoint error must pause the loop; inspect it instead of forcing an overwrite.

## Report completion

Engineer must independently inspect the diff and rerun the reproduction command once. Report:

- Baseline, recorded best, and final verified metric.
- Absolute and percentage improvement.
- Iterations and accepted/discarded/failed counts.
- Final checkpoint and changed files.
- Benchmark and checks commands.
- Remaining risks, noise, and possible benchmark overfitting.

Do not report success when final verification fails. v1 produces checkpoints and diffs, not Git commits or branches.
