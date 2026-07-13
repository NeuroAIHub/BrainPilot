# Quality Metrics — Per-file function signatures (verbatim)
Source in repo: `spikeinterface/src/spikeinterface/metrics/quality/`
Parent index: [../INDEX.md](../INDEX.md)
---

## Per-file function signatures (verbatim)

Every `def compute_*(...)` (and its supporting low-level helpers) in `spikeinterface/metrics/quality/`.

### `spikeinterface/metrics/quality/__init__.py`

Only import statements — no function definitions.

### `spikeinterface/metrics/quality/quality_metrics.py`

Definitions:

```python
class ComputeQualityMetrics(BaseMetricExtension):
    ...

    @classmethod
    def get_required_dependencies(cls, **params): ...

    def _handle_backward_compatibility_on_load(self): ...

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
    ): ...

    def _prepare_data(self, sorting_analyzer, unit_ids=None): ...


register_result_extension(ComputeQualityMetrics)
compute_quality_metrics = ComputeQualityMetrics.function_factory()
# Wrapper effective signature (via FuncWrapper.__call__):
def compute_quality_metrics(sorting_analyzer, load_if_exists=None, *args, **kwargs): ...


def get_quality_metric_list(): ...
def get_quality_pca_metric_list(): ...
def get_default_quality_metrics_params(metric_names=None): ...
def get_default_qm_params(metric_names=None): ...
```

There is no other `def compute_*` in this file.

### `spikeinterface/metrics/quality/misc_metrics.py`

Public `def compute_*` (verbatim):

```python
def compute_presence_ratios(
    sorting_analyzer, unit_ids=None, periods=None, bin_duration_s=60.0, mean_fr_ratio_thresh=0.0
):

def compute_snrs(sorting_analyzer, unit_ids=None, method="extremum"):

def compute_isi_violations(sorting_analyzer, unit_ids=None, periods=None, isi_threshold_ms=1.5, min_isi_ms=0):

def compute_refrac_period_violations(
    sorting_analyzer, unit_ids=None, periods=None, refractory_period_ms: float = 1.0, censored_period_ms: float = 0.0
):

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

def compute_synchrony_metrics(sorting_analyzer, unit_ids=None, periods=None, synchrony_sizes=None):

def compute_firing_ranges(sorting_analyzer, unit_ids=None, periods=None, bin_size_s=5, percentiles=(5, 95)):

def compute_amplitude_cv_metrics(
    sorting_analyzer,
    unit_ids=None,
    periods=None,
    average_num_spikes_per_bin=50,
    percentiles=(5, 95),
    min_num_bins=10,
    amplitude_extension="spike_amplitudes",
):

def compute_amplitude_cutoffs(
    sorting_analyzer,
    unit_ids=None,
    periods=None,
    num_histogram_bins=500,
    histogram_smoothing_value=3,
    amplitudes_bins_min_ratio=5,
):

def compute_amplitude_medians(sorting_analyzer, unit_ids=None, periods=None):

def compute_noise_cutoffs(
    sorting_analyzer, unit_ids=None, periods=None, high_quantile=0.25, low_quantile=0.1, n_bins=100
):

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

Utility (verbatim):

```python
def check_has_required_extensions(metric_name, sorting_analyzer):
```

Low-level scientific helpers (module level, verbatim):

```python
def presence_ratio(spike_train, bin_edges=None, num_bin_edges=None, bin_n_spikes_thres=0):

def isi_violations(spike_trains, total_duration_s, isi_threshold_s=0.0015, min_isi_s=0):

def amplitude_cutoff(
    amplitudes,
    num_histogram_bins=100,
    histogram_smoothing_value=3,
    amplitudes_bins_min_ratio=5,
):

def slidingRP_violations(
    sorting,
    duration,
    bin_size_ms=0.25,
    window_size_s=1,
    exclude_ref_period_below_ms=0.5,
    max_ref_period_ms=10,
    contamination_values=None,
    return_conf_matrix=False,
):

def _compute_rp_contamination_one_unit(
    n_v,
    n_spikes,
    total_samples,
    t_c,
    t_r,
):

def _compute_violations(obs_viol, firing_rate, spike_count, ref_period_dur, contamination_prop):

def _noise_cutoff(amps, high_quantile=0.25, low_quantile=0.1, n_bins=100):

def _get_synchrony_counts(spikes, synchrony_sizes, all_unit_ids):
```

Numba-optional helpers (only defined when `HAVE_NUMBA is True`):

```python
@numba.jit(nopython=True, nogil=True, cache=False)
def _compute_nb_violations_numba(spike_train, t_r): ...

@numba.jit(nopython=True, nogil=True, cache=False)
def _compute_rp_violations_numba(spike_train, t_c, t_r): ...
```

### `spikeinterface/metrics/quality/pca_metrics.py`

No public `def compute_*` — the metric functions are private, wired to `BaseMetric` subclasses (all verbatim):

```python
def _mahalanobis_metrics_function(sorting_analyzer, unit_ids, tmp_data, **metric_params):

def _d_prime_metric_function(sorting_analyzer, unit_ids, tmp_data, **metric_params):

def _nearest_neighbor_metric_function(sorting_analyzer, unit_ids, tmp_data, **metric_params):

def _silhouette_metric_function(sorting_analyzer, unit_ids, tmp_data, **metric_params):

def _nn_advanced_metric_function(sorting_analyzer, unit_ids, tmp_data, job_kwargs, **metric_params):
```

Per-unit worker helpers (private, verbatim):

```python
def _nn_one_unit(args):

def _nn_advanced_one_unit(args):
```

Low-level scientific functions exposed for direct use (verbatim):

```python
def mahalanobis_metrics(all_pcs, all_labels, this_unit_id):

def d_prime_metric(all_pcs, all_labels, this_unit_id) -> float:

def nearest_neighbors_metrics(all_pcs, all_labels, this_unit_id, max_spikes, n_neighbors):

def nearest_neighbors_isolation(
    sorting_analyzer,
    this_unit_id: int | str,
    n_spikes_all_units: dict = None,
    fr_all_units: dict = None,
    max_spikes: int = 1000,
    min_spikes: int = 10,
    min_fr: float = 0.0,
    n_neighbors: int = 5,
    n_components: int = 10,
    radius_um: float = 100,
    min_spatial_overlap: float = 0.5,
    seed=None,
):

def nearest_neighbors_noise_overlap(
    sorting_analyzer,
    this_unit_id: int | str,
    n_spikes_all_units: dict = None,
    fr_all_units: dict = None,
    max_spikes: int = 1000,
    min_spikes: int = 10,
    min_fr: float = 0.0,
    n_neighbors: int = 5,
    n_components: int = 10,
    radius_um: float = 100,
    seed=None,
):

def simplified_silhouette_score(all_pcs, all_labels, this_unit_id):

def silhouette_score(all_pcs, all_labels, this_unit_id):

def _subtract_clip_component(clip1, component):

def _compute_isolation(pcs_target_unit, pcs_other_unit, n_neighbors: int):
```

---

