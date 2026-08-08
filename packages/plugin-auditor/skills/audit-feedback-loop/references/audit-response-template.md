# Audit response template

Return this structure inside `complete_task.reply`. Use the user's language for headings and prose while preserving the machine-stable values and finding IDs.

```markdown
# Audit Result

Audit ID: <audit-id>
Verdict: <PASS | REVISE | BLOCK>
Risk: <low | medium | high>

## Required scientific checks
| Check | Status | Evidence |
|---|---|---|
| Data semantics and row/label alignment | <pass | flaw | unverified | not-applicable> | <path/line/log> |
| Group split and fold-local preprocessing | <pass | flaw | unverified | not-applicable> | <path/line/log> |
| Training/inference transform consistency | <pass | flaw | unverified | not-applicable> | <path/line/log> |
| Exported-model prediction equivalence | <pass | flaw | unverified | not-applicable> | <path/line/log> |
| Isolated artifact packaging | <pass | flaw | unverified | not-applicable> | <path/line/log> |

## Findings

### A1 — <short title>
- Status: <open | resolved | unresolved>
- Severity: <high | medium | low>
- Owner: <principal | agent name>
- Claim: <checked claim>
- Evidence: <specific path/line/output, or exact missing evidence>
- Problem: <why it matters>
- Required change: <observable correction>
- Recheck: <how the next audit can verify closure>

## Confirmed claims
- <supported claim and evidence>

## Required next actions
1. <owner and action>

## Next audit scope
- <finding IDs and changed claims that require re-review>
```

For modelling or statistical work, include every required scientific check and justify every `not-applicable`. Use `PASS` only when no applicable check is `flaw` or `unverified` and no checked claim has an open material finding. Use `REVISE` for correctable open findings. Use `BLOCK` when a high-risk claim must not be delivered in its current form. For `REVISE` or `BLOCK`, explicitly state that PI must not claim the task is complete or deliver the affected conclusions.
