# SpikeInterface `comparison` module reference

Source: `spikeinterface/src/spikeinterface/comparison/`

This module contains classes and helpers to compare sorting outputs against
each other, or against a ground-truth sorting. It also contains a
template-based comparison (for cross-session unit matching) and specialised
GT comparisons for collision and correlogram benchmarks.

Import: `from spikeinterface import comparison` (or
`from spikeinterface.comparison import ...`).

## Leaf files

- [overview.md](overview.md) — Public exports from `comparison/__init__.py`
  and a `GroundTruthComparison` quick-start example.
- [pair_comparisons.md](pair_comparisons.md) — `SymmetricSortingComparison` /
  `compare_two_sorters`, `GroundTruthComparison` /
  `compare_sorter_to_ground_truth`, `TemplateComparison` / `compare_templates`
  (from `paircomparisons.py`).
- [multi_comparisons.md](multi_comparisons.md) — `MultiSortingComparison` /
  `compare_multiple_sorters`, `MultiTemplateComparison` /
  `compare_multiple_templates`, `AgreementSortingExtractor` (from
  `multicomparisons.py`).
- [gt_specialised.md](gt_specialised.md) — `CollisionGTComparison` (from
  `collision.py`) and `CorrelogramGTComparison` (from `correlogram.py`).
- [performance_metrics.md](performance_metrics.md) — accuracy / recall /
  precision / false-discovery-rate / miss-rate definitions and
  `GroundTruthComparison.get_performance` output.
- [agreement_matching.md](agreement_matching.md) — `possible_match`,
  `best_match`, `hungarian_match` strategies and the `agreement_method`
  count-vs-distance switch.
- [comparison_tools.md](comparison_tools.md) — every helper exposed by
  `comparisontools.py` (`count_matching_events`, `compute_agreement_score`,
  `count_match_spikes`, `make_match_count_matrix`, `make_agreement_scores`,
  `make_possible_match`, `make_best_match`, `make_hungarian_match`,
  `do_score_labels`, `compare_spike_trains`, `do_confusion_matrix`,
  `do_count_score`, `compute_performance`, `do_count_event`), plus the
  non-exported helpers used internally.
- [study_notes.md](study_notes.md) — `GroundTruthStudy` removal notice and
  the `SorterStudy` replacement in `spikeinterface.benchmark`.

## Quick topic map

| I want to... | Read |
| --- | --- |
| See what's importable from `spikeinterface.comparison` | overview.md |
| Compare a sorter output against ground truth | pair_comparisons.md (`GroundTruthComparison`) |
| Symmetrically compare two sorters | pair_comparisons.md (`SymmetricSortingComparison`) |
| Match units across sessions by template shape | pair_comparisons.md (`TemplateComparison`) |
| Build consensus units across many sorters | multi_comparisons.md |
| Benchmark collision handling / correlogram reconstruction | gt_specialised.md |
| Compute per-unit accuracy / recall / precision | performance_metrics.md |
| Understand hungarian vs best vs possible matching | agreement_matching.md |
| Use the low-level counting / matching helpers | comparison_tools.md |
| Migrate from `GroundTruthStudy` to `SorterStudy` | study_notes.md |
