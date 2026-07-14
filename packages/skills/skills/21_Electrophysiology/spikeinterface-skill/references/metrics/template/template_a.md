# Template Metrics — Part A (exports, helpers, extension, single-channel classes)
Source in repo: `spikeinterface/src/spikeinterface/metrics/template/template_metrics.py`
Parent index: [../INDEX.md](../INDEX.md)
---

## 2. Template metrics (`metrics/template/`)

### 2.1 Public exports

From `metrics/template/__init__.py`:

```python
from .template_metrics import (
    ComputeTemplateMetrics,
    compute_template_metrics,
    get_template_metric_list,
    get_template_metric_names,
    get_single_channel_template_metric_names,
    get_multi_channel_template_metric_names,
    get_default_template_metrics_params,
    get_default_tm_params,
)
from .metrics import get_trough_and_peak_idx
```

### 2.2 Module-level helpers

Defined in `template_metrics.py`:

```python
def get_single_channel_template_metric_names():
    return [m.metric_name for m in single_channel_metrics]


def get_multi_channel_template_metric_names():
    return [m.metric_name for m in multi_channel_metrics]


def get_template_metric_list():
    return get_single_channel_template_metric_names() + get_multi_channel_template_metric_names()


def get_template_metric_names():
    import warnings

    warnings.warn(
        "get_template_metric_names is deprecated and will be removed in a version 0.105.0. "
        "Please use get_template_metric_list instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    return get_template_metric_list()


def get_default_template_metrics_params(metric_names=None):
    default_params = ComputeTemplateMetrics.get_default_metric_params()
    if metric_names is None:
        return default_params
    else:
        metric_names = list(set(metric_names) & set(default_params.keys()))
        metric_params = {m: default_params[m] for m in metric_names}
        return metric_params


def get_default_tm_params(metric_names=None):
    """
    Return default dictionary of template metrics parameters.

    Returns
    -------
    metric_params : dict
        Dictionary with default parameters for template metrics.
    """
    import warnings

    warnings.warn(
        "get_default_tm_params is deprecated and will be removed in a version 0.105.0. "
        "Please use get_default_template_metrics_params instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    return get_default_template_metrics_params(metric_names)
```

Also at module import:

```python
compute_template_metrics = ComputeTemplateMetrics.function_factory()
```

Module-level constants:

```python
MIN_SPARSE_CHANNELS_FOR_MULTI_CHANNEL_WARNING = 10
MIN_CHANNELS_FOR_MULTI_CHANNEL_METRICS = 64
```

If the analyzer has `>= MIN_CHANNELS_FOR_MULTI_CHANNEL_METRICS` (64) channels, `include_multi_channel_metrics` is automatically forced to `True` by `_set_params`.

### 2.3 `ComputeTemplateMetrics` extension

```python
class ComputeTemplateMetrics(BaseMetricExtension):
    extension_name = "template_metrics"
    depend_on = ["templates"]
    need_backward_compatibility_on_load = True
    metric_list = single_channel_metrics + multi_channel_metrics
    tmp_data_to_save = ["peaks_data", "main_channel_templates"]
```

**Required SortingAnalyzer extensions**: `templates` (i.e. `sorting_analyzer.compute("templates", ...)` must be run first). For multi-channel metrics, if the analyzer is sparse the unit sparsity mask is used to select channels.

Full `_set_params` signature (verbatim):

```python
def _set_params(
    self,
    metric_names: list[str] | None = None,
    metric_params: dict | None = None,
    delete_existing_metrics: bool = False,
    metrics_to_compute: list[str] | None = None,
    periods=None,
    # common extension kwargs
    template_operator="average",
    upsampling_factor=10,
    include_multi_channel_metrics=False,
    depth_direction="y",
    min_thresh_detect_peaks_troughs=0.3,
    edge_exclusion_ms=0.09,
    min_peak_trough_distance_ratio=0.2,
    min_extremum_distance_samples=3,
):
```

Effective call signature via `compute_template_metrics = ComputeTemplateMetrics.function_factory()`:

```python
compute_template_metrics(
    sorting_analyzer,
    metric_names=None,                    # list[str] | None; None -> all single-channel metrics (+ multi if enabled)
    metric_params=None,                   # dict of dicts, per-metric overrides
    delete_existing_metrics=False,
    metrics_to_compute=None,
    periods=None,                         # template metrics ignore periods (kept for API compatibility)
    template_operator="average",          # which template operator to fetch via get_dense_templates_array
    upsampling_factor=10,                 # int; if >1 templates are upsampled with scipy.signal.resample_poly
    include_multi_channel_metrics=False,  # bool; auto-forced True when num_channels >= 64
    depth_direction="y",                  # str (source has no annotation); multi-channel `get_*` docstrings say "x", "y", or "z" (code uses `depth_dim = 1 if depth_direction == "y" else 0`, so any non-"y" behaves like x)
    min_thresh_detect_peaks_troughs=0.3,  # float; prominence threshold as fraction of |template|.max()
    edge_exclusion_ms=0.09,               # float; ms excluded from both edges during peak/trough detection
    min_peak_trough_distance_ratio=0.2,   # float; min peak-trough distance as fraction of trough half-width
    min_extremum_distance_samples=3,      # int; hard minimum sample distance between extrema and edges
    **job_kwargs,
)
```

Notes from the docstring / source:
- `metric_names` — if `None`, all single-channel metrics are used; if `include_multi_channel_metrics=True`, multi-channel metric names are appended.
- `metric_params` — dict of dicts. Get defaults via `si.metrics.template_metrics.get_default_template_metrics_params()`.
- If any multi-channel metric is in `metric_names` **or** `include_multi_channel_metrics=True`, sparsity must be `None` so that one metric value per unit is computed.
- 3D channel locations are not supported for multi-channel metrics; when detected the first two dimensions are used (with a warning).
- `peak_sign` is **no longer** an argument. The legacy `peak_sign` parameter is removed on load by `_handle_backward_compatibility_on_load`.
- Backward-compatibility renamings performed on load (`_handle_backward_compatibility_on_load`):
  - `num_positive_peaks`, `num_negative_peaks` -> `number_of_peaks`
  - `velocity_above`, `velocity_below` -> `velocity_fits` (with `min_channels_for_velocity` -> `min_channels`, `min_r2_velocity` -> `min_r2`)
  - `exp_decay` params: `exp_peak_function` -> `peak_function`, `min_r2_exp_decay` -> `min_r2`
  - `peak_to_valley` -> `peak_to_trough_duration`
  - `peak_trough_ratio` -> `waveform_ratios` (new implementation uses absolute peak values)
  - `depth_direction` defaults to `"y"` if missing
  - `metrics_kwargs` -> per-metric `metric_params`

Returns: `pd.DataFrame` with one row per unit and one or more columns per metric (columns listed in each metric class below).

`_prepare_data` builds `tmp_data` with keys:
- `sampling_frequency` (upsampled: `upsampling_factor * sampling_frequency` when `upsampling_factor > 1`, else `sampling_frequency`)
- `peaks_info` (list of dicts from `get_trough_and_peak_idx`, one per unit)
- `main_channel_templates` (`np.ndarray`, one row per unit; upsampled with `scipy.signal.resample_poly` if `upsampling_factor > 1`)
- When multi-channel metrics are enabled: `multi_channel_templates` (list of 2D arrays), `channel_locations_multi` (list of 2D arrays), `depth_direction` (`"y"` by default).

It also builds `peaks_data` as a `pd.DataFrame` indexed by `unit_ids` with columns:

```python
[f"{k}_{suffix}" for k in ("trough", "peak_before", "peak_after")
                 for suffix in ("index", "width_left", "width_right",
                                "half_width_left", "half_width_right")]
```

### 2.4 Single-channel template metric classes

All are `BaseMetric` subclasses with `needs_tmp_data = True`, populated from `tmp_data["peaks_info"]`, `tmp_data["main_channel_templates"]`, `tmp_data["sampling_frequency"]`. Registered list:

```python
single_channel_metrics = [
    PeakToTroughDuration,
    HalfWidth,
    RepolarizationSlope,
    RecoverySlope,
    NumberOfPeaks,
    MainToNextExtremumDuration,
    WaveformRatios,
    WaveformWidths,
    WaveformBaselineFlatness,
]
```

So `get_single_channel_template_metric_names()` returns exactly:
`["peak_to_trough_duration", "half_width", "repolarization_slope", "recovery_slope", "number_of_peaks", "main_to_next_extremum_duration", "waveform_ratios", "waveform_widths", "waveform_baseline_flatness"]`

#### `PeakToTroughDuration`
- `metric_name = "peak_to_trough_duration"`
- `metric_params = {}`
- `metric_columns = {"peak_to_trough_duration": float}`
- `metric_descriptions = {"peak_to_trough_duration": "Duration in seconds between the trough (minimum) and the next peak (maximum) of the template."}`
- `needs_tmp_data = True`
- `deprecated_names = ["peak_to_valley"]`
- Underlying function: `get_peak_to_trough_duration(peaks_info, sampling_frequency, **metric_params)`

#### `HalfWidth`
- `metric_name = "half_width"`
- `metric_params = {}`
- `metric_columns = {"trough_half_width": float, "peak_half_width": float}`
- `metric_descriptions`:
  - `"trough_half_width": "Duration in s at half the amplitude of the trough (minimum) of the template."`
  - `"peak_half_width": "Duration in s at half the amplitude of the peak (maximum) of the template."`
- `needs_tmp_data = True`
- Returns a namedtuple `HalfWidthResult(trough_half_width, peak_half_width)`.
- Underlying function: `get_half_widths(main_channel_template, sampling_frequency, peaks_info, **metric_params)`

#### `RepolarizationSlope`
- `metric_name = "repolarization_slope"`
- `metric_params = {}`
- `metric_columns = {"repolarization_slope": float}`
- `metric_descriptions = {"repolarization_slope": "Slope of the repolarization phase of the template, between the trough (minimum) and return to baseline in µV/s."}`
- `needs_tmp_data = True`
- Underlying function: `get_repolarization_slope(main_channel_template, sampling_frequency, peaks_info, **metric_params)`

#### `RecoverySlope`
- `metric_name = "recovery_slope"`
- `metric_params = {"recovery_window_ms": 0.7}`
- `metric_columns = {"recovery_slope": float}`
- `metric_descriptions = {"recovery_slope": "Slope of the recovery phase of the template, after the peak (maximum) returning to baseline in µV/s."}`
- `needs_tmp_data = True`
- Underlying function: `get_recovery_slope(main_channel_template, sampling_frequency, peaks_info, **metric_params)` — requires `recovery_window_ms` kwarg.

#### `NumberOfPeaks`
- `metric_name = "number_of_peaks"`
- `metric_params = {}`
- `metric_columns = {"num_positive_peaks": int, "num_negative_peaks": int}`
- `metric_descriptions`:
  - `"num_positive_peaks": "Number of positive peaks in the template"`
  - `"num_negative_peaks": "Number of negative peaks (troughs) in the template"`
- `needs_tmp_data = True`
- Returns a namedtuple `NumberOfPeaksResult(num_positive_peaks, num_negative_peaks)`.
- Underlying function: `get_number_of_peaks(peaks_info, **metric_params)` — legacy top-level names `num_positive_peaks` / `num_negative_peaks` from earlier releases are auto-merged into `number_of_peaks` on load.

#### `MainToNextExtremumDuration`
- `metric_name = "main_to_next_extremum_duration"`
- `metric_params = {}`
- `metric_columns = {"main_to_next_extremum_duration": float}`
- `metric_descriptions = {"main_to_next_extremum_duration": "Duration in seconds from main extremum to next extremum."}`
- `needs_tmp_data = True`
- Underlying function: `get_main_to_next_extremum_duration(main_channel_template, peaks_info, sampling_frequency, **metric_params)`

#### `WaveformRatios`
- `metric_name = "waveform_ratios"`
- `metric_params = {}`
- `metric_columns = {"peak_before_to_trough_ratio": float, "peak_after_to_trough_ratio": float, "peak_before_to_peak_after_ratio": float, "main_peak_to_trough_ratio": float}`
- `metric_descriptions`:
  - `"peak_before_to_trough_ratio": "Ratio of peak before amplitude to trough amplitude"`
  - `"peak_after_to_trough_ratio": "Ratio of peak after amplitude to trough amplitude"`
  - `"peak_before_to_peak_after_ratio": "Ratio of peak before amplitude to peak after amplitude"`
  - `"main_peak_to_trough_ratio": "Ratio of main peak amplitude to trough amplitude"`
- `needs_tmp_data = True`
- `deprecated_names = ["peak_trough_ratio"]`
- Returns a namedtuple `WaveformRatiosResult(peak_before_to_trough_ratio, peak_after_to_trough_ratio, peak_before_to_peak_after_ratio, main_peak_to_trough_ratio)`.
- Underlying function: `get_waveform_ratios(main_channel_template, peaks_info, **metric_params)`

#### `WaveformWidths`
- `metric_name = "waveform_widths"`
- `metric_params = {}`
- `metric_columns = {"trough_width": float, "peak_before_width": float, "peak_after_width": float}`
- `metric_descriptions`:
  - `"trough_width": "Width of the main trough in seconds"`
  - `"peak_before_width": "Width of the main peak before trough in seconds"`
  - `"peak_after_width": "Width of the main peak after trough in seconds"`
- `needs_tmp_data = True`
- Returns a namedtuple `WaveformWidthsResult(trough_width, peak_before_width, peak_after_width)`.
- Underlying function: `get_waveform_widths(peaks_info, sampling_frequency, **metric_params)`

#### `WaveformBaselineFlatness`
- `metric_name = "waveform_baseline_flatness"`
- `metric_params = {"baseline_window_ms": (0.0, 0.5)}`  # tuple of (start_ms, end_ms)
- `metric_columns = {"waveform_baseline_flatness": float}`
- `metric_descriptions = {"waveform_baseline_flatness": "Ratio of max baseline amplitude to max waveform amplitude. Lower = flatter baseline."}`
- `needs_tmp_data = True`
- `deprecated_names = ["num_positive_peaks", "num_negative_peaks"]`  # verbatim from source (see `_handle_backward_compatibility_on_load` for actual auto-merge target — those are removed and `number_of_peaks` is appended, not `waveform_baseline_flatness`)
- Underlying function: `get_waveform_baseline_flatness(main_channel_template, sampling_frequency, **metric_params)`

