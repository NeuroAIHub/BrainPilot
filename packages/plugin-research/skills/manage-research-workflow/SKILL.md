---
name: manage-research-workflow
description: Control a multi-stage, mixed, long-running, resumed, or failure-prone research workflow after its scientific decisions are framed. Principal must use when work has multiple expert handoffs, parallel branches, background execution, audit revision, changing scope, contradictory evidence, or recovery from partial or failed work.
---

# Manage Research Workflow

Turn the applicable `coordinate-*` Skills into one evidence dependency graph.
For work with more than one substantive handoff, branching, long execution, or
likely resumption, maintain `docs/plans/research-workflow.md` as a compact ledger:

| Node | Owner | Depends on | Canonical artifact | Acceptance check | Status |
|---|---|---|---|---|---|

Use `pending`, `ready`, `active`, `accepted`, `partial`, `blocked`, `stale`, or
`superseded`. Record the user outcome, scope revision, active workflow Skills,
budget and authorization bounds, unresolved decisions, and final delivery gates.
For a short linear task, keep the same graph mentally rather than creating a
ledger whose maintenance costs more than the work.

## Control loop

1. **Orient.** Read the latest user request, decision map, existing canonical
   artifacts, and current task or background-work state. Reuse accepted work
   only when its scope, inputs, method, and revision still match.
2. **Plan.** Add the minimum nodes that can establish the requested claim.
   Preserve evidence order. Mark a node `ready` only when every required parent
   is `accepted`; parallelize only nodes that do not consume one another.
3. **Dispatch.** Give each owner its inputs, canonical output path, observable
   acceptance check, relevant Skill, budget, and what downstream decision the
   result enables. After dispatching independent ready nodes, stop the turn.
4. **Integrate.** On every return, inspect the primary artifact and classify it
   against the node's acceptance check. A completion message, runnable program,
   plausible report, or active-process exit is not acceptance evidence by
   itself. Update the ledger before releasing descendants.
5. **Replan.** Preserve valid evidence, bound the newly exposed gap, and change
   only affected nodes. When a premise, input, protocol, code revision, or result
   changes materially, mark every dependent accepted node `stale` until its
   owner confirms or regenerates it.
6. **Close.** Deliver only when every required leaf is `accepted`, current
   artifacts exist, applicable background work is terminal, the latest audit
   covers the delivered revisions, and unresolved limits are compatible with
   the claim. An inconclusive result may be complete when the protocol's stopping
   rule was met and the handoff says what remains unresolved.

## Recovery policy

Choose the smallest response that can restore the evidence chain:

- Missing user intent or authorization that changes the outcome: use
  `ask_user`; keep unaffected nodes available.
- Discoverable local fact: inspect it or delegate a bounded inventory task
  instead of asking the user.
- Expert returns no usable artifact: clarify the failed acceptance check and
  retry a bounded task; after repeated failure, change approach or report the
  blocker rather than replaying the same brief.
- Tool, provider, or source failure: try an authorized independent source or
  local evidence path; record coverage loss. Access failure is not negative
  scientific evidence.
- Data or feasibility contradicts the plan: return the contradiction to the
  decision or protocol owner and invalidate affected descendants.
- Budget pressure: reduce depth, candidate budgets, seeds, or optional outputs
  according to the declared reduction rule before removing an essential
  comparison or validity check.
- User changes scope: create a new scope revision, retain matching nodes, and
  mark incompatible nodes `superseded`.
- Auditor returns `REVISE`: route each finding to the artifact owner, rebuild
  affected downstream evidence, freeze a new delivery revision, and audit that
  revision. A prior PASS never covers changed evidence.
- A delegated agent or background command is still active: keep the node
  `active` and stop. PI inactivity is not whole-work completion.

Do not add nodes merely to involve every role. Do not serialize independent
work, release a dependent node from a partial parent, or erase failed and
rejected rounds that explain the final decision.
