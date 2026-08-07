---
name: autoresearch-create
description: Start a bounded autonomous optimization loop. Use when an engineering task has a repeatable benchmark and measurable objective.
---

# Start Autoresearch

The engineer owns the loop. For context isolation, create or reuse the persistent expert named `autoresearch-worker`, assign it the bounded optimization task, and require a final structured report. The engineer may also run the tools directly when delegation is unnecessary.

Before starting, define: objective, fixed benchmark command, primary `METRIC name=value`, direction, optional correctness command, and editable path patterns. Then:

1. Call `autoresearch_init` before changing files.
2. Call `autoresearch_run` immediately to establish the unmodified baseline, followed by `autoresearch_record`.
3. For each hypothesis, edit only allowed paths, call `autoresearch_run`, then `autoresearch_record`.
4. Never self-report keep/discard: the runtime decides from metrics, checks, scope, and checkpoints.
5. Continue until the budget is reached, no useful hypotheses remain, or interrupted; then call `autoresearch_finish`.

Do not change the benchmark or metric during a session. Do not ask PI for routine iteration approval. Report the verified best result to the assigning engineer or PI when complete.
