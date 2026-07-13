# Quality Metrics — misc registry A (num_spikes .. rp_violation)
Source in repo: `spikeinterface/src/spikeinterface/metrics/quality/misc_metrics.py`
Parent index: [../INDEX.md](../INDEX.md)
---

## Metric registry — misc (spike-train + waveform based)

The list `misc_metrics_list` in `misc_metrics.py` (verbatim):

```python
misc_metrics_list = [
    NumSpikes,
    FiringRate,
    PresenceRatio,
    SNR,
    ISIViolation,
    RPViolation,
    SlidingRPViolation,
    Synchrony,
    FiringRange,
    AmplitudeCV,
    AmplitudeCutoff,
    NoiseCutoff,
    AmplitudeMedian,
    Drift,
    SDRatio,
]
```

For every metric below, the signature copied verbatim is the compute function used as `metric_function` in its `BaseMetric` subclass. `_default_params` shown is the class-level `metric_params` dict (verbatim). `depend_on` lists required `SortingAnalyzer` extensions (a `"a|b"` entry means either extension is sufficient).

### num_spikes

Class `NumSpikes` (from `spiketrain/metrics.py`), verbatim class body:

```python
class NumSpikes(BaseMetric):
    metric_name = "num_spikes"
    metric_function = compute_num_spikes
    metric_params = {}
    metric_descriptions = {"num_spikes": "Total number of spikes for each unit across all segments."}
    metric_columns = {"num_spikes": int}
    supports_periods = True
```

Signature (verbatim):

```python
def compute_num_spikes(sorting_analyzer, unit_ids=None, periods=None):
```

Definition: total number of spikes per unit across all segments (`sorting.count_num_spikes_per_unit`).

No extra extensions required.

### firing_rate

Class `FiringRate` (from `spiketrain/metrics.py`), verbatim class body:

```python
class FiringRate(BaseMetric):
    metric_name = "firing_rate"
    metric_function = compute_firing_rates
    metric_params = {}
    metric_descriptions = {"firing_rate": "Firing rate (spikes per second) for each unit across all segments."}
    metric_columns = {"firing_rate": float}
    supports_periods = True
```

Signature (verbatim):

```python
def compute_firing_rates(sorting_analyzer, unit_ids=None, periods=None):
```

Formula: `firing_rate = num_spikes / total_duration_s` (returns NaN for a unit with zero spikes).

No extra extensions required.

### presence_ratio

Class `PresenceRatio`, verbatim class body:

```python
class PresenceRatio(BaseMetric):
    metric_name = "presence_ratio"
    metric_function = compute_presence_ratios
    metric_params = {"bin_duration_s": 60, "mean_fr_ratio_thresh": 0.0}
    metric_columns = {"presence_ratio": float}
    metric_descriptions = {"presence_ratio": "Fraction of time the unit is active."}
    supports_periods = True
```

Signature (verbatim):

```python
def compute_presence_ratios(
    sorting_analyzer, unit_ids=None, periods=None, bin_duration_s=60.0, mean_fr_ratio_thresh=0.0
):
```

Definition: fraction of `bin_duration_s`-wide bins whose spike count strictly exceeds `floor(unit_fr * bin_duration_s * mean_fr_ratio_thresh)`. If the total recording is shorter than one bin the ratio is NaN.

No extra extensions required.

### snr

Class `SNR`, verbatim class body:

```python
class SNR(BaseMetric):
    metric_name = "snr"
    metric_function = compute_snrs
    metric_params = {"method": "extremum"}
    metric_columns = {"snr": float}
    metric_descriptions = {"snr": "Signal to noise ratio for each unit."}
    depend_on = ["noise_levels", "templates"]
```

Signature (verbatim):

```python
def compute_snrs(sorting_analyzer, unit_ids=None, method="extremum"):
```

Parameter `method : "extremum" | "at_index" | "peak_to_peak"` (formerly `peak_mode`):
- `"extremum"` — abs of the extremal value on the peak channel.
- `"at_index"` — template value at `t = sorting_analyzer.nbefore`.
- `"peak_to_peak"` — max minus min of the template.

The docstring also mentions an unused `operator : "median" | "average", default: "median"` documentation slot describing the operator applied when retrieving templates — this is *not* actually a function parameter, but is enumerated here because it appears in the docstring.

Formula: `|amplitude_on_main_channel| / noise_level_on_main_channel`.

Requires extensions `noise_levels` and `templates`.

Note: the old `peak_sign` kwarg was removed. If present in stored params it is stripped by the backward-compat loader.

### isi_violation

Class `ISIViolation`, verbatim class body:

```python
class ISIViolation(BaseMetric):
    metric_name = "isi_violation"
    metric_function = compute_isi_violations
    metric_params = {"isi_threshold_ms": 1.5, "min_isi_ms": 0}
    metric_columns = {"isi_violations_ratio": float, "isi_violations_count": int}
    metric_descriptions = {
        "isi_violations_ratio": "Ratio of ISI violations for each unit.",
        "isi_violations_count": "Count of ISI violations for each unit.",
    }
    supports_periods = True
```

Signature (verbatim):

```python
def compute_isi_violations(sorting_analyzer, unit_ids=None, periods=None, isi_threshold_ms=1.5, min_isi_ms=0):
```

Returns a `namedtuple("isi_violation", ["isi_violations_ratio", "isi_violations_count"])`. `isi_violations_ratio` is the Hill/UMS contamination ratio; `isi_violations_count` counts spikes whose ISI < `isi_threshold_ms`.

No extra extensions required.

### rp_violation

Class `RPViolation`, verbatim class body:

```python
class RPViolation(BaseMetric):
    metric_name = "rp_violation"
    metric_function = compute_refrac_period_violations
    metric_params = {"refractory_period_ms": 1.0, "censored_period_ms": 0.0}
    metric_columns = {"rp_contamination": float, "rp_violations": int}
    metric_descriptions = {
        "rp_contamination": "Refractory period contamination described in Llobet & Wyngaard 2022.",
        "rp_violations": "Number of refractory period violations.",
    }
    supports_periods = True
```

Signature (verbatim):

```python
def compute_refrac_period_violations(
    sorting_analyzer, unit_ids=None, periods=None, refractory_period_ms: float = 1.0, censored_period_ms: float = 0.0
):
```

Definition: counts refractory-period violations (Llobet & Wyngaard 2022) and returns `rp_contamination` — `1 - sqrt(1 - n_v * (T - 2*n*t_c) / (n^2 * (t_r - t_c)))`. Requires `numba`; otherwise falls back to NaN.

Returns a `namedtuple("rp_violations", ["rp_contamination", "rp_violations"])`.

No extra `SortingAnalyzer` extensions required. Requires the optional `numba` package.

