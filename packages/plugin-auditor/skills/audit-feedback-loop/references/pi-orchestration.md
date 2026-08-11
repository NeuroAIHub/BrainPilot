# PI audit orchestration

## Start an audit

Audit an Expert result, PI reasoning/draft, or a multi-agent synthesis when it contains numeric results, artifact claims, external citations, datasets, benchmarks, empirical or method-selection conclusions, or conflicting Expert claims. Skip greetings, clarification, progress notices, and other replies without hard claims.

For data-driven or method-selection work, the audit request must identify the applicable input contract, protocol, method survey, implementation or procedure, operational checks, decision-relevant evidence, and artifact checks. If expected evidence does not exist, ask its producing Expert to create it before requesting a final audit.

1. Inspect the returned primary artifact for basic completeness.
2. Read `audit-request-template.md` and build a self-contained request.
3. Dispatch it to `auditor` with `dispatch_task`.
4. Stop the turn and wait for the completion event.

Raw Expert output is a valid intermediate target. Do not require Writer to turn it into a report first.

## Process the verdict

- `pass`: verify that the compact reply names a report, then accept the checked
  scope and preserve stated limitations. Read the full report only when its
  limitations affect delivery.
- `revise`: open the named report, read the sections for the listed finding IDs,
  assign each finding only to its named owner, then follow `revision-loop.md`.
- `block`: open the named report and read the blocking findings; do not deliver
  the affected claim. Route safe correction work, ask the user only for a
  material decision or required authorization, then re-audit.

The completion event is intentionally compact. Do not ask Auditor to paste the
full report into the reply, and do not load unrelated report sections into the
working context.

For a re-review, carry forward confirmed checks whose evidence dependencies did
not change. Send Auditor the previous audit, open finding IDs, changed paths,
resolution evidence, new or changed claims, and any prior checks that may be
affected; do not request a full review of unchanged claims or artifacts.

PI owns all routing. Auditor advises PI and does not direct Experts. Never ask the user to carry an audit result back to PI.

## Final delivery gate

Before delivering substantive hard claims, ensure the latest relevant revision has a `pass`, or explicitly disclose unresolved low-risk limitations. Do not silently override an open high-risk finding.
