# MatchingStudy

Source in repo: `spikeinterface/src/spikeinterface/benchmark/benchmark_matching.py`
Parent index: [INDEX.md](INDEX.md)
---

## MatchingStudy

Located in `benchmark_matching.py`.

### `MatchingBenchmark`

```python
class MatchingBenchmark(Benchmark):
    def __init__(self, recording, gt_sorting, params):
        self.method = params["method"]
        self.templates = params["templates"]
        self.method_kwargs = params["method_kwargs"]

    def run(self, verbose=True, **job_kwargs):
        spikes = find_spikes_from_templates(
            self.recording, self.templates,
            method=self.method, method_kwargs=self.method_kwargs,
            verbose=verbose, job_kwargs=job_kwargs,
        )
        ...
        self.result = {"sorting": sorting, "spikes": spikes, "templates": self.templates}

    def compute_result(self, with_collision=False, match_score=0.5, exhaustive_gt=True):
        ...
        if with_collision:
            self.result["gt_collision"] = CollisionGTComparison(
                self.gt_sorting, sorting, exhaustive_gt=True
            )

    _run_key_saved = [
        ("sorting", "sorting"),
        ("spikes", "npy"),
        ("templates", "zarr_templates"),
    ]
    _result_key_saved = [("gt_collision", "pickle"), ("gt_comparison", "pickle")]
```

`params["method"]` is any string accepted by `spikeinterface.sortingcomponents.matching.find_spikes_from_templates`, typically `"circus"`, `"circus-omp-svd"`, `"tridesclous"`, `"wobble"`, `"naive"`.

### `MatchingStudy`

```python
class MatchingStudy(BenchmarkStudy, MixinStudyUnitCount):
    """
    Benchmark study to compare template matching methods.

    The ground truth sorting objects must be given and method outputs will be
    compared to them.  Templates must also be given.  Note that the full template
    can be given but also only a partial catalogue can be given to challenge the
    template matching methods when the catalogue is not entirely known.
    """

    benchmark_class = MatchingBenchmark

    def create_benchmark(self, key): ...

    def plot_agreement_matrix(self, **kwargs): ...
    def plot_performances_vs_snr(self, **kwargs): ...
    def plot_performances_comparison(self, **kwargs): ...
    def plot_performances_vs_depth_and_snr(self, *args, **kwargs): ...
    def plot_performances_ordered(self, *args, **kwargs): ...

    def plot_collisions(
        self, case_keys=None, metric="l2", mode="lines",
        show_legend=True, axs=None, figsize=None,
    ): ...

    def plot_unit_counts(self, case_keys=None, **kwargs): ...
    def plot_unit_losses(self, *args, **kwargs):
        """Deprecated alias — now `plot_performance_losses`."""
    def plot_performance_losses(self, *args, **kwargs): ...
```

`plot_collisions` accepts:

* `metric` — any distance name accepted by `sklearn.metrics.pairwise_distances`, e.g. `"l2"`, `"cosine"`, `"l1"`.
* `mode` — forwarded to `spikeinterface.widgets.plot_comparison_collision_by_similarity`; string literals `"lines"` (default) or `"matrix"`.
