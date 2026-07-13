# Spike-train metrics (`metrics/spiketrain/`)
Source in repo: `spikeinterface/src/spikeinterface/metrics/spiketrain/`
Parent index: [INDEX.md](INDEX.md)
---

## 1. Spike-train metrics (`metrics/spiketrain/`)

### 1.1 Public exports

From `metrics/spiketrain/__init__.py`:

```python
from .spiketrain_metrics import (
    ComputeSpikeTrainMetrics,
    compute_spiketrain_metrics,
    get_default_spiketrain_metrics_params,
    get_spiketrain_metric_list,
)

from .metrics import compute_firing_rates, compute_num_spikes
```

**Exported names**:
- `ComputeSpikeTrainMetrics` — the extension class (registered on `SortingAnalyzer` under `extension_name="spiketrain_metrics"`).
- `compute_spiketrain_metrics(sorting_analyzer, ...)` — function wrapper produced by `ComputeSpikeTrainMetrics.function_factory()`; equivalent to `sorting_analyzer.compute("spiketrain_metrics", ...)` and returns the metrics `pd.DataFrame`.
- `get_default_spiketrain_metrics_params(metric_names=None)` — returns default per-metric parameter dict.
- `get_spiketrain_metric_list()` — returns `[m.metric_name for m in spiketrain_metrics]`, currently `["num_spikes", "firing_rate"]`.
- `compute_num_spikes(...)`, `compute_firing_rates(...)` — direct per-metric functions.

### 1.2 `ComputeSpikeTrainMetrics` extension

Location: `spiketrain/spiketrain_metrics.py`.

```python
class ComputeSpikeTrainMetrics(BaseMetricExtension):
    extension_name = "spiketrain_metrics"
    depend_on = []
    need_backward_compatibility_on_load = True
    metric_list = spiketrain_metrics   # [NumSpikes, FiringRate]
```

`ComputeSpikeTrainMetrics` does **not** override `_set_params`, so it uses the base implementation from `core.analyzer_extension_core.BaseMetricExtension._set_params`:

```python
def _set_params(
    self,
    metric_names: list[str] | None = None,
    metric_params: dict | None = None,
    delete_existing_metrics: bool = False,
    metrics_to_compute: list[str] | None = None,
    periods: np.ndarray | None = None,
    **other_params,
)
```

Effective call signature via `compute_spiketrain_metrics = ComputeSpikeTrainMetrics.function_factory()`:

```python
compute_spiketrain_metrics(
    sorting_analyzer,
    metric_names=None,           # list[str] | None; None -> all metrics in metric_list
    metric_params=None,          # dict of dicts; per-metric overrides. Defaults from get_default_spiketrain_metrics_params()
    delete_existing_metrics=False,
    metrics_to_compute=None,
    periods=None,                # np.ndarray of unit_period_dtype
    **job_kwargs,
)
```

Docstring notes:
- `metric_names` — list of metrics to compute (docstring text refers to a non-existent `si.metrics.get_spiketrain_metric_names()`; the real function is `get_spiketrain_metric_list()`).
- `metric_params` — dict of dicts; get defaults via `si.metrics.get_default_spiketrain_metrics_params()`.
- If `delete_existing_metrics=False`, previously computed metrics not in `metric_names` are kept as long as `metric_params` are unchanged.
- Class docstring lists intended metrics (`num_spikes`, `firing_rate`) and TODOs for ACG/ISI and burst metrics.
- Extension returns a `pd.DataFrame` with one row per unit and columns per metric.

**Required SortingAnalyzer extensions**: none (`depend_on = []`). Only the underlying `sorting` object is used; unit period filtering uses `sorting.select_periods(periods)`.

### 1.3 Module-level helpers

```python
def get_spiketrain_metric_list():
    return [m.metric_name for m in spiketrain_metrics]


def get_default_spiketrain_metrics_params(metric_names=None):
    default_params = ComputeSpikeTrainMetrics.get_default_metric_params()
    if metric_names is None:
        return default_params
    else:
        metric_names = list(set(metric_names) & set(default_params.keys()))
        metric_params = {m: default_params[m] for m in metric_names}
        return metric_params
```

Also, at module import:

```python
compute_spiketrain_metrics = ComputeSpikeTrainMetrics.function_factory()
```

### 1.4 Metric functions and metric classes

Both metrics are defined in `spiketrain/metrics.py`. Both accept a `periods` array of `unit_period_dtype` (from `spikeinterface.core.base`) and both metric classes have `supports_periods = True`.

#### `compute_num_spikes`

```python
def compute_num_spikes(sorting_analyzer, unit_ids=None, periods=None):
    """
    Compute the number of spike across segments.

    Parameters
    ----------
    sorting_analyzer : SortingAnalyzer
        A SortingAnalyzer object.
    unit_ids : list or None
        The list of unit ids to compute the number of spikes. If None, all units are used.
    periods : array of unit_period_dtype, default: None
        Periods to consider for each unit.

    Returns
    -------
    num_spikes : dict
        The number of spikes, across all segments, for each unit ID.
    """
```

Wrapped by:

```python
class NumSpikes(BaseMetric):
    metric_name = "num_spikes"
    metric_function = compute_num_spikes
    metric_params = {}
    metric_descriptions = {"num_spikes": "Total number of spikes for each unit across all segments."}
    metric_columns = {"num_spikes": int}
    supports_periods = True
```

Meaning: total number of spikes per unit (across all segments; optionally restricted to `periods`). Column: `num_spikes` (int). Required extension: none.

#### `compute_firing_rates`

```python
def compute_firing_rates(sorting_analyzer, unit_ids=None, periods=None):
    """
    Compute the firing rate across segments.

    Parameters
    ----------
    sorting_analyzer : SortingAnalyzer
        A SortingAnalyzer object.
    unit_ids : list or None
        The list of unit ids to compute the firing rate. If None, all units are used.
    periods : array of unit_period_dtype, default: None
        Periods to consider for each unit.

    Returns
    -------
    firing_rates : dict of floats
        The firing rate, across all segments, for each unit ID.
    """
```

Wrapped by:

```python
class FiringRate(BaseMetric):
    metric_name = "firing_rate"
    metric_function = compute_firing_rates
    metric_params = {}
    metric_descriptions = {"firing_rate": "Firing rate (spikes per second) for each unit across all segments."}
    metric_columns = {"firing_rate": float}
    supports_periods = True
```

Meaning: total spike count divided by total recording duration (per unit). Returns `np.nan` when `num_spikes[unit_id] == 0`. Column: `firing_rate` (float, Hz). Required extension: none.

#### Registered list

```python
spiketrain_metrics = [NumSpikes, FiringRate]
```

So `get_spiketrain_metric_list()` returns exactly `["num_spikes", "firing_rate"]`. (ACG/ISI/burst metrics are marked as TODO in the source; no synchrony/ISI computation is present in this subpackage as of the current source — those live under `metrics/quality/misc_metrics.py`.)

---

