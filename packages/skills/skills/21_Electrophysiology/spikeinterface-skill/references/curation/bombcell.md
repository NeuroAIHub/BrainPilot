# Bombcell curation
Source in repo: `spikeinterface/src/spikeinterface/curation/bombcell_curation.py`
Parent index: [INDEX.md](INDEX.md)
---

## Bombcell curation

Port of the Bombcell labeling logic (Fabre et al.). Labels are one of: `noise`, `mua`,
`good`, `non_soma` (or `non_soma_good` / `non_soma_mua` when the non-somatic split option
is on).

### bombcell_get_default_thresholds

Verbatim signature from `bombcell_curation.py`:

```python
def bombcell_get_default_thresholds() -> dict
```

Returns a nested dict with three sections and their default per-metric bounds (values
copied verbatim from the source):

`noise` metrics:

- `num_positive_peaks`: `{"greater": None, "less": 2}`
- `num_negative_peaks`: `{"greater": None, "less": 1}`
- `peak_to_trough_duration`: `{"greater": 0.0001, "less": 0.00115}`  (seconds)
- `waveform_baseline_flatness`: `{"greater": None, "less": 0.5}`
- `peak_after_to_trough_ratio`: `{"greater": None, "less": 0.8}`
- `exp_decay`: `{"greater": 0.01, "less": 0.1}`

`mua` metrics:

- `amplitude_median`: `{"greater": 30, "less": None, "abs": True}` (uV, abs)
- `snr`: `{"greater": 5, "less": None}`
- `amplitude_cutoff`: `{"greater": None, "less": 0.2}`
- `num_spikes`: `{"greater": 300, "less": None}`
- `rp_contamination`: `{"greater": None, "less": 0.1}`
- `presence_ratio`: `{"greater": 0.7, "less": None}`
- `drift_ptp`: `{"greater": None, "less": 100}` (um)

`non-somatic` metrics:

- `peak_before_to_trough_ratio`: `{"greater": None, "less": 3}`
- `peak_before_width`: `{"greater": 0.00015, "less": None}` (seconds)
- `trough_width`: `{"greater": 0.0002, "less": None}` (seconds)
- `peak_before_to_peak_after_ratio`: `{"greater": None, "less": 3}`
- `main_peak_to_trough_ratio`: `{"greater": None, "less": 0.8}`

The default `noise`, `mua`, `non-somatic` metric name lists exposed as module constants
are `DEFAULT_NOISE_METRICS`, `DEFAULT_MUA_METRICS`, `DEFAULT_NON_SOMATIC_METRICS`.


### bombcell_label_units

Verbatim signature from `bombcell_curation.py`:

```python
def bombcell_label_units(
    sorting_analyzer=None,
    thresholds: dict | str | Path | None = None,
    label_non_somatic: bool = True,
    split_non_somatic_good_mua: bool = False,
    external_metrics: "pd.DataFrame | list[pd.DataFrame] | None" = None,
) -> "pd.DataFrame"
```

Parameters:

- `sorting_analyzer` (`SortingAnalyzer | None`, default `None`) - analyzer whose
  `quality_metrics` / `template_metrics` extensions supply the metrics. If `None`,
  `external_metrics` is required.
- `thresholds` (`dict | str | Path | None`, default `None`) - dict, JSON file path, or
  `None` for defaults from `bombcell_get_default_thresholds`.
- `label_non_somatic` (`bool`, default `True`) - if True, apply the non-somatic
  classification pass.
- `split_non_somatic_good_mua` (`bool`, default `False`) - if True, produce
  `non_soma_good` and `non_soma_mua` instead of a single `non_soma`.
- `external_metrics` (`pd.DataFrame | list[pd.DataFrame] | None`, default `None`) -
  pre-computed metrics as one DataFrame or a list of DataFrames (concatenated column-wise
  with `pd.concat(..., axis=1)`).

Returns a DataFrame indexed by unit id with column `bombcell_label` whose values are one
of: `"noise"`, `"mua"`, `"good"`, `"non_soma"` (default) or `"non_soma_good"` /
`"non_soma_mua"` (when `split_non_somatic_good_mua=True`).

Note: there is no `apply_bombcell_curation` function; labeling only produces a DataFrame.
Use `apply_curation` or manual removal to actually drop units.


### save_bombcell_results

Verbatim signature from `bombcell_curation.py`:

```python
def save_bombcell_results(
    metrics: "pd.DataFrame",
    unit_label: np.ndarray,
    thresholds: dict,
    folder,
    save_narrow: bool = True,
    save_wide: bool = True,
) -> None
```

Parameters:

- `metrics` (`pd.DataFrame`) - metrics indexed by unit id.
- `unit_label` (`np.ndarray`) - one label per unit (string dtype).
- `thresholds` (`dict`) - the threshold dict used to make the labels.
- `folder` (`str | Path`) - output folder (created if missing).
- `save_narrow` (`bool`, default `True`) - write `labeling_results_narrow.csv` (one row
  per unit-metric pair with pass/fail).
- `save_wide` (`bool`, default `True`) - write `labeling_results_wide.csv` (one row per
  unit, metrics as columns, extra `label` column inserted at position 0).
