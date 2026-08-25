---
name: frame-scientific-decision
description: Expose the claim, evidence, externally fixed constraints, and unresolved outcome-sensitive choices before BrainPilot's Principal delegates scientific work. Principal must use for experiment design, data analysis, modelling, prediction, method recommendation, or scientific interpretation where a choice could change the conclusion.
---

# Frame Scientific Decision

Frame the task around the decision the user needs, not the shape of the final
artifact. Create a compact decision map before the first substantive delegation:

| Decision | Can change metric or claim? | Fixed by | Evidence needed | Owner | Resolution rule |
|---|---|---|---|---|---|

List the intended outcome, acceptance criterion, claims to support, authorized
data and evidence, available compute and time, and every unresolved choice that
could materially change the outcome.

Count a choice as fixed only when the user, task specification, or an external
protocol independently determines it. Treat hints, examples, familiar defaults,
and the first plausible implementation as open choices. A single requested file,
class, report, or final model fixes delivery shape, not the scientific method.
Fixed input/output, preprocessing, or training rules do not automatically fix
architecture, capacity, features, statistics, or decision criteria.

A private final test prevents inspection of that test; it does not invalidate
predeclared comparison on authorized training and validation data. Failure to
find a matching local Skill increases the need for Librarian grounding when
knowledge is missing; it never proves that research is unnecessary.

Route each unresolved choice to the applicable workflow Skill:

- model, algorithm, architecture, decoder, or pipeline →
  `coordinate-model-selection`;
- analysis, statistics, visualization, or interpretation →
  `coordinate-data-analysis`;
- factual or literature evidence → `coordinate-literature-synthesis`;
- hypothesis, experiment, measurement, or sampling →
  `coordinate-study-design`;
- implementation or debugging with fixed behavior →
  `coordinate-software-delivery`.

Compose workflows for mixed tasks in evidence-dependency order. Complete the
frame only when every outcome-sensitive choice has an owner, evidence source,
and checkable resolution or stopping rule. Then dispatch the first upstream task
and stop the turn.
