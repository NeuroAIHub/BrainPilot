# Specialised GT comparisons
Source in repo: `spikeinterface/src/spikeinterface/comparison/collision.py`, `spikeinterface/src/spikeinterface/comparison/correlogram.py`
Parent index: [INDEX.md](INDEX.md)
---

### `CollisionGTComparison`

Extension of `GroundTruthComparison` focused on spike-in-collision performance.
Defined in `collision.py`.

Signature (verbatim from source):

```python
CollisionGTComparison(
    gt_sorting,
    tested_sorting,
    collision_lag=2.0,   # ms
    nbins=11,
    progress_bar=True,
    **kwargs,            # forwarded to GroundTruthComparison; compute_labels is forced to True
)
```

Parameters:
- `gt_sorting` (`BaseSorting`).
- `tested_sorting` (`BaseSorting`).
- `collision_lag` (`float`, default `2.0`): collision lag in ms.
- `nbins` (`int`, default `11`): number of collision bins.
- `progress_bar` (`bool`, default `True`).
- `**kwargs`: forwarded to `GroundTruthComparison.__init__`;
  `kwargs["compute_labels"] = True` is set unconditionally.

Restrictions: mono-segment sortings only (raises `NotImplementedError`
otherwise).

Attributes: `progress_bar`, `collision_lag`, `nbins`, `collision_events`
(structured array from `make_collision_events`), `bins`, `all_tp`, `all_fn`
(arrays of shape `(n_gt, n_gt, nbins)`, `dtype="int64"`).

Key methods:
- `detect_gt_collision()` — computes `delta = int(self.collision_lag / 1000 * self.sampling_frequency)`
  and populates `self.collision_events`.
- `compute_all_pair_collision_bins()` — fills `self.bins`, `self.all_tp`,
  `self.all_fn`.
- `compute_collision_by_similarity(similarity_matrix, unit_ids=None, good_only=False, min_accuracy=0.9)`
  → `(similarities, recall_scores, pair_names)`, sorted by similarity.

### `CorrelogramGTComparison`

Extension of `GroundTruthComparison` focused on cross-correlogram reconstruction.
Defined in `correlogram.py`.

Signature (verbatim from source):

```python
CorrelogramGTComparison(
    gt_sorting,
    tested_sorting,
    window_ms=100.0,
    bin_ms=1.0,
    well_detected_score=0.8,
    **kwargs,   # forwarded to GroundTruthComparison; compute_labels is forced to True
)
```

Parameters:
- `gt_sorting` (`BaseSorting`).
- `tested_sorting` (`BaseSorting`).
- `window_ms` (`float`, default `100.0`).
- `bin_ms` (`float`, default `1.0`).
- `well_detected_score` (`float`, default `0.8`).
- `**kwargs`: forwarded to `GroundTruthComparison.__init__`;
  `kwargs["compute_labels"] = True` is set unconditionally.

Restrictions: mono-segment sortings only (raises `NotImplementedError`
otherwise).

Attributes: `window_ms`, `bin_ms`, `well_detected_score`, `compute_kwargs`
(dict passed to `compute_correlograms`), `correlograms` (`dict` with keys
`"true"` and `"estimated"`), `good_sorting`, `good_gt`, `good_idx_gt`,
`good_idx_sorting`, `nb_cells`, `nb_timesteps`, `_center`.

Key methods:
- `compute_correlograms()` — fills `self.correlograms["true"]` and
  `self.correlograms["estimated"]` limited to well-detected units.
- `time_bins` (property) → `np.linspace(-window_ms / 2, window_ms / 2, nb_timesteps)`.
- `error(window_ms=None)` → mean relative error per bin (1-D array).
- `compute_correlogram_by_similarity(similarity_matrix, window_ms=None)`
  → `(similarities, errors)`, sorted by similarity.
- Internal helper: `_get_slice(window_ms=None)`.
