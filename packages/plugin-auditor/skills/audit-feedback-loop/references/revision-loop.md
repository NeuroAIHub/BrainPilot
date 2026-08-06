# Correction and incremental re-review

## Route corrections

PI assigns every open finding to its named owner. A correction task sent to an Expert must include the finding IDs, evidence, required change, and observable acceptance criteria. Require the Expert to answer each ID with the modified path and new evidence.

PI fixes findings owned by `principal` in its synthesis or draft. Do not ask Auditor to make the correction.

## Request incremental re-review

Create the next audit request with:

- the previous Audit ID and incremented revision;
- each prior finding ID and the producer's resolution claim;
- changed files or replacement text;
- new evidence;
- any newly introduced hard claims.

Auditor classifies prior findings as `resolved` or `unresolved`, preserves their IDs, assigns new IDs only to new problems, and checks whether the correction introduced a new defect.

## Stop conditions

- Stop successfully on `pass`.
- Permit PI to deliver with explicit qualification only when unresolved findings are low risk and do not invalidate the central answer.
- Escalate to the user when the same high-risk finding remains unresolved after two correction attempts, when a material choice is required, or when correction needs user authorization.
- Stop automatic iteration after three audit revisions unless a clearly bounded correction is already in progress.
