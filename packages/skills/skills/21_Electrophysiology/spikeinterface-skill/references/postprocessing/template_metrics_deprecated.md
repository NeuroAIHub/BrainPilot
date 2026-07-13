# template_metrics — ComputeTemplateMetrics (deprecated re-export)
Source in repo: `spikeinterface/src/spikeinterface/postprocessing/template_metrics.py`
Parent index: [INDEX.md](INDEX.md)
---

## template_metrics — ComputeTemplateMetrics (deprecated re-export)

**Deprecated location**: The module `spikeinterface.postprocessing.template_metrics` re-exports `ComputeTemplateMetrics` and `compute_template_metrics` from `spikeinterface.metrics.template`, emitting a `DeprecationWarning`. Use `spikeinterface.metrics.template` (`src/spikeinterface/metrics/template/template_metrics.py`) directly for new code.

The re-exported wrappers in `postprocessing/template_metrics.py` are effectively:

```python
class ComputeTemplateMetrics(ComputeTemplateMetricsNew):
    def __init__(self, *args, **kwargs):
        warnings.warn(...)
        super().__init__(*args, **kwargs)

def compute_template_metrics(*args, **kwargs):
    warnings.warn(...)
    return compute_template_metrics_new(*args, **kwargs)
```

- extension name: `"template_metrics"`
- Compute class: `ComputeTemplateMetrics(BaseMetricExtension)` (in `spikeinterface.metrics.template`)
- depends on: `["templates"]`

Parameters (from the underlying `_set_params`):

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

- `metric_names`: list of metric names (default `None` → all single-channel metrics; if `include_multi_channel_metrics=True` or `num_channels >= 64`, multi-channel metrics are appended).
- `metric_params`: per-metric parameter overrides (dict of dicts).
- `delete_existing_metrics`: `bool`, default `False`.
- `metrics_to_compute`: subset actually to compute.
- `periods`: unused for template metrics.
- `template_operator`: `str`, default `"average"` — passed to `get_dense_templates_array`.
- `upsampling_factor`: `int`, default `10`.
- `include_multi_channel_metrics`: `bool`, default `False` (auto-enabled when `num_channels >= MIN_CHANNELS_FOR_MULTI_CHANNEL_METRICS == 64`).
- `depth_direction`: `str`, default `"y"` (used by multi-channel metrics only).
- `min_thresh_detect_peaks_troughs`: `float`, default `0.3`.
- `edge_exclusion_ms`: `float`, default `0.09`.
- `min_peak_trough_distance_ratio`: `float`, default `0.2`.
- `min_extremum_distance_samples`: `int`, default `3`.

Note: the historical global `peak_sign` argument (`"neg" | "pos"`) has been removed and is scrubbed on load by `_handle_backward_compatibility_on_load`.

### Available metric names (current implementation)

Single-channel metrics — from `single_channel_metrics` in `metrics/template/metrics.py`, in order:

- `peak_to_trough_duration`
- `half_width`
- `repolarization_slope`
- `recovery_slope`
- `number_of_peaks`
- `main_to_next_extremum_duration`
- `waveform_ratios`
- `waveform_widths`
- `waveform_baseline_flatness`

Multi-channel metrics (require dense sparsity; auto-included when `include_multi_channel_metrics=True` or when the analyzer has >= 64 channels) — from `multi_channel_metrics`:

- `velocity_fits` (yields two columns: `velocity_above`, `velocity_below`)
- `exp_decay`
- `spread`

### Legacy metric-name aliases (handled by backward compatibility)

The following older names are silently rewritten by `_handle_backward_compatibility_on_load`:

- `peak_to_valley` → `peak_to_trough_duration`
- `halfwidth` (older spelling) → `half_width`
- `peak_trough_ratio` → `waveform_ratios`
- `num_positive_peaks` / `num_negative_peaks` → `number_of_peaks`
- `velocity_above` / `velocity_below` → `velocity_fits`

Recommended usage (new location):

```python
from spikeinterface.metrics.template import (
    ComputeTemplateMetrics,
    compute_template_metrics,
    get_single_channel_template_metric_names,
    get_multi_channel_template_metric_names,
    get_template_metric_list,
)

analyzer.compute(["random_spikes", "waveforms", "templates"])
analyzer.compute(
    "template_metrics",
    metric_names=["half_width", "peak_to_trough_duration", "repolarization_slope"],
    upsampling_factor=10,
    include_multi_channel_metrics=False,
    delete_existing_metrics=False,
)

df = analyzer.get_extension("template_metrics").get_data()   # pandas.DataFrame indexed by unit_id
```

Deprecated public function (still re-exported from `spikeinterface.postprocessing`):
```python
def compute_template_metrics(*args, **kwargs):   # emits DeprecationWarning
    ...
```
