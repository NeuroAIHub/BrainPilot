# Quality Metrics — misc registry C (amplitude_median .. sd_ratio)
Source in repo: `spikeinterface/src/spikeinterface/metrics/quality/misc_metrics.py`
Parent index: [../INDEX.md](../INDEX.md)
---

### amplitude_median

Class `AmplitudeMedian`, verbatim class body:

```python
class AmplitudeMedian(BaseMetric):
    metric_name = "amplitude_median"
    metric_function = compute_amplitude_medians
    metric_columns = {"amplitude_median": float}
    metric_descriptions = {"amplitude_median": "Median of the amplitude distributions for each unit in µV."}
    supports_periods = True
    depend_on = ["spike_amplitudes"]
```

(No `metric_params = {...}` defined on the class → the effective default is `{}`.)

Signature (verbatim):

```python
def compute_amplitude_medians(sorting_analyzer, unit_ids=None, periods=None):
```

Definition: `np.median(amplitudes)` per unit, from the `spike_amplitudes` extension. Legacy `peak_sign` kwarg stripped on load.

Requires `spike_amplitudes` (this metric is **stricter** than `amplitude_cutoff`/`noise_cutoff` — it does not accept `amplitude_scalings` as a fallback).

### drift

Class `Drift`, verbatim class body:

```python
class Drift(BaseMetric):
    metric_name = "drift"
    metric_function = compute_drift_metrics
    metric_params = {
        "interval_s": 60,
        "min_spikes_per_interval": 100,
        "direction": "y",
        "min_num_bins": 2,
    }
    metric_columns = {"drift_ptp": float, "drift_std": float, "drift_mad": float}
    metric_descriptions = {
        "drift_ptp": "Peak-to-peak of the drift signal in µm.",
        "drift_std": "Standard deviation of the drift signal in µm.",
        "drift_mad": "Median absolute deviation of the drift signal in µm.",
    }
    supports_periods = True
    depend_on = ["spike_locations"]
```

Signature (verbatim):

```python
def compute_drift_metrics(
    sorting_analyzer,
    unit_ids=None,
    periods=None,
    interval_s=60,
    min_spikes_per_interval=100,
    direction="y",
    min_fraction_valid_intervals=0.5,
    min_num_bins=2,
    return_positions=False,
):
```

Parameter `direction : "x" | "y" | "z"` (checked against `spike_locations` dtype names — asserted with the message `f"Direction {direction} is invalid. Available directions: {data.dtype.names}"`).

Note: `min_fraction_valid_intervals` and `return_positions` are **not** in `_default_params` and thus are only exposed when calling `compute_drift_metrics` directly.

Returns a `namedtuple("drift_metrics", ["drift_ptp", "drift_std", "drift_mad"])` — or a tuple `(namedtuple, median_positions)` when `return_positions=True`.

Requires `spike_locations`.

### sd_ratio

Class `SDRatio`, verbatim class body:

```python
class SDRatio(BaseMetric):
    metric_name = "sd_ratio"
    metric_function = compute_sd_ratio
    metric_params = {
        "censored_period_ms": 4.0,
        "correct_for_drift": True,
        "correct_for_template_itself": True,
    }
    metric_columns = {"sd_ratio": float}
    metric_descriptions = {
        "sd_ratio": "Ratio between the standard deviation of spike amplitudes and the standard deviation of noise."
    }
    needs_recording = True
    supports_periods = True
    depend_on = ["templates", "spike_amplitudes"]
```

Signature (verbatim):

```python
def compute_sd_ratio(
    sorting_analyzer: SortingAnalyzer,
    unit_ids=None,
    periods=None,
    censored_period_ms: float = 4.0,
    correct_for_drift: bool = True,
    correct_for_template_itself: bool = True,
    **job_kwargs,
):
```

Definition: `std(unit_amplitudes) / std(noise_on_best_channel)`. If `correct_for_drift`, uses `std(diff(amps))/sqrt(2)`. If `correct_for_template_itself`, subtracts the template's contribution to the trace variance. Returns NaN if `numba` is missing or the analyzer is recordless. Note: the legacy top-level `unit_ids` param is passed via the wrapper; `peak_sign` was removed.

Internally calls `find_duplicated_spikes(..., method="keep_first_iterative")` to build a censored index (this `method` value is hard-coded — no exposed Literal parameter).

Also internally calls `get_noise_levels(recording, return_in_uV=..., method="std", **job_kwargs)`. The `method="std"` argument is hard-coded — not user-controllable.

Requires `templates` and `spike_amplitudes` extensions + a recording attached (`needs_recording = True`). Requires the optional `numba` package. Any `**job_kwargs` are forwarded to `get_noise_levels`; `job_kwargs["progress_bar"] = False` is force-set before that call.

---

