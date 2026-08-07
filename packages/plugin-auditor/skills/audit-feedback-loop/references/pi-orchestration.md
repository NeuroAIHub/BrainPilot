# PI audit orchestration

## Start an audit

Audit an Expert result, PI reasoning/draft, or a multi-agent synthesis when it contains numeric results, artifact claims, external citations, datasets, benchmarks, modelling or statistical conclusions, or conflicting Expert claims. Skip greetings, clarification, progress notices, and other replies without hard claims.

For modelling or statistical work, the audit request must identify the data contract, scientific protocol, implementation, validation outputs, export-equivalence evidence, and isolated packaging test. If an expected artifact does not exist, ask its producing Expert to create it before requesting a final audit.

1. Inspect the returned primary artifact for basic completeness.
2. Read `audit-request-template.md` and build a self-contained request.
3. Dispatch it to `auditor` with `dispatch_task`.
4. Stop the turn and wait for the completion event.

Raw Expert output is a valid intermediate target. Do not require Writer to turn it into a report first.

## Process the verdict

- `pass`: accept the checked scope; preserve stated limitations.
- `revise`: assign each open finding to PI or the producing Expert, then follow `revision-loop.md`.
- `block`: do not deliver the affected claim. Route safe correction work, ask the user only for a material decision or required authorization, then re-audit.

PI owns all routing. Auditor advises PI and does not direct Experts. Never ask the user to carry an audit result back to PI.

## Final delivery gate

Before delivering substantive hard claims, ensure the latest relevant revision has a `pass`, or explicitly disclose unresolved low-risk limitations. Do not silently override an open high-risk finding.
