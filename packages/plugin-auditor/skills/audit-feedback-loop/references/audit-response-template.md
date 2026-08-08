# Audit response template

Use the user's language for prose while preserving machine-stable verdicts,
statuses, finding IDs, and paths.

## Complete report

Create a new `docs/audits/<audit-id>.md` file. Never overwrite an existing audit;
use the next `-rN` suffix when necessary.

```markdown
# Audit Report

Audit ID: <audit-id>
Verdict: <PASS | REVISE | BLOCK>
Risk: <low | medium | high>
Target: <reviewed path or precise target>

## Scope and review method
- Specialist skills: <loaded skill names>
- Parallel reviewers: <profile and assigned surface, or none>
- Limitations: <unavailable evidence or unreviewed scope>

## Required checks
| Check | Status | Evidence |
|---|---|---|
| <applicable specialist check> | <pass | flaw | unverified | not-applicable> | <path/line/log or exact missing evidence> |

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

Justify every `not-applicable`. Use `PASS` only when no applicable check is
`flaw` or `unverified` and no checked claim has an open material finding. Use
`REVISE` for correctable open findings and `BLOCK` when a high-risk claim must
not be delivered in its current form.

## Compact completion reply

Return only this summary through `complete_task.reply`; do not duplicate the
report's evidence tables or full findings.

```text
Verdict: <PASS | REVISE | BLOCK>
Risk: <low | medium | high>
Report: docs/audits/<actual-report-file>.md
Open findings: <comma-separated IDs, or none>
Owners: <owner names, or none>
Required actions: <one short action per open finding, or none>
<For REVISE or BLOCK: PI must not claim the task is complete or deliver the affected conclusions.>
```
