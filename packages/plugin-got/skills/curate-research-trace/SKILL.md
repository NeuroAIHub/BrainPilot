---
name: curate-research-trace
description: Curate BrainPilot Trace Events into human-readable research Episodes, appropriately granular nodes, and direct depends_on relationships. Use when a report contains multiple settings, results, analyses, visualizations, findings, or conclusions; when Episode placement is unclear; or when deciding whether new evidence should create parallel/sequential nodes or update an existing node.
---

# Curate Research Trace

Turn reported research work into a compact derivation graph. Preserve scientific
units rather than tool chronology.

## Curate one Trace Event

1. Inspect the active graph and reuse established Episode names and nodes.
2. Extract units that can be inspected, cited, reproduced, or revoked independently.
3. Assign every new unit to one research work-package Episode.
4. Update an existing node when the report adds evidence to the same unit.
5. Create parallel nodes when neither unit consumes the other.
6. Create sequential dependencies only when the downstream unit consumes or
   requires the upstream unit.
7. Add only direct parents. Never copy all transitive ancestors.

## Select an Episode

Treat an Episode as one coherent research subquestion or experiment family, not
as a time period or causal node.

- Use `Literature Review — <topic>` for evidence synthesis around one question.
- Use `Method Design — <method>` for reusable method or protocol decisions.
- Use `Environment & Reproducibility` for shared runtime, dependency, hardware,
  and reproducibility setup.
- Use `Data Preparation — <dataset>` for a dataset version, split, or material
  preprocessing pipeline.
- Use `Main Experiment — <question>` for settings and outputs testing one main hypothesis.
- Use `Ablation — <factor>` for all settings, results, comparisons,
  visualizations, and local findings in one ablation family.
- Use `Robustness — <factor>` for sensitivity or robustness settings and outputs.
- Use `Cross-experiment Analysis — <question>` only when an analysis consumes
  results from multiple experiment families.
- Use `Final Synthesis` for conclusions that integrate findings across Episodes.

Use the session language. Prefer an existing exact Episode name. Do not create
Episodes based only on Agent, tool, file, timestamp, or generic lifecycle phase.
Dependencies may cross Episode boundaries.

## Decide node boundaries

Create separate parallel nodes for:

- distinct settings, conditions, or model variants;
- the independently inspectable result of each setting;
- analyses that answer different scientific questions;
- findings that can independently hold or be refuted.

Create separate sequential nodes when one report contains independently
reviewable configuration, result, analysis/visualization, finding, and conclusion
units. Connect them only in the order in which outputs are actually consumed.

Update one existing node for:

- seeds, folds, replicates, and repeated runs of the same setting and outcome;
- additional evidence or a correction for the same result or finding;
- multiple export formats of one result or figure;
- immediate retries, formatting changes, and non-meaningful intermediates.

Keep multiple metrics in one result when they jointly describe one run. Split
them only when they are reused independently or support independently
falsifiable findings. Make a visualization a node only when it performs an
independent analysis or carries an independently cited interpretation; otherwise
attach it as an artifact.

## Select direct parents

Apply this counterfactual: if the parent disappeared, would the child lose its
evidence or need recomputation?

- A result depends on the setting and concrete method/data/environment inputs it used.
- An analysis depends on the result nodes it consumes.
- A visualization depends on the result or analysis used to generate it.
- A finding depends on its direct result or analysis evidence.
- A conclusion depends on direct findings, not every underlying result.

Do not connect nodes because they are adjacent, share an Episode or author, use
similar words, or occurred in order. Parallel settings share parents and do not
depend on one another.

Read [references/examples.md](references/examples.md) when a report mixes
multiple research phases, contains an ablation, or leaves node boundaries unclear.
