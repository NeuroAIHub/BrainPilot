---
name: audit-model-validation
description: Audit model comparison coverage, validation design, proxy objectives, selection evidence, uncertainty, resource-driven adaptations, and the scope of scientific claims. Use for modelling, prediction, benchmarking, or method-superiority conclusions.
---

# Audit Model Validation

Judge whether the completed comparisons support the stated conclusion; do not
select a model or redesign the study.

## Checks

1. Identify the intended deployment or transfer objective and determine whether
   the validation metric, grouping, cohort, condition, and time horizon are a
   credible proxy for it.
2. Check baselines, chance levels, negative controls, grouped metrics, uncertainty,
   multiplicity, test-set reuse, and anomalously optimistic internal validation.
3. Verify that evaluated candidates cover the materially different inductive
   biases required by the protocol. One reproducible candidate cannot support a
   best-model claim when relevant alternatives were omitted.
4. Compare the executed study with the protocol. Confirm that resource-driven
   reductions preserved essential comparisons and that shortcuts are not
   represented as equivalent to the original design.
5. Bound every conclusion to the data, candidates, metrics, and checks actually
   completed. Treat nuisance or condition signals that can mimic the target as a
   material proxy-objective risk.

For a bounded parallel review, give a `method-reviewer` the protocol, comparison
table, validation outputs, and stated claims. Ask for evidence and candidate
findings, not a verdict.
