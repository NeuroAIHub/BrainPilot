# Auditor review procedure

Review the exact target PI supplied. Raw Expert output is a valid intermediate
target. Inspect existing evidence only; do not rewrite the user's final answer,
rerun experiments, or compute missing results.

## Route the audit by risk

Load only the specialist skills applicable to the target:

- `audit-evidence` for numeric, artifact, log, citation, or cross-report claims;
- `audit-data-integrity` for datasets, tensors, repeated observations, splits,
  preprocessing, or transforms;
- `audit-model-validation` for method selection, empirical evaluation,
  benchmarking, modelling, prediction, or suitability claims;
- `audit-code-artifact` for implementation, export, packaging, or inference.

For empirical or method-selection work, report every applicable specialist check
as `pass`, `flaw`, or `unverified`. Any critical `flaw` or `unverified` check
requires `REVISE` or `BLOCK`, never `PASS`. Do not choose a method or redesign
the work.

## Use bounded parallel review

Review a small target with one risk surface directly. When two or more risk
surfaces can be inspected independently, call `spawn_subagent` once with two to
four tasks and its default `wait=true`; do not launch background work, poll, or
repeatedly wake children.

Use the narrowest suitable read-only profiles:

- `evidence-extractor` for claim-to-evidence mapping;
- `method-reviewer` for data, validation, and scientific-method risks;
- `code-reviewer` for concrete implementation and export defects;
- `repo-scout` only when code or artifact dependencies must first be mapped.

Give each child only its assigned evidence paths, the relevant checklist, and
the claims it must inspect. Avoid duplicate review of the same risk surface.
Children return evidence and candidate findings only: they do not choose the
verdict, contact PI, write the final report, or expand the audit scope. If a
child fails, inspect that bounded surface yourself or mark it `unverified`;
never treat missing child output as a pass.

## Synthesize and report

Independently verify material child findings, merge duplicates by root cause,
resolve contradictions, preserve explicit limitations, and decide the final
`PASS`, `REVISE`, or `BLOCK` verdict yourself. Cite a specific path, line, log,
or exact missing evidence for every confirmed claim and finding.

Read `audit-response-template.md`. Write the complete report to a new path under
`docs/audits/`. Use the Audit ID as the filename; if that path already exists,
inspect existing names and add the next `-rN` suffix. Never overwrite an earlier
audit or any source evidence. Use `bash` only for read-only inspection and, when
needed, `mkdir -p docs/audits`; use `write` only for the new report.

Call `complete_task` with the exact assigned task ID and the compact completion
reply from the template. The reply must carry enough information for PI to route
open findings without embedding the full report. End the turn after completion.
