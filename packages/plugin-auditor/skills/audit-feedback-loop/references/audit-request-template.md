# Audit request template

Use this structure in the task dispatched to Auditor. Omit empty optional fields; keep evidence paths exact.

```markdown
# Audit Request

Audit ID: <source-task-id>-r<revision>
Revision: <positive integer>
Previous audit: <audit-id or none>
Target type: <expert-result | pi-draft | synthesis>

## User goal
<original user need>

## Producer and source task
- Producer: <principal or agent name>
- Source task ID: <task ID or none>
- Original task: <task and acceptance criteria>

## Target under review
<exact content or workspace path>

## Evidence
- <workspace path, command output, citation record, or other inspectable source>

## Method and pipeline evidence (include applicable items)
- Input or data contract: <path>
- Method survey: <path>
- Scientific protocol and decision rules: <path>
- Implementation or procedure: <paths>
- Operational checks: <paths>
- Decision-relevant evaluation: <paths>
- Artifact equivalence and usability checks: <paths>

## Claims PI intends to use
1. <claim>

## Review scope
<full review for revision 1, or named prior findings and changed claims for a re-review>
```
