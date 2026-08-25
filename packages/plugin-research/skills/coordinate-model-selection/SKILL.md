---
name: coordinate-model-selection
description: Coordinate evidence-based selection of a data-driven model, algorithm, decoder, architecture, or analysis pipeline. Principal must use when performance depends on a method choice not explicitly fixed by the user, including tasks that submit one final class or file, provide design hints, use a frozen scorer, or hide the final test set.
---

# Coordinate Model Selection

Define the target claim, primary metric, natural generalization unit, constraints,
and available comparison data. Separate externally fixed requirements from hints
that still leave a method choice.

Coordinate the evidence chain:

1. Dispatch Engineer to create the data inventory, inspect representative real
   inputs, verify compute, and build decision-neutral evaluation plumbing.
2. In parallel, dispatch Librarian to compare substantively different credible
   method families, established baselines, applicability, costs, and limitations.
3. Synthesize those artifacts. Preserve at least one credible baseline and enough
   distinct candidates to expose the decision; justify every material exclusion.
4. Dispatch Experimentalist to predeclare the comparison protocol: splits,
   grouping unit, seeds or resampling, primary and guardrail metrics, failure
   diagnostics, budget, staged reductions, selection rule, and stopping rule.
5. Dispatch Engineer to implement and execute that protocol on authorized real
   data. Treat import checks, loss decrease, subsets, and short runs as
   feasibility evidence only.
6. Dispatch Experimentalist to review saved results independently, request
   bounded follow-up work when the rule requires it, freeze the final comparable
   snapshot, and apply the declared decision rule once.
7. Use `audit-feedback-loop` on the frozen selected artifact and its complete
   evidence chain.

Do not let the first runnable model become the implicit incumbent. Do not infer
that model selection is impossible merely because the evaluator owns the final
held-out test. If comparison evidence is genuinely unavailable, preserve a
validated fallback and report the result as empirically unresolved.

Complete only when the handoff names the data contract, method survey, protocol,
baseline, candidate results including failures, decision record, selected
artifact, and final audit verdict.
