# Quality Metrics — String-Literal parameter enumeration
Source in repo: `spikeinterface/src/spikeinterface/metrics/quality/`
Parent index: [../INDEX.md](../INDEX.md)
---

## String-Literal parameter enumeration

Complete list of every parameter whose docstring or usage expects a **string Literal** value in the quality-metric compute functions. Each entry is listed against the specific function it belongs to (same-name parameters appear separately per function).

| Function | Parameter | Allowed values | Default | Enforcement |
|---|---|---|---|---|
| `compute_snrs` | `method` | `"extremum"` \| `"at_index"` \| `"peak_to_peak"` | `"extremum"` | Passed to `get_template_amplitude_on_main_channel(peak_mode=method)`. |
| `compute_snrs` (docstring only) | `operator` (documented but **not** a real function argument) | `"median"` \| `"average"` | `"median"` | Docstring text; not implemented as a parameter. |
| `compute_amplitude_cv_metrics` | `amplitude_extension` | `"spike_amplitudes"` \| `"amplitude_scalings"` | `"spike_amplitudes"` | Asserted with `AssertionError("Invalid amplitude_extension. It can be either 'spike_amplitudes' or 'amplitude_scalings'")`. |
| `compute_drift_metrics` | `direction` | `"x"` \| `"y"` \| `"z"` (any name present in `spike_locations` dtype) | `"y"` | Asserted with `f"Direction {direction} is invalid. Available directions: {data.dtype.names}"`. |
| `Silhouette._silhouette_metric_function` (via `metric_params`) | `method` | `"simplified"` \| `"full"` | `"simplified"` | `if method == "simplified"` branch vs. `else` (any other value falls through to `silhouette_score`). |

Additional string-Literal notes:

- **`peak_sign` (removed)**: no compute function in `metrics/quality/` accepts a `peak_sign` argument anymore. On load, the backward-compat handler removes `peak_sign` from any of these metric-specific param dicts: `amplitude_cutoff`, `amplitude_median`, `snr`, `sd_ratio`, `nn_isolation`, `nn_noise_overlap`, `nn_advanced`, and from the top-level `params` dict.
- **`compute_presence_ratios` bin methods**: there is no user-selectable bin method — bin edges are computed via `compute_bin_edges_per_unit(sorting, segment_samples=..., periods=..., bin_duration_s=bin_duration_s)`.
- **`compute_sliding_rp_violations` methods**: there is no `method` parameter exposed on the compute function; the internal `slidingRP_violations(...)` helper selects `method = "numba" if HAVE_NUMBA else "numpy"` automatically.
- **`exclude_contaminated`**: this argument does **not** exist anywhere in `metrics/quality/`. It is not a parameter of any quality metric.
- **`sd_ratio` internal literals**: `find_duplicated_spikes(..., method="keep_first_iterative")` and `get_noise_levels(..., method="std", ...)` are hard-coded — not exposed to the user.
- **`nearest_neighbors_noise_overlap` internal literal**: `templates_ext.get_data(operator="median")` — hard-coded `"median"` operator.
- **Sparsity method for PCA metrics**: when `sorting_analyzer` is dense, `compute_sparsity(sorting_analyzer, method="radius", radius_um=radius_um)` is used inside `nearest_neighbors_isolation` and `nearest_neighbors_noise_overlap`.

Numeric-Literal (bool) parameters worth noting:

- `compute_sd_ratio`: `correct_for_drift: bool = True`, `correct_for_template_itself: bool = True`.
- `compute_drift_metrics`: `return_positions: bool = False`.
- `ComputeQualityMetrics._set_params`: `delete_existing_metrics: bool = False`, `use_valid_periods=False`, `skip_pc_metrics=False`.

Same-name parameters that appear in more than one function (each is separately governed by its own function's docstring/default):

- `unit_ids : list or None` — in every `compute_*` in `misc_metrics.py`, in `compute_num_spikes` / `compute_firing_rates`, and in the PCA metric functions.
- `periods : array of unit_period_dtype | None, default: None` — in every `compute_*` in `misc_metrics.py` **except** `compute_snrs`.
- `percentiles : tuple, default: (5, 95)` — in both `compute_firing_ranges` and `compute_amplitude_cv_metrics` (independent defaults, both `(5, 95)`).
- `min_num_bins` — in `compute_amplitude_cv_metrics` (default `10`) and `compute_drift_metrics` (default `2`). Different defaults.
- `bin_size_ms` — in `compute_sliding_rp_violations` (default `0.25`) and low-level `slidingRP_violations` (default `0.25`).
- `bin_size_s` — in `compute_firing_ranges` (default `5`).
- `bin_duration_s` — in `compute_presence_ratios` (default `60.0`) — do not confuse with `bin_size_s` above.
- `min_spikes` — in `compute_sliding_rp_violations` (default `0`), `nearest_neighbors_isolation` (default `10`), `nearest_neighbors_noise_overlap` (default `10`), and `NearestNeighborAdvanced.metric_params` (default `10`).
- `max_spikes` — in `nearest_neighbors_metrics` (no default — required positional), `nearest_neighbors_isolation` (default `1000`), `nearest_neighbors_noise_overlap` (default `1000`), `NearestNeighbor.metric_params` (default `10000`), and `NearestNeighborAdvanced.metric_params` (default `1000`).
- `n_neighbors` — in `nearest_neighbors_metrics` (no default — required positional), `nearest_neighbors_isolation` (default `5`), `nearest_neighbors_noise_overlap` (default `5`), `NearestNeighbor.metric_params` (default `5`), and `NearestNeighborAdvanced.metric_params` (default `4`). Different defaults per site.
- `radius_um` — in `nearest_neighbors_isolation` (default `100`), `nearest_neighbors_noise_overlap` (default `100`), `NearestNeighborAdvanced.metric_params` (default `100`).
- `n_components` — in `nearest_neighbors_isolation` (default `10`), `nearest_neighbors_noise_overlap` (default `10`), `NearestNeighborAdvanced.metric_params` (default `10`).
- `seed` — in `nearest_neighbors_isolation`, `nearest_neighbors_noise_overlap`, `NearestNeighborAdvanced.metric_params`, and `ComputeQualityMetrics._set_params` (all default `None`).
- `censored_period_ms` — in `compute_refrac_period_violations` (default `0.0`) and `compute_sd_ratio` (default `4.0`). Different defaults.
- `num_histogram_bins` — in the public `compute_amplitude_cutoffs` (signature default `500`, but the class-level `_default_params` for `AmplitudeCutoff` is `100`, and the private `amplitude_cutoff` helper's default is `100`).
- `histogram_smoothing_value` — in `compute_amplitude_cutoffs` (default `3`), `AmplitudeCutoff.metric_params` (default `3`), and `amplitude_cutoff` (default `3`).
- `amplitudes_bins_min_ratio` — in `compute_amplitude_cutoffs` (default `5`), `AmplitudeCutoff.metric_params` (default `5`), and `amplitude_cutoff` (default `5`).
- `high_quantile`, `low_quantile`, `n_bins` — in `compute_noise_cutoffs` and `_noise_cutoff` (identical defaults `0.25`, `0.1`, `100`).
- `min_fr` — in `nearest_neighbors_isolation` (default `0.0`), `nearest_neighbors_noise_overlap` (default `0.0`), `NearestNeighborAdvanced.metric_params` (default `0.0`).
- `min_spatial_overlap` — only in `nearest_neighbors_isolation` (default `0.5`) and `NearestNeighborAdvanced.metric_params` (default `0.5`).

Per-metric attribute names (exact spelling, verbatim):

- Per class: `metric_name`, `metric_function`, `metric_params`, `metric_columns`, `metric_descriptions`, `depend_on`, `supports_periods`, `needs_recording`, `needs_tmp_data`, `needs_job_kwargs`, `deprecated_names`.
- Per `ComputeQualityMetrics`: `extension_name`, `depend_on`, `need_recording`, `use_nodepipeline`, `need_job_kwargs`, `need_backward_compatibility_on_load`, `metric_list`.

Metric_columns keys, verbatim per class:

- `NumSpikes` → `{"num_spikes": int}`
- `FiringRate` → `{"firing_rate": float}`
- `PresenceRatio` → `{"presence_ratio": float}`
- `SNR` → `{"snr": float}`
- `ISIViolation` → `{"isi_violations_ratio": float, "isi_violations_count": int}`
- `RPViolation` → `{"rp_contamination": float, "rp_violations": int}`
- `SlidingRPViolation` → `{"sliding_rp_violation": float}`
- `Synchrony` → `{"sync_spike_2": float, "sync_spike_4": float, "sync_spike_8": float}`
- `FiringRange` → `{"firing_range": float}`
- `AmplitudeCV` → `{"amplitude_cv_median": float, "amplitude_cv_range": float}`
- `AmplitudeCutoff` → `{"amplitude_cutoff": float}`
- `NoiseCutoff` → `{"noise_cutoff": float, "noise_ratio": float}`
- `AmplitudeMedian` → `{"amplitude_median": float}`
- `Drift` → `{"drift_ptp": float, "drift_std": float, "drift_mad": float}`
- `SDRatio` → `{"sd_ratio": float}`
- `Mahalanobis` → `{"isolation_distance": float, "l_ratio": float}`
- `DPrime` → `{"d_prime": float}`
- `NearestNeighbor` → `{"nn_hit_rate": float, "nn_miss_rate": float}`
- `Silhouette` → `{"silhouette": float}`
- `NearestNeighborAdvanced` → `{"nn_isolation": float, "nn_noise_overlap": float}`

Class-level `metric_params` (aka `_default_params`) verbatim for every metric that defines one:

```python
NumSpikes.metric_params            = {}
FiringRate.metric_params           = {}
PresenceRatio.metric_params        = {"bin_duration_s": 60, "mean_fr_ratio_thresh": 0.0}
SNR.metric_params                  = {"method": "extremum"}
ISIViolation.metric_params         = {"isi_threshold_ms": 1.5, "min_isi_ms": 0}
RPViolation.metric_params          = {"refractory_period_ms": 1.0, "censored_period_ms": 0.0}
SlidingRPViolation.metric_params   = {
    "min_spikes": 0,
    "bin_size_ms": 0.25,
    "window_size_s": 1,
    "exclude_ref_period_below_ms": 0.5,
    "max_ref_period_ms": 10,
    "contamination_values": None,
}
Synchrony.metric_params            = {}   # not declared in class body
FiringRange.metric_params          = {"bin_size_s": 5, "percentiles": (5, 95)}
AmplitudeCV.metric_params          = {
    "average_num_spikes_per_bin": 50,
    "percentiles": (5, 95),
    "min_num_bins": 10,
    "amplitude_extension": "spike_amplitudes",
}
AmplitudeCutoff.metric_params      = {
    "num_histogram_bins": 100,
    "histogram_smoothing_value": 3,
    "amplitudes_bins_min_ratio": 5,
}
NoiseCutoff.metric_params          = {"high_quantile": 0.25, "low_quantile": 0.1, "n_bins": 100}
AmplitudeMedian.metric_params      = {}   # not declared in class body
Drift.metric_params                = {
    "interval_s": 60,
    "min_spikes_per_interval": 100,
    "direction": "y",
    "min_num_bins": 2,
}
SDRatio.metric_params              = {
    "censored_period_ms": 4.0,
    "correct_for_drift": True,
    "correct_for_template_itself": True,
}
Mahalanobis.metric_params          = {}
DPrime.metric_params               = {}
NearestNeighbor.metric_params      = {"max_spikes": 10000, "n_neighbors": 5}
Silhouette.metric_params           = {"method": "simplified"}
NearestNeighborAdvanced.metric_params = {
    "max_spikes": 1000,
    "min_spikes": 10,
    "min_fr": 0.0,
    "n_neighbors": 4,
    "n_components": 10,
    "radius_um": 100,
    "min_spatial_overlap": 0.5,
    "seed": None,
}
```

---

