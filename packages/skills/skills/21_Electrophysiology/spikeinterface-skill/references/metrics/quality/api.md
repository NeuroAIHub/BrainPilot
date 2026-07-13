# Quality Metrics — Public API
Source in repo: `spikeinterface/src/spikeinterface/metrics/quality/quality_metrics.py`
Parent index: [../INDEX.md](../INDEX.md)
---

### ComputeQualityMetrics extension

Defined in `spikeinterface/metrics/quality/quality_metrics.py`. Class body attributes (verbatim):

```python
class ComputeQualityMetrics(BaseMetricExtension):
    """
    Compute quality metrics on a `sorting_analyzer`.

    Parameters
    ----------
    sorting_analyzer : SortingAnalyzer
        A SortingAnalyzer object.
    metric_names : list or None
        List of quality metrics to compute.
    metric_params : dict of dicts or None
        Dictionary with parameters for quality metrics calculation.
        Default parameters can be obtained with: `si.qualitymetrics.get_default_quality_metrics_params()`
    skip_pc_metrics : bool, default: False
        If True, PC metrics computation is skipped.
    delete_existing_metrics : bool, default: False
        If True, any quality metrics attached to the `sorting_analyzer` are deleted. If False, any metrics which were previously calculated but are not included in `metric_names` are kept.

    Returns
    -------
    metrics: pandas.DataFrame
        Data frame with the computed metrics.

    Notes
    -----
    principal_components are loaded automatically if already computed.
    """

    extension_name = "quality_metrics"
    depend_on = []
    need_recording = False
    use_nodepipeline = False
    need_job_kwargs = True
    need_backward_compatibility_on_load = True
    metric_list = misc_metrics_list + pca_metrics_list
```

Class-level `_set_params` (verbatim):

```python
def _set_params(
    self,
    metric_names: list[str] | None = None,
    metric_params: dict | None = None,
    delete_existing_metrics: bool = False,
    metrics_to_compute: list[str] | None = None,
    use_valid_periods=False,
    periods=None,
    # common extension kwargs
    seed=None,
    skip_pc_metrics=False,
):
```

`get_required_dependencies` (verbatim):

```python
@classmethod
def get_required_dependencies(cls, **params):
    if params.get("use_valid_periods", False):
        return ["valid_unit_periods"]
    else:
        return []
```

Behaviour of `_set_params`:
- If `metric_names is None`, `metric_names = [m.metric_name for m in self.metric_list]` and then `nn_advanced` is removed (too slow to be a default).
- If `skip_pc_metrics=True`, every metric name that belongs to `pca_metrics_list` is filtered out.
- If `use_valid_periods=True`, the extension pulls `valid_periods` from the `valid_unit_periods` extension; if a `periods` argument is also provided and does not equal `valid_periods` (cast via `cast_periods_to_unit_period_dtype`), `ValueError("Provided periods do not match valid periods from the sorting analyzer.")` is raised.

### compute_quality_metrics

Created at the bottom of `quality_metrics.py`:

```python
register_result_extension(ComputeQualityMetrics)
compute_quality_metrics = ComputeQualityMetrics.function_factory()
```

`function_factory()` (from `core/sortinganalyzer.py`) returns a callable `FuncWrapper` whose call signature is:

```python
def __call__(self, sorting_analyzer, load_if_exists=None, *args, **kwargs):
```

The `*args, **kwargs` are forwarded to `sorting_analyzer.compute("quality_metrics", ...)`, which ultimately calls `_set_params(...)`. So the practical user-facing signature is:

```python
compute_quality_metrics(
    sorting_analyzer,
    load_if_exists=None,        # deprecated, warns and returns cached extension when True
    metric_names=None,
    metric_params=None,
    delete_existing_metrics=False,
    metrics_to_compute=None,
    use_valid_periods=False,
    periods=None,
    seed=None,
    skip_pc_metrics=False,
    **job_kwargs,               # forwarded (need_job_kwargs = True)
)
```

Notes:
- The historical `qm_params=...` kwarg is renamed to `metric_params` on load via `_handle_backward_compatibility_on_load`.
- `peak_sign` used to be a top-level kwarg; it is stripped from `self.params` and from `snr`, `sd_ratio`, `nn_isolation`, `nn_noise_overlap`, `nn_advanced`, `amplitude_cutoff`, `amplitude_median` on load. `snr`'s legacy `peak_mode` is renamed to `method`.
- Legacy names `isolation_distance` and `l_ratio` are transparently mapped to the merged `mahalanobis` metric on load.

Return value: `ext.get_data()` — a `pandas.DataFrame`.

### get_quality_metric_list / get_quality_pca_metric_list

Verbatim from `quality_metrics.py`:

```python
def get_quality_metric_list():
    """
    Return a list of the available quality metrics.
    """

    return [m.metric_name for m in ComputeQualityMetrics.metric_list]


def get_quality_pca_metric_list():
    """
    Return a list of the available quality PCA metrics.
    """

    return [m.metric_name for m in pca_metrics_list]
```

Concretely:

```
get_quality_metric_list() -> [
    "num_spikes", "firing_rate", "presence_ratio", "snr",
    "isi_violation", "rp_violation", "sliding_rp_violation",
    "synchrony", "firing_range", "amplitude_cv",
    "amplitude_cutoff", "noise_cutoff", "amplitude_median",
    "drift", "sd_ratio",
    "mahalanobis", "d_prime", "nearest_neighbor",
    "silhouette", "nn_advanced",
]

get_quality_pca_metric_list() -> [
    "mahalanobis", "d_prime", "nearest_neighbor",
    "silhouette", "nn_advanced",
]
```

### get_default_quality_metrics_params / get_default_qm_params

Verbatim from `quality_metrics.py`:

```python
def get_default_quality_metrics_params(metric_names=None):
    """
    Return default dictionary of quality metrics parameters.

    Returns
    -------
    dict
        Default qm parameters with metric name as key and parameter dictionary as values.
    """
    default_params = ComputeQualityMetrics.get_default_metric_params()
    if metric_names is None:
        return default_params
    else:
        metric_names = list(set(metric_names) & set(default_params.keys()))
        metric_params = {m: default_params[m] for m in metric_names}
        return metric_params


def get_default_qm_params(metric_names=None):
    warnings.warn(
        "`get_default_qm_params` is deprecated and will be removed in a version 0.105.0. "
        "Please use `get_default_quality_metrics_params` instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    return get_default_quality_metrics_params(metric_names=metric_names)
```

`ComputeQualityMetrics.get_default_metric_params()` returns
`{m.metric_name: m.metric_params for m in cls.metric_list}`.

### Per-metric public compute_* functions
