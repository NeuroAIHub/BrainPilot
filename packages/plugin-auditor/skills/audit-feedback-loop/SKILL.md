---
name: audit-feedback-loop
description: Coordinate the final pre-delivery evidence and reliability review between BrainPilot's Principal Investigator and Auditor, including correction and incremental re-review when that final audit finds a problem.
---

# Audit Feedback Loop

Use the durable task system for every handoff. Audit the frozen final delivery
candidate rather than intermediate rounds or draft corrections. Do not ask the
user to relay audit findings.

## Select the role procedure

- If you are `principal`, read [references/pi-orchestration.md](references/pi-orchestration.md) and follow it. Load the request template before dispatching an audit. Load the revision-loop reference after receiving a `revise` or `block` verdict.
- If you are `auditor`, read [references/auditor-review.md](references/auditor-review.md) and follow it. Load only the specialist audit skills relevant to the assigned risks, then load the response template before completing the task.
- If you are any other agent, provide an evidence-addressable result to PI; do not start or adjudicate the audit loop yourself.

## Load only the needed templates

- Audit request: [references/audit-request-template.md](references/audit-request-template.md)
- Audit response: [references/audit-response-template.md](references/audit-response-template.md)
- Correction and incremental re-review: [references/revision-loop.md](references/revision-loop.md)

Keep audit requests in `dispatch_task`, full findings in the versioned report,
and only the compact report pointer in `complete_task`. Do not use a separate
audit-report submission tool.

## Specialist audit skills

- [Data integrity](../audit-data-integrity/SKILL.md)
- [Model validation](../audit-model-validation/SKILL.md)
- [Code and artifact](../audit-code-artifact/SKILL.md)
- [Evidence](../audit-evidence/SKILL.md)
