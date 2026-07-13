# SorterStudyWithoutGroundTruth

Source in repo: `spikeinterface/src/spikeinterface/benchmark/benchmark_sorter_without_gt.py`
Parent index: [INDEX.md](INDEX.md)
---

## SorterStudyWithoutGroundTruth

Located in `benchmark_sorter_without_gt.py`.

### `SorterBenchmarkWithoutGroundTruth`

```python
class SorterBenchmarkWithoutGroundTruth(Benchmark):
    def __init__(self, recording, gt_sorting, params, sorter_folder):
        ...

    def run(self):
        raw_sorting = run_sorter(recording=self.recording, folder=self.sorter_folder, **self.params)
        sorting = NumpySorting.from_sorting(raw_sorting)
        self.result = {"sorting": sorting}

    def compute_result(self, residulal_peak_threshold=6, **job_kwargs):
        ...

    _run_key_saved = [("sorting", "sorting")]
    _result_key_saved = [
        ("multi_comp", "pickle"),
        ("sorter_analyzer", "sorting_analyzer"),
        ("peaks_from_residual", "npy"),
    ]
```

Inside `compute_result`, a `SortingAnalyzer` is created and the following extensions are computed:
`"random_spikes"`, `"templates"`, `"noise_levels"`, `"spike_amplitudes"`, `"amplitude_scalings"` (with `handle_collisions=False`), `"quality_metrics"`. Then `analyse_residual` is called with:

```python
detect_peaks_kwargs=dict(
    method="locally_exclusive",
    peak_sign="neg",
    detect_threshold=residulal_peak_threshold,   # default 6
)
```

### `SorterStudyWithoutGroundTruth`

```python
class SorterStudyWithoutGroundTruth(BenchmarkStudy):
    """
    This class is an alternative to SorterStudy when the dataset does not have
    groundtruth.  This is mainly based on the residual analysis.
    """

    benchmark_class = SorterBenchmarkWithoutGroundTruth

    def create_benchmark(self, key): ...

    def compute_results(
        self,
        case_keys=None,
        verbose=False,
        delta_time=0.4,
        match_score=0.5,
        chance_score=0.1,
        **result_params,
    ):
        """
        Compute results for all cases (case_keys must be None).
        Also computes a multi-way `compare_multiple_sorters` across every case
        sharing the same dataset key. Hard-coded arguments:

            agreement_method="count",
            n_jobs=-1,
            spiketrain_mode="union",
            do_matching=True,
        """

    def plot_residual_peak_amplitudes(self, figsize=None): ...
```

`case_keys` is not allowed to be a sub-selection: results must be computed all at once because the multi-sorter comparison is shared across cases that share a dataset.
