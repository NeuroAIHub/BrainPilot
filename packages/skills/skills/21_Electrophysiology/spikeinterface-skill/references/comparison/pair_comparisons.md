# Pair comparisons
Source in repo: `spikeinterface/src/spikeinterface/comparison/paircomparisons.py`
Parent index: [INDEX.md](INDEX.md)
---

Defined in `paircomparisons.py`.

### `SymmetricSortingComparison` / `compare_two_sorters`

Compare two sorting outputs symmetrically. `compare_two_sorters` is a
function alias generated from the class via
`define_function_from_class(source_class=SymmetricSortingComparison, name="compare_two_sorters")`.
Its call signature (kwargs) is identical to the class constructor.

Signature (verbatim from source):

```python
SymmetricSortingComparison(
    sorting1: BaseSorting,
    sorting2: BaseSorting,
    sorting1_name: str | None = None,
    sorting2_name: str | None = None,
    delta_time: float = 0.4,
    match_score: float = 0.5,
    chance_score: float = 0.1,
    agreement_method: str = "count",   # "count" | "distance"
    verbose: bool = False,
)
```

Parameters:
- `sorting1` (`BaseSorting`): first sorting for the comparison.
- `sorting2` (`BaseSorting`): second sorting for the comparison.
- `sorting1_name` (`str | None`, default `None`): name of sorter 1
  (defaults to `"sorting1"`).
- `sorting2_name` (`str | None`, default `None`): name of sorter 2
  (defaults to `"sorting2"`).
- `delta_time` (`float`, default `0.4`): number of ms to consider coincident
  spikes.
- `match_score` (`float`, default `0.5`): minimum agreement score to match units.
- `chance_score` (`float`, default `0.1`): minimum agreement score for a
  possible match.
- `agreement_method` (`str`, default `"count"`): must be one of `"count"` or
  `"distance"`. `"count"` computes agreement scores from spike counts;
  `"distance"` computes agreement scores from spike-time distance functions.
- `verbose` (`bool`, default `False`).

Key behaviour:
- Spike trains are matched via agreement scores; matching is computed with
  `ensure_symmetry=True` and the Hungarian algorithm.
- Individual spikes are labelled `TP`, `FN`, `FP1`, `FP2`, `CL`.
- Attributes populated by matching: `hungarian_match_12`, `hungarian_match_21`,
  `best_match_12`, `best_match_21`, `possible_match_12`, `possible_match_21`,
  `agreement_scores`, and (when `agreement_method="count"`)
  `match_event_count`, `event_counts1`, `event_counts2`.
- Additional attributes: `sorting1` (property), `sorting2` (property),
  `sorting1_name` (property), `sorting2_name` (property), `unit1_ids`,
  `unit2_ids`, `ensure_symmetry`, `agreement_method`, `delta_time`,
  `delta_frames`, `sampling_frequency`, `match_score`, `chance_score`,
  `object_list`, `name_list`.

Methods:
- `get_matching()` — returns `(hungarian_match_12, hungarian_match_21)`.
- `get_matching_event_count(unit1, unit2)` — count of coincident events
  between the pair (only valid when `agreement_method="count"`).
- `get_best_unit_match1(unit1)`, `get_best_unit_match2(unit2)`.
- `get_matching_unit_list1(unit1)`, `get_matching_unit_list2(unit2)` —
  possible matches above `chance_score`.
- `get_agreement_fraction(unit1=None, unit2=None)`.
- Inherited from `BasePairComparison`: `get_ordered_agreement_scores()`.

### `GroundTruthComparison` / `compare_sorter_to_ground_truth`

Compare a tested sorting to a ground-truth sorting. `compare_sorter_to_ground_truth`
is generated from the class via
`define_function_from_class(source_class=GroundTruthComparison, name="compare_sorter_to_ground_truth")`.
Its call signature (kwargs) is identical to the class constructor.

Signature (verbatim from source, keyword order preserved):

```python
GroundTruthComparison(
    gt_sorting: BaseSorting,
    tested_sorting: BaseSorting,
    gt_name: str | None = None,
    tested_name: str | None = None,
    delta_time: float = 0.4,
    match_score: float = 0.5,
    well_detected_score: float = 0.8,
    redundant_score: float = 0.2,
    overmerged_score: float = 0.2,
    chance_score: float = 0.1,
    exhaustive_gt: bool = False,
    agreement_method: str = "count",   # "count" | "distance"
    match_mode: str = "hungarian",     # "hungarian" | "best"
    compute_labels: bool = False,
    compute_misclassifications: bool = False,
    verbose: bool = False,
)
```

Parameters:
- `gt_sorting` (`BaseSorting`): ground-truth sorting.
- `tested_sorting` (`BaseSorting`): sorting being evaluated.
- `gt_name` (`str | None`, default `None`): defaults to `"ground truth"`.
- `tested_name` (`str | None`, default `None`): defaults to `"tested"`.
- `delta_time` (`float`, default `0.4`): ms tolerance for coincident spikes
  (two spikes coincide iff `abs(spike1_time - spike2_time) <= delta_time`).
- `match_score` (`float`, default `0.5`): minimum agreement to match units.
- `well_detected_score` (`float`, default `0.8`): agreement above which units
  are counted as well detected.
- `redundant_score` (`float`, default `0.2`): agreement above which unmatched
  tested units are counted as redundant.
- `overmerged_score` (`float`, default `0.2`): tested units with 2+ agreement
  scores above this are counted as overmerged.
- `chance_score` (`float`, default `0.1`): minimum agreement for a possible
  match.
- `exhaustive_gt` (`bool`, default `False`): whether the GT contains every
  unit in the recording. Enables `false-positive`, `redundant`, `overmerged`,
  `bad` accounting.
- `agreement_method` (`str`, default `"count"`): must be one of `"count"` or
  `"distance"` (same semantics as in `SymmetricSortingComparison`).
- `match_mode` (`str`, default `"hungarian"`): must be one of `"hungarian"`
  or `"best"`. `assert match_mode in ["hungarian", "best"]` is enforced.
- `compute_labels` (`bool`, default `False`): if True, per-spike labels are
  computed at init.
- `compute_misclassifications` (`bool`, default `False`): if True, `CL_...`
  labels are attached during label computation.
- `verbose` (`bool`, default `False`).

Notes:
- `ensure_symmetry=False` internally (GT is the reference).
- If `exhaustive_gt=True`, redundant / overmerged / false-positive / bad units
  can be counted (MEArec simulated datasets typically qualify).

Attributes populated on the instance:
- `exhaustive_gt`, `redundant_score`, `overmerged_score`, `well_detected_score`,
  `match_mode`, `_compute_labels`, `_compute_misclassifications`, `count_score`
  (per-GT-unit table), `_labels_st1`, `_labels_st2` (lazy), `_confusion_matrix`
  (lazy).
- Inherited: `sorting1`, `sorting2`, `sorting1_name`, `sorting2_name`,
  `unit1_ids`, `unit2_ids`, `delta_time`, `delta_frames`, `sampling_frequency`,
  `agreement_method`, `event_counts1`, `event_counts2`, `match_event_count`,
  `agreement_scores`, `possible_match_12`, `possible_match_21`, `best_match_12`,
  `best_match_21`, `hungarian_match_12`, `hungarian_match_21`, `match_score`,
  `chance_score`, `object_list`, `name_list`.

Methods (from `paircomparisons.py`):

- `get_labels1(unit_id)` — per-spike label array (`TP`, `FN`, `FP`, optional
  `CL_...`). Requires `match_mode="hungarian"`.
- `get_labels2(unit_id)` — same, for the tested sorting.
- `get_confusion_matrix()` → `pandas.DataFrame`; adds a trailing `FP` row
  and `FN` column.
- `get_performance(method="by_unit", output="pandas")`. `method` must be one
  of `"raw_count"`, `"by_unit"`, `"pooled_with_average"` (checked against
  `("raw_count", "by_unit", "pooled_with_average")`). `output` must be one of
  `"pandas"` or `"dict"`.
- `print_performance(method="pooled_with_average")`. `method` in
  `"by_unit"` or `"pooled_with_average"`.
- `print_summary(well_detected_score=None, redundant_score=None, overmerged_score=None)`.
- `get_well_detected_units(well_detected_score=None)`.
- `count_well_detected_units(well_detected_score)`.
- `get_false_positive_units(redundant_score=None)` — requires `exhaustive_gt=True`.
- `count_false_positive_units(redundant_score=None)` — requires `exhaustive_gt=True`.
- `get_redundant_units(redundant_score=None)` — requires `exhaustive_gt=True`.
- `count_redundant_units(redundant_score=None)` — requires `exhaustive_gt=True`.
- `get_overmerged_units(overmerged_score=None)` — requires `exhaustive_gt=True`.
- `count_overmerged_units(overmerged_score=None)` — requires `exhaustive_gt=True`.
- `get_bad_units()` — union of false-positive + redundant; requires `exhaustive_gt=True`.
- `count_bad_units()`.
- `count_units_categories(well_detected_score=None, overmerged_score=None, redundant_score=None)`
  → `pandas.Series` with `num_gt`, `num_sorter`, `num_well_detected`
  (and, if `exhaustive_gt`, `num_overmerged`, `num_redundant`,
  `num_false_positive`, `num_bad`).
- Inherited from `BasePairComparison`: `get_ordered_agreement_scores()`.

Category definitions (from docstrings):
- **well detected**: tested unit matched to a GT unit with agreement
  `>= well_detected_score`.
- **false positive**: tested unit not matched at all in GT (best-match score
  `< redundant_score`, or no best match).
- **redundant**: tested unit matches a GT unit with a big agreement score but
  is not the best match (score `>= redundant_score`, not the primary match).
- **overmerged**: tested unit has 2+ agreement scores above `overmerged_score`
  (i.e. merges multiple GT units).
- **bad**: union of false-positive + redundant units.

### `TemplateComparison` / `compare_templates`

Cross-session unit matching based on template similarity.
`compare_templates` is generated from the class via
`define_function_from_class(source_class=TemplateComparison, name="compare_templates")`.
Its call signature (kwargs) is identical to the class constructor.

Signature (verbatim from source, keyword order preserved):

```python
TemplateComparison(
    sorting_analyzer_1,
    sorting_analyzer_2,
    name1=None,                 # default "sess1"
    name2=None,                 # default "sess2"
    unit_ids1=None,
    unit_ids2=None,
    match_score=0.7,
    chance_score=0.3,
    similarity_method="cosine", # "cosine" | "l1" | "l2"
    support="union",            # "dense" | "union" | "intersection"
    num_shifts=0,
    verbose=False,
)
```

Parameters:
- `sorting_analyzer_1`, `sorting_analyzer_2`: the two `SortingAnalyzer`
  objects whose templates are compared.
- `name1` (default `None` → `"sess1"`).
- `name2` (default `None` → `"sess2"`).
- `unit_ids1` (`list | None`, default `None`): units from analyzer 1.
- `unit_ids2` (`list | None`, default `None`): units from analyzer 2.
- `match_score` (`float`, default `0.7`).
- `chance_score` (`float`, default `0.3`).
- `similarity_method` (`str`, default `"cosine"`): must be one of `"cosine"`,
  `"l1"`, `"l2"`.
- `support` (`str`, default `"union"`): must be one of `"dense"`, `"union"`,
  `"intersection"`.
- `num_shifts` (`int`, default `0`): shifts allowed when maximising template
  similarity.
- `verbose` (`bool`, default `False`).

Behaviour:
- Uses `spikeinterface.postprocessing.compute_template_similarity_by_pair`
  to build `agreement_scores`.
- Requires both recordings to have the same channel count and identical
  channel ids (otherwise raises `ValueError`).

Attributes: `sorting_analyzer_1`, `sorting_analyzer_2`, `unit_ids`
(`[unit_ids1, unit_ids2]`), `matches` (dict, initially empty),
`similarity_method`, `support`, `num_shifts`, `agreement_scores`,
`possible_match_12`, `possible_match_21`, `best_match_12`, `best_match_21`,
`hungarian_match_12`, `hungarian_match_21`, `match_score`, `chance_score`,
`object_list`, `name_list`.

Methods: inherited from `BasePairComparison` (`get_ordered_agreement_scores()`).
