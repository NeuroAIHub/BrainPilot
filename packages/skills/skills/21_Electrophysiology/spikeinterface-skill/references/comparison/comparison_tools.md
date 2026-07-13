# Utilities in `comparisontools.py`
Source in repo: `spikeinterface/src/spikeinterface/comparison/comparisontools.py`
Parent index: [INDEX.md](INDEX.md)
---

All entries below are exported from `comparison/__init__.py` unless noted.

### `count_matching_events`

```python
count_matching_events(times1, times2: np.ndarray | list, delta: int = 10) -> int
```

Count coincident spikes between two spike-time arrays.

Parameters:
- `times1` (`list` / `np.ndarray`): frames of spike train 1.
- `times2` (`np.ndarray | list`): frames of spike train 2.
- `delta` (`int`, default `10`): frame tolerance for considering matches.

Returns the integer count of matching events.

### `compute_agreement_score`

```python
compute_agreement_score(num_matches: int, num1: int, num2: int) -> float
```

Scalar agreement score `num_matches / (num1 + num2 - num_matches)`.
Returns `0` when the denominator is `0`.

### `count_match_spikes`

```python
count_match_spikes(times1, all_times2, delta_frames) -> np.ndarray
```

Vectorised `count_matching_events` over a list of spike trains.

Parameters:
- `times1`: reference spike train frames.
- `all_times2`: list of spike-train frame arrays from sorting 2.
- `delta_frames`: frame tolerance.

Returns a 1-D `int64` array of match counts, one per entry of `all_times2`.

### `make_match_count_matrix`

```python
make_match_count_matrix(
    sorting1: BaseSorting,
    sorting2: BaseSorting,
    delta_frames: int,
    ensure_symmetry: bool = False,
) -> pd.DataFrame
```

Compute, for every pair `(unit_i in sorting1, unit_j in sorting2)`, the
number of matching (coincident within `delta_frames`) spikes. When
`ensure_symmetry=True`, the algorithm is also run with the sortings swapped
and the pointwise maximum kept, then transposed. A final clip prevents any
cell from exceeding the number of spikes in `sorting2`. Requires both
sortings to have the same number of segments.

### `make_agreement_scores`

```python
make_agreement_scores(
    sorting1: BaseSorting,
    sorting2: BaseSorting,
    delta_frames: int,
    ensure_symmetry: bool = True,
) -> pd.DataFrame
```

Convenience wrapper: computes event counts and the match-count matrix, then
returns `make_agreement_scores_from_count(match_event_count, event_counts1,
event_counts2)`. The score is
`match / (event_counts1 + event_counts2 - match)`.

Related (not re-exported): `make_agreement_scores_from_count(match_event_count, event_counts1, event_counts2)`
uses the pre-computed count matrix.
Related (not re-exported): `calculate_agreement_scores_with_distance(sorting1, sorting2, delta_frames)`
returns a DataFrame of agreement scores derived from a spike-time distance
matrix.

### `make_possible_match`

```python
make_possible_match(agreement_scores, min_score) -> tuple[dict[Any, np.ndarray], dict[Any, np.ndarray]]
```

Returns `(possible_match_12, possible_match_21)`: for each unit, the array of
counterparts with score `>= min_score`. Symmetric.

Parameters:
- `agreement_scores` (`pd.DataFrame`).
- `min_score` (`float`).

### `make_best_match`

```python
make_best_match(agreement_scores, min_score) -> "tuple[pd.Series, pd.Series]"
```

Returns `(best_match_12, best_match_21)`: for each unit, its best-scoring
counterpart if that score `>= min_score`, else `-1` (int ids) or `""`
(string / object ids). Symmetric.

Parameters:
- `agreement_scores` (`pd.DataFrame`).
- `min_score` (`float`).

### `make_hungarian_match`

```python
make_hungarian_match(agreement_scores, min_score) -> tuple[pd.Series, pd.Series]
```

Optimal one-to-one assignment using `scipy.optimize.linear_sum_assignment`
on `-agreement_scores` (after zeroing entries below `min_score`). Missing
matches are `-1` (int ids) or `""` (string / object ids).

Parameters:
- `agreement_scores` (`pd.DataFrame`).
- `min_score` (`float`).

### `do_score_labels`

```python
do_score_labels(
    sorting1,
    sorting2,
    delta_frames,
    unit_map12,
    label_misclassification=False,
) -> tuple[dict, dict]
```

Labels each spike in each sorting with one of `TP`, `FN`, `FP`, or
`CL_<u1>_<u2>` (when `label_misclassification=True`). Returns
`(labels_st1, labels_st2)`: two dicts keyed by unit id whose values are
per-segment `np.array` of `<U8` labels.

Parameters:
- `sorting1` (`BaseSorting`): ground-truth sorting.
- `sorting2` (`BaseSorting`): tested sorting.
- `delta_frames` (`int`).
- `unit_map12` (`pd.Series`): mapping sorting1 → sorting2 (hungarian or best).
- `label_misclassification` (`bool`, default `False`).

### `compare_spike_trains`

```python
compare_spike_trains(spiketrain1, spiketrain2, delta_frames=10) -> tuple[np.ndarray, np.ndarray]
```

TP / FN / FP labels for a single pair of spike-time arrays (`spiketrain1`
is assumed to be the ground truth). Returns `(lab_st1, lab_st2)`. Note the
implementation uses `delta_frames // 2` as the effective tolerance.

### `do_confusion_matrix`

```python
do_confusion_matrix(event_counts1, event_counts2, match_12, match_event_count) -> pd.DataFrame
```

Builds the confusion matrix; adds a trailing `FP` row (unmatched sorting2
counts) and `FN` column (unmatched sorting1 counts). Row/column order is
matched units first, then unmatched units.

Parameters:
- `event_counts1` (`pd.Series`): number of events per unit in sorting 1.
- `event_counts2` (`pd.Series`): number of events per unit in sorting 2.
- `match_12` (`pd.Series`): matching sorting1 → sorting2.
- `match_event_count` (`pd.DataFrame`): from `make_match_count_matrix`.

### `do_count_score`

```python
do_count_score(event_counts1, event_counts2, match_12, match_event_count) -> pd.DataFrame
```

Per-GT-unit table with columns `["tp", "fn", "fp", "num_gt", "num_tested",
"tested_id"]` (index name `"gt_unit_id"`). Used as the input to
`compute_performance`.

Parameters:
- `event_counts1` (`pd.Series`).
- `event_counts2` (`pd.Series`).
- `match_12` (`pd.Series`): matching sorting1 → sorting2 (hungarian or best).
- `match_event_count` (`pd.DataFrame`).

### `compute_performance`

```python
compute_performance(count_score) -> pd.DataFrame
```

Returns a DataFrame with columns
`["accuracy", "recall", "precision", "false_discovery_rate", "miss_rate"]`
indexed by GT unit id (see formulas above). Works both on `pd.Series`
(single unit) and `pd.DataFrame` (all units). Rows with `num_gt == 0` or
`tp == 0` are kept at `0`.

### `do_count_event`

```python
do_count_event(sorting) -> pd.Series
```

Number of spikes per unit (kept for backward compat; use
`sorting.count_num_spikes_per_unit(outputs="dict")` directly).

Parameters:
- `sorting` (`BaseSorting`).

### Non-exported helpers (still in `comparisontools.py`)

These are not in `__init__.py` but are used by the classes above:

- `get_optimized_compute_matching_matrix()` — returns a numba-jitted
  `compute_matching_matrix(spike_frames_train1, spike_frames_train2, unit_indices1, unit_indices2, num_units_train1, num_units_train2, delta_frames)`.
- `make_agreement_scores_from_count(match_event_count, event_counts1, event_counts2)`.
- `calculate_agreement_scores_with_distance(sorting1, sorting2, delta_frames)`.
- `_empty_match_series(unit1_ids, unit2_ids)`.
- `make_matching_events(times1, times2, delta)` — returns a structured array
  with dtype `[("index1", "int64"), ("index2", "int64"), ("delta_frame", "int64")]`.
- `make_collision_events(sorting, delta, progress_bar=False)` — returns a
  structured array with dtype `[("index1", "int64"), ("unit_id1", unit_ids.dtype), ("unit_index1", "int64"), ("index2", "int64"), ("unit_id2", unit_ids.dtype), ("unit_index2", "int64"), ("delta_frame", "int64")]`.
- `get_compute_dot_product_function()`, `get_compute_square_norm_function()`,
  `_compute_spike_vector_squared_norm(...)`, `_compute_spike_vector_dot_product(...)`,
  `compute_distance_matrix(...)`, `calculate_generalized_comparison_metrics(...)`
  — numba-backed low-level utilities used by the distance-based agreement path.
