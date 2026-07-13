# Quality Metrics — misc registry B (sliding_rp_violation .. noise_cutoff)
Source in repo: `spikeinterface/src/spikeinterface/metrics/quality/misc_metrics.py`
Parent index: [../INDEX.md](../INDEX.md)
---

### sliding_rp_violation

Class `SlidingRPViolation`, verbatim class body:

```python
class SlidingRPViolation(BaseMetric):
    metric_name = "sliding_rp_violation"
    metric_function = compute_sliding_rp_violations
    metric_params = {
        "min_spikes": 0,
        "bin_size_ms": 0.25,
        "window_size_s": 1,
        "exclude_ref_period_below_ms": 0.5,
        "max_ref_period_ms": 10,
        "contamination_values": None,
    }
    metric_columns = {"sliding_rp_violation": float}
    metric_descriptions = {
        "sliding_rp_violation": "Minimum contamination at 90% confidence using sliding refractory period method."
    }
    supports_periods = True
```

Signature (verbatim):

```python
def compute_sliding_rp_violations(
    sorting_analyzer,
    unit_ids=None,
    periods=None,
    min_spikes=0,
    bin_size_ms=0.25,
    window_size_s=1,
    exclude_ref_period_below_ms=0.5,
    max_ref_period_ms=10,
    contamination_values=None,
):
```

If `contamination_values is None` it defaults to `np.arange(0.5, 35, 0.5) / 100` (inside the private `slidingRP_violations`).

There is no user-facing "method" parameter for the sliding-RP metric — the implementation picks between the private helpers `_compute_correlograms_numba` (when `HAVE_NUMBA`) and `_compute_correlograms_numpy` (otherwise) via `method = "numba" if HAVE_NUMBA else "numpy"` *inside* `slidingRP_violations`.

No extra extensions required.

### synchrony

Class `Synchrony`, verbatim class body:

```python
class Synchrony(BaseMetric):
    metric_name = "synchrony"
    metric_function = compute_synchrony_metrics
    metric_columns = {"sync_spike_2": float, "sync_spike_4": float, "sync_spike_8": float}
    metric_descriptions = {
        "sync_spike_2": "Fraction of spikes that are synchronous with at least one other spike.",
        "sync_spike_4": "Fraction of spikes that are synchronous with at least three other spikes.",
        "sync_spike_8": "Fraction of spikes that are synchronous with at least seven other spikes.",
    }
    supports_periods = True
```

(No `metric_params = {...}` defined on the class → the effective default is `{}`.)

Signature (verbatim):

```python
def compute_synchrony_metrics(sorting_analyzer, unit_ids=None, periods=None, synchrony_sizes=None):
```

`synchrony_sizes` is deprecated and ignored — the metric always uses `synchrony_sizes = np.array([2, 4, 8])`. Returns a `namedtuple("synchrony_metrics", ["sync_spike_2", "sync_spike_4", "sync_spike_8"])`. Each value is `n_synchronous_spikes_of_size_X / n_spikes_of_unit`.

No extra extensions required.

### firing_range

Class `FiringRange`, verbatim class body:

```python
class FiringRange(BaseMetric):
    metric_name = "firing_range"
    metric_function = compute_firing_ranges
    metric_params = {"bin_size_s": 5, "percentiles": (5, 95)}
    metric_columns = {"firing_range": float}
    metric_descriptions = {
        "firing_range": "Range between the percentiles (default: 5th and 95th) of the firing rates distribution."
    }
    supports_periods = True
```

Signature (verbatim):

```python
def compute_firing_ranges(sorting_analyzer, unit_ids=None, periods=None, bin_size_s=5, percentiles=(5, 95)):
```

Definition: `percentile(fr_bins, percentiles[1]) - percentile(fr_bins, percentiles[0])`, where `fr_bins` are the per-unit firing rates over non-overlapping bins of `bin_size_s`.

No extra extensions required.

### amplitude_cv

Class `AmplitudeCV`, verbatim class body:

```python
class AmplitudeCV(BaseMetric):
    metric_name = "amplitude_cv"
    metric_function = compute_amplitude_cv_metrics
    metric_params = {
        "average_num_spikes_per_bin": 50,
        "percentiles": (5, 95),
        "min_num_bins": 10,
        "amplitude_extension": "spike_amplitudes",
    }
    metric_columns = {"amplitude_cv_median": float, "amplitude_cv_range": float}
    metric_descriptions = {
        "amplitude_cv_median": "Median of the coefficient of variation of spike amplitudes within temporal bins.",
        "amplitude_cv_range": "Range of the coefficient of variation of spike amplitudes within temporal bins.",
    }
    supports_periods = True
    depend_on = ["spike_amplitudes|amplitude_scalings"]
```

Signature (verbatim):

```python
def compute_amplitude_cv_metrics(
    sorting_analyzer,
    unit_ids=None,
    periods=None,
    average_num_spikes_per_bin=50,
    percentiles=(5, 95),
    min_num_bins=10,
    amplitude_extension="spike_amplitudes",
):
```

`amplitude_extension : "spike_amplitudes" | "amplitude_scalings"` (asserted — any other value raises `AssertionError("Invalid amplitude_extension. It can be either 'spike_amplitudes' or 'amplitude_scalings'")`).

For every unit, `bin_size_samples = (average_num_spikes_per_bin / firing_rate) * fs`; for each bin the coefficient of variation `std(amps)/|mean(amps)|` is computed. Then returns median and percentile-range of that CV distribution. NaN if fewer than `min_num_bins` valid bins.

Returns a `namedtuple("amplitude_cv", ["amplitude_cv_median", "amplitude_cv_range"])`.

Requires either `spike_amplitudes` OR `amplitude_scalings` extension.

### amplitude_cutoff

Class `AmplitudeCutoff`, verbatim class body:

```python
class AmplitudeCutoff(BaseMetric):
    metric_name = "amplitude_cutoff"
    metric_function = compute_amplitude_cutoffs
    metric_params = {
        "num_histogram_bins": 100,
        "histogram_smoothing_value": 3,
        "amplitudes_bins_min_ratio": 5,
    }
    metric_columns = {"amplitude_cutoff": float}
    metric_descriptions = {
        "amplitude_cutoff": "Estimated fraction of missing spikes, based on the amplitude distribution."
    }
    supports_periods = True
    depend_on = ["spike_amplitudes|amplitude_scalings"]
```

Signature (verbatim):

```python
def compute_amplitude_cutoffs(
    sorting_analyzer,
    unit_ids=None,
    periods=None,
    num_histogram_bins=500,
    histogram_smoothing_value=3,
    amplitudes_bins_min_ratio=5,
):
```

Default mismatch: the actual signature default for `num_histogram_bins` is `500`, but the docstring text says `num_histogram_bins : int, default: 100`, and the class-level `metric_params` used by the extension is also `100`. When calling `compute_amplitude_cutoffs` directly you get `500`; when going through `ComputeQualityMetrics` you get `100` unless overridden.

Set to NaN if `len(amplitudes) / num_histogram_bins < amplitudes_bins_min_ratio`.

Definition (Hill): estimate of the fraction of spikes missing under the assumption that the amplitude PDF (Gaussian-smoothed histogram) is symmetric.

Requires `spike_amplitudes` OR `amplitude_scalings`. Legacy `peak_sign` kwarg stripped on load.

### noise_cutoff

Class `NoiseCutoff`, verbatim class body:

```python
class NoiseCutoff(BaseMetric):
    metric_name = "noise_cutoff"
    metric_function = compute_noise_cutoffs
    metric_params = {"high_quantile": 0.25, "low_quantile": 0.1, "n_bins": 100}
    metric_columns = {"noise_cutoff": float, "noise_ratio": float}
    metric_descriptions = {
        "noise_cutoff": (
            "Estimated metric based on the amplitude distribution indicating how many standard deviations "
            "the lower-amplitude bins lie from the mean of the high-amplitude bins."
        ),
        "noise_ratio": "Ratio of counts in the lower-amplitude bins to the count in the highest bin.",
    }
    supports_periods = True
    depend_on = ["spike_amplitudes|amplitude_scalings"]
```

Signature (verbatim):

```python
def compute_noise_cutoffs(
    sorting_analyzer, unit_ids=None, periods=None, high_quantile=0.25, low_quantile=0.1, n_bins=100
):
```

IBL 2024-style noise cutoff: builds an amplitude histogram, compares low-quantile bin counts against the mean/std of upper-quantile bin counts. Returns `namedtuple("cutoff_metrics", ["noise_cutoff", "noise_ratio"])`.

No string-Literal parameters (all numeric). `high_quantile` and `low_quantile` are floats in `[0, 1]`; `n_bins` is an int.

Requires `spike_amplitudes` OR `amplitude_scalings`.

