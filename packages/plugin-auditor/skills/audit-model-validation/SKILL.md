---
name: audit-model-validation
description: Audit whether method discovery, comparison, representative real-data validation, collapse diagnostics, pruning, and selection evidence support claims of suitability or superiority. Use for research-method selection, empirical evaluation, benchmarking, modelling, prediction, or other conclusions that depend on choosing among alternatives.
---

# Audit Method Validation

Judge whether the alternatives considered and evidence gathered support the
stated conclusion; do not choose a method or redesign the work.

## Separate operational and empirical evidence

Classify every supplied check before judging the claim:

- **Operational evidence** covers importability, tensor shapes, finite outputs,
  parameter counts, deterministic evaluation, packaging, gradient flow, and
  memorization of synthetic or random data. It can establish that an artifact
  runs, but normally cannot establish task suitability or generalization.
- **Empirical evidence** measures decision-relevant behavior on representative
  real data with labels, splits, metrics, and conditions matched closely enough
  to the intended use. It supports performance and selection claims only within
  those observed conditions.

Do not let the volume, precision, or independence of operational checks
substitute for missing empirical evidence. If the intended claim is that a
method is suitable, effective, robust, or preferred and representative real-data
evidence is absent, mark empirical adequacy `unverified`. This is a material
finding requiring `REVISE` or `BLOCK`, even when every implementation and
protocol-compliance check passes. A report may separately confirm the narrower
claim that the artifact is operationally valid.

## Checks

1. Identify the intended use and claim. Determine whether the evidence source,
   comparison unit, conditions, measures, and time horizon represent that use.
2. Inventory the evidence by source: representative real data,
   non-representative real data, simulated data, random tensors, literature, or
   implementation inspection. Verify that the strongest conclusion does not
   exceed the strongest applicable evidence class.
3. Verify that discovery covered a sufficiently broad set of credible,
   substantively different alternatives for the claim. Check established
   baselines and require justification for material omissions; a long list of
   minor variants is not breadth. The previous working baseline is an essential
   comparison when a proposed replacement claims improvement or suitability.
4. Distinguish operational correctness and feasibility from evidential
   adequacy. Synthetic, self-consistency, or convenience evidence establishes
   real-world suitability only when the task makes it representative.
5. Check that comparisons are fair and that screening, pruning, adaptation, and
   resource-driven reductions follow declared rules without discarding essential
   breadth merely for implementation convenience. Treat a missing reader,
   dependency, accelerator, or preprocessing artifact as a blocked evidence path,
   not as justification for replacing real-data validation with synthetic checks.
6. Check applicable baselines, chance levels, negative controls, grouped metrics,
   uncertainty, multiplicity, evidence reuse, and anomalously optimistic results.
   Treat nuisance, proxy, or setting-specific signals that can mimic the intended
   target as material risks.
7. Check for degenerate predictions and hidden training failure before accepting
   aggregate scores. Require class coverage and per-group diagnostics when class
   collapse is plausible.
8. Verify that implementation parameters preserve their scientific meaning.
   Recompute durations, frequencies, window sizes, and other physical quantities
   after resampling or unit conversion; copying sample counts across sampling
   rates is not protocol fidelity.
9. For each material iteration, verify that its representative real-data
   validation ran on the same or later code and configuration revision than the
   implementation diff under review. Preserve the valid iterative sequence in
   which one result motivates the next decision; final validation of an older
   revision cannot validate a newer candidate.
10. Bound every conclusion to the alternatives, evidence, conditions, and checks
   actually completed.

## Audit techniques

Use the smallest read-only checks that can expose an invalid conclusion:

1. Build a claim-to-evidence table with separate rows for operational validity,
   within-condition performance, transfer performance, and method superiority.
   Never merge these into one generic `validated` status.
2. For a balanced `K`-class problem, compare results with constant prediction:
   accuracy `1/K`, kappa `0`, and macro-F1 `2 / (K * (K + 1))` under the usual
   zero-division convention. Exact or near-exact agreement is a collapse warning,
   not proof. Confirm with per-class prediction counts, class coverage, normalized
   prediction entropy, confusion matrices, or per-group macro-F1. If those
   artifacts are unavailable, report collapse as suspected and the diagnosis as
   unverified rather than asserting certainty.
3. Inspect train/validation loss, selected epoch, logits or probability ranges,
   and prediction histograms per subject/fold/group. Aggregate means can hide
   constant predictors, failed subjects, or cancellation across groups.
4. Match the validation split to the deployment shift. Random validation within
   one session does not validate cross-session transfer. Look for session/run/time
   blocks, held-out conditions, external data, or explicit shift stress tests;
   otherwise narrow the claim to same-condition performance.
5. Recalculate architecture time scales from the actual sample rate. Check
   normalization statistics, nonlinearities that amplify shift, and numerical
   guards such as epsilon/clamping when their failure could create uniform class
   bias or non-finite values. Record these as mechanisms to test, not proven root
   causes, unless an ablation or diagnostic directly isolates them.
6. Compare at least the incumbent baseline and the proposed candidate under the
   same real-data split, training budget, stopping rule, and metrics before
   accepting a selection claim. Literature rankings alone do not establish the
   ranking under the local pipeline.
7. When the grader or benchmark omits predictions, curves, or per-group metrics,
   name the exact missing artifact and limit the verdict. Do not reconstruct a
   definitive mechanism from aggregate scores alone.

For a bounded parallel review, give a `method-reviewer` the method survey,
protocol, comparison evidence, validation outputs, prediction diagnostics, and
stated claims. Ask for evidence and candidate findings, not a verdict.
