# Research Trace Curation Examples

## Contents

1. Full research path
2. Three-setting ablation
3. Mixed report splitting
4. Metric boundaries
5. Visualization boundaries
6. Incorrect graph patterns

## 1. Full research path

Use separate Episodes for reusable prerequisites, then connect their nodes to the
experiment outputs that actually consume them.

```text
Episode: Literature Review — regularization
  Prior evidence synthesis

Episode: Method Design — classifier protocol
  Evaluation protocol

Episode: Environment & Reproducibility
  Locked CUDA and Python environment

Episode: Data Preparation — Dataset A
  Subject-wise train/validation split

Episode: Main Experiment — classifier generalization
  Baseline setting
  Baseline validation result
  Generalization analysis
  Finding: baseline exceeds the preregistered threshold

Direct dependencies:
  Prior evidence synthesis -> Evaluation protocol
  Evaluation protocol -> Baseline validation result
  Locked environment -> Baseline validation result
  Subject-wise split -> Baseline validation result
  Baseline setting -> Baseline validation result
  Baseline validation result -> Generalization analysis
  Generalization analysis -> Finding
```

Do not connect Episodes themselves. They are presentation groups.

## 2. Three-setting ablation

Put the complete local derivation in one Episode.

```text
Episode: Ablation — dropout

Baseline setting -----------------> Baseline result -------\
No-dropout setting ---------------> No-dropout result ------> Dropout comparison
Dropout-0.3 setting --------------> Dropout-0.3 result -----/          |
                                                                       +-> Ablation figure
                                                                       +-> Finding: dropout improves generalization
```

The settings and their results are parallel. Do not create
`Baseline setting -> No-dropout setting -> Dropout-0.3 setting`.

## 3. Mixed report splitting

Report:

> We evaluated the no-dropout configuration, obtained validation accuracy 0.78,
> and concluded that removing dropout reduced generalization.

Create three sequential units when each statement is independently inspectable:

1. `No-dropout setting` — the configuration.
2. `No-dropout validation result` — the measured output.
3. `Finding: removing dropout reduced generalization` — only if the report also
   contains an appropriate comparison; otherwise record the result without
   manufacturing the finding.

## 4. Metric boundaries

Keep accuracy, F1, and AUC from the same evaluation run in one result when they
jointly characterize performance. Split a fairness metric or robustness score
when it is produced by a distinct evaluation and later supports a separate analysis.

Repeated seeds update the same result node. Do not create one node per seed.

## 5. Visualization boundaries

- A PNG export of an already-recorded comparison is an artifact of that comparison.
- A dimensionality-reduction plot that performs a distinct analysis and supports
  a cluster-separation finding is a visualization node derived from its inputs.
- Multiple file formats of one figure remain artifacts of one node.

## 6. Incorrect graph patterns

Reject these patterns during curation:

- settings chained by execution time;
- one node containing several independently reportable settings and results;
- an Episode name used as if it were a node or parent;
- a finding connected directly to a setting while skipping the measured result;
- a conclusion connected to findings and all of their transitive result ancestors;
- nodes created for file reads, acknowledgements, formatting, or immediate retries.
