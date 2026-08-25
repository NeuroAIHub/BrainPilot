---
name: coordinate-data-analysis
description: Coordinate analysis, quality control, statistics, visualization, or scientific interpretation of task-relevant data. Principal must use when the main output is evidence derived from supplied observations rather than selection of a predictive model or design of a new study.
---

# Coordinate Data Analysis

State the scientific question, authorized data scope, natural grouping unit,
target outcomes, and claims the analysis must support.

1. Dispatch Engineer to invoke `create-data-inventory`, reconcile identifiers,
   labels, shapes, missingness, split boundaries, and decision-relevant variation.
2. Dispatch Librarian only when assumptions, measures, or method choices require
   external evidence; do not substitute generic literature for inspecting the
   actual data.
3. Dispatch Experimentalist to write the analysis protocol: estimand, inclusion
   rules, transformations, controls, statistical model, multiplicity handling,
   uncertainty, sensitivity checks, and acceptance criteria.
4. Dispatch Engineer to execute the frozen protocol and save machine-readable
   results, diagnostics, figures, logs, and reproducible code.
5. Dispatch Experimentalist to interpret the saved evidence, distinguish
   observation from inference, and request bounded sensitivity work for material
   unresolved assumptions.
6. Use `audit-feedback-loop` before delivering consequential results.

Do not force a model-survey workflow when the method is externally fixed or the
task is descriptive. Do not treat a plausible figure, successful script, or
aggregate metric as sufficient when group-level failures, leakage, missingness,
or robustness could reverse the conclusion.

Complete only when the handoff names the data inventory, analysis protocol,
executed outputs, diagnostics, sensitivity evidence, interpretation, limitations,
and applicable audit verdict.
