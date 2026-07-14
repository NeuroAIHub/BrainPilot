# PeakDetectionStudy

Source in repo: `spikeinterface/src/spikeinterface/benchmark/benchmark_peak_detection.py`
Parent index: [INDEX.md](INDEX.md)
---

## PeakDetectionStudy

Located in `benchmark_peak_detection.py`.

### `PeakDetectionBenchmark`

```python
class PeakDetectionBenchmark(Benchmark):
    def __init__(self, recording, gt_sorting, params, gt_peaks,
                 exhaustive_gt=True, delta_t_ms=0.2):
        ...
        assert "method" in self.params, "Method should be specified in the params!"
        self.method = self.params.get("method")
        self.delta_frames = int(delta_t_ms * self.recording.sampling_frequency / 1000)
        self.params = self.params["method_kwargs"]
        ...

    def run(self, **job_kwargs):
        peaks = detect_peaks(
            self.recording, self.method, method_kwargs=self.params, job_kwargs=job_kwargs,
        )
        self.result["peaks"] = peaks

    def compute_result(self, **result_params): ...

    _run_key_saved = [("peaks", "npy")]
    _result_key_saved = [
        ("gt_comparison_by_channels", "pickle"),
        ("matched_sorting", "sorting"),
        ("gt_comparison", "pickle"),
        ("peak_on_channels", "sorting"),
        ("gt_on_channels", "sorting"),
        ("matches", "pickle"),
        ("matched_templates", "npy"),
        ("gt_amplitudes", "npy"),
        ("gt_templates", "npy"),
    ]
```

`params["method"]` is any string accepted by `spikeinterface.sortingcomponents.peak_detection.detect_peaks`, e.g. `"by_channel"`, `"locally_exclusive"`, `"by_channel_torch"`, `"locally_exclusive_torch"`, `"matched_filtering"`.

### `PeakDetectionStudy`

```python
class PeakDetectionStudy(BenchmarkStudy):
    """
    Benchmark study to compare peak detection methods.
    The ground truth sorting must be given.
    Peak detected by methods will be compared to the ground truth to estimate the
    recall.
    """

    benchmark_class = PeakDetectionBenchmark

    def create_benchmark(self, key): ...

    def plot_performances_vs_snr(self, **kwargs): ...
    def plot_agreements_by_channels(self, case_keys=None, figsize=(15, 15)): ...
    def plot_agreements_by_units(self, case_keys=None, figsize=(15, 15)): ...
    def plot_detected_amplitude_distributions(
        self, case_keys=None, show_legend=True, detect_threshold=None,
        figsize=(15, 5), ax=None,
    ): ...
    def plot_deltas_per_cells(self, case_keys=None, figsize=(15, 5)): ...
    def plot_mean_deltas(self, case_keys=None, figsize=(15, 5), ax=None): ...
    def plot_template_similarities(
        self, case_keys=None, metric="l2", figsize=(15, 5),
        detect_threshold=None, ax=None,
    ): ...
```

`plot_template_similarities(metric=...)`: string literal — `"cosine"` uses `sklearn.metrics.pairwise.cosine_similarity`, any other value is forwarded to `sklearn.metrics.pairwise_distances`, common choices being `"l2"` (default), `"l1"`, `"manhattan"`, `"euclidean"`.

Case dict for this study has the form:

```python
cases = {
    "loc_excl": dict(
        dataset="toy",
        label="Locally exclusive",
        params=dict(
            method="locally_exclusive",
            method_kwargs=dict(peak_sign="neg", detect_threshold=5),
        ),
        init_kwargs=dict(gt_peaks=gt_peaks, exhaustive_gt=True, delta_t_ms=0.2),
    ),
}
```
