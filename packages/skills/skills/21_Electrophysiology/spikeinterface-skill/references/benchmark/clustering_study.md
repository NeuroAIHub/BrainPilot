# ClusteringStudy

Source in repo: `spikeinterface/src/spikeinterface/benchmark/benchmark_clustering.py`
Parent index: [INDEX.md](INDEX.md)
---

## ClusteringStudy

Located in `benchmark_clustering.py`.

### `ClusteringBenchmark`

```python
class ClusteringBenchmark(Benchmark):
    def __init__(self, recording, gt_sorting, params, indices, peaks, exhaustive_gt=True):
        ...
        self.method = params["method"]
        self.method_kwargs = params["method_kwargs"]

    def run(self, verbose=True, **job_kwargs):
        labels, peak_labels = find_clusters_from_peaks(
            self.recording, self.peaks,
            method=self.method, method_kwargs=self.method_kwargs,
            verbose=verbose, job_kwargs=job_kwargs,
        )
        self.result["peak_labels"] = peak_labels

    def compute_result(self, with_template=False, **job_kwargs):
        # optionally builds `sliced_gt_templates` and `clustering_templates`
        ...

    _run_key_saved = [("peak_labels", "npy")]
    _result_key_saved = [
        ("gt_comparison", "pickle"),
        ("sliced_gt_sorting", "sorting"),
        ("clustering", "sorting"),
        ("sliced_gt_templates", "zarr_templates"),
        ("clustering_templates", "zarr_templates"),
    ]
```

`params["method"]` is any string accepted by `spikeinterface.sortingcomponents.clustering.find_clusters_from_peaks`, e.g. `"position"`, `"position_and_features"`, `"sliding_hdbscan"`, `"tdc_clustering"`, `"random_projections"`.

### `ClusteringStudy`

```python
class ClusteringStudy(BenchmarkStudy, MixinStudyUnitCount):
    """
    Benchmark study to compare clustering methods.

    The ground truth sorting objects must be given and method outputs will be
    compared to them.

    The input of methods are the detected peaks. Because the clustering can be
    performed on only a subset of the detected peaks, then selected peak must
    be also given as index of all spikes.
    """

    benchmark_class = ClusteringBenchmark

    def create_benchmark(self, key): ...

    def homogeneity_score(self, ignore_noise=True, case_keys=None): ...

    def get_count_units(
        self, case_keys=None,
        well_detected_score=None, redundant_score=None, overmerged_score=None,
    ): ...

    # plot helpers, each a thin wrapper over benchmark_plot_tools:
    def plot_unit_counts(self, **kwargs): ...
    def plot_agreement_matrix(self, **kwargs): ...
    def plot_performances_vs_snr(self, **kwargs): ...
    def plot_performances_vs_firing_rate(self, **kwargs): ...
    def plot_performances_comparison(self, *args, **kwargs): ...
    def plot_performance_losses(self, *args, **kwargs): ...
    def plot_performances_vs_depth_and_snr(self, *args, **kwargs): ...
    def plot_performances_ordered(self, *args, **kwargs): ...
    def plot_some_over_merged(self, *args, **kwargs): ...
    def plot_some_over_splited(self, *args, **kwargs): ...

    def plot_error_metrics(self, metric="cosine", case_keys=None, figsize=(15, 5)): ...
    def plot_metrics_vs_snr(self, metric="agreement", case_keys=None,
                            figsize=(15, 5), axes=None): ...
    def plot_metrics_vs_depth_and_snr(self, metric="agreement",
                                      case_keys=None, figsize=(15, 5)): ...
```

Method-specific string literals:

* `plot_error_metrics(metric=...)`: `"cosine"` → `sklearn.metrics.pairwise.cosine_similarity`; any other value → `sklearn.metrics.pairwise_distances` (e.g. `"l2"`, `"l1"`, `"manhattan"`).
* `plot_metrics_vs_snr(metric=...)`: three explicit branches — `"cosine"` (cosine similarity), `"l2"` (Euclidean distance), `"agreement"` (uses `comp.agreement_scores`).
* `plot_metrics_vs_depth_and_snr(metric=...)`: `"cosine"`, `"l2"`, `"agreement"`, `"recall"`, `"precision"`, `"accuracy"`. When one of the last three is used, values are taken from `comp.get_performance()[metric]`.
