---
name: audit-evidence
description: Audit numeric, artifact, log, citation, and cross-report claims against inspectable evidence. Use for reports, syntheses, benchmark claims, external citations, or conflicting Expert outputs.
---

# Audit Evidence

Build a claim-to-evidence map from the supplied target. Plausibility is not
evidence, and absence of evidence is `unverified`, not confirmation.

## Checks

1. Verify every decision-relevant number and every quantitative or completion
   claim PI intends to deliver against a specific file, line, log, or structured
   output. For homogeneous supporting numbers or artifacts, inspect a
   representative set covering the main types and boundary cases, expanding it
   only when a discrepancy or shared dependency makes the remainder material.
2. Verify that cited sources exist, support the exact proposition, and are not
   overstated beyond population, method, or result scope.
3. Verify that decision-relevant evidence existed before the decision or
   revision it is claimed to support. A post-hoc citation does not retroactively
   ground an earlier choice. Use artifact versions, task records, checkpoints,
   diffs, and run metadata; if they cannot establish order, identify the exact
   missing chronology evidence and mark the link `unverified`.
4. Reconcile conflicting Expert reports and distinguish direct evidence,
   interpretation, assumption, and unresolved uncertainty.
5. Check that report text matches the latest artifact revision and does not turn
   limitations, missing checks, or qualified findings into unconditional claims.
6. Record exact missing evidence and the likely owner; never fill gaps by
   inference or by recomputing results.

For a bounded parallel review, use `evidence-extractor` with the target report
and its cited evidence packet. Ask for a compact claim map and candidate findings,
not a verdict.
