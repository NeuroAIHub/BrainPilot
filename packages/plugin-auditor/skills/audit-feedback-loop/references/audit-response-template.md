# Audit response template

Return this structure inside `complete_task.reply`. Use the user's language for headings and prose while preserving the machine-stable values and finding IDs.

```markdown
# Audit Result

Audit ID: <audit-id>
Verdict: <pass | revise | block>
Risk: <low | medium | high>

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

Use `pass` only when no checked claim has an open material finding. Use `revise` for correctable open findings. Use `block` when a high-risk claim must not be delivered in its current form.
