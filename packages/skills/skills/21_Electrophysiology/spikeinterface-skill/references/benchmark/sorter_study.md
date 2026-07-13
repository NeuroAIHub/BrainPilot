# SorterStudy

Source in repo: `spikeinterface/src/spikeinterface/benchmark/benchmark_sorter.py`
Parent index: [INDEX.md](INDEX.md)
---

## SorterStudy

Located in `benchmark_sorter.py`. Compares full spike sorters against a ground-truth sorting.

### `SorterBenchmark`

```python
class SorterBenchmark(Benchmark):
    def __init__(self, recording, gt_sorting, params, sorter_folder):
        ...

    def run(self):
        raw_sorting = run_sorter(recording=self.recording, folder=self.sorter_folder, **self.params)
        sorting = NumpySorting.from_sorting(raw_sorting)
        self.result = {"sorting": sorting}

    def compute_result(self, match_score=0.5, exhaustive_gt=True, with_analyzer=False, **job_kwargs):
        ...

    _run_key_saved = [("sorting", "sorting")]
    _result_key_saved = [
        ("gt_comparison", "pickle"),
        ("sorter_analyzer", "sorting_analyzer"),
    ]
```

`params` must contain at minimum `sorter_name`; the whole dict is expanded into `run_sorter(...)` (so it also supports `sorter_params`, `verbose`, `docker_image`, `singularity_image`, etc.). `compute_result` runs `compare_sorter_to_ground_truth`, and — if `with_analyzer=True` — additionally builds a `SortingAnalyzer` with `random_spikes` + `templates`.

### `SorterStudy`

```python
class SorterStudy(BenchmarkStudy, MixinStudyUnitCount):
    """
    Benchmark study to compare Spike Sorters in various situations.

    This is the most top level benchmark to compare sorters between them
    but also to compare one sorter in challenging situations (drift, noise, ...).
    This can also be used to compare sorters with different parameters.

    The ground truth sorting must be given and sorting output from sorter will
    be compared to it.
    """

    benchmark_class = SorterBenchmark

    def create_benchmark(self, key): ...
    def remove_benchmark(self, key): ...

    # plot helpers, all thin wrappers over benchmark_plot_tools functions:
    def plot_unit_counts(self, **kwargs): ...
    def plot_performances(self, **kwargs): ...  # NOTE: imports `plot_performances` which does not exist in benchmark_plot_tools; this method is broken in source
    def plot_performances_vs_snr(self, **kwargs): ...
    def plot_performances_vs_firing_rate(self, **kwargs): ...
    def plot_performances_ordered(self, **kwargs): ...
    def plot_performances_swarm(self, **kwargs): ...
    def plot_agreement_matrix(self, **kwargs): ...
    def plot_performance_losses(self, *args, **kwargs): ...
    def plot_some_over_merged(self, *args, **kwargs): ...
    def plot_some_over_splited(self, *args, **kwargs): ...
```

Because of the mixin, `SorterStudy.get_count_units(case_keys, well_detected_score, redundant_score, overmerged_score)` and `SorterStudy.get_performance_by_unit(case_keys)` are also available.

#### Runnable example

```python
from spikeinterface.benchmark import SorterStudy

datasets = {"toy_A": (recording, gt_sorting)}  # or SortingAnalyzer

cases = {
    ("kilosort2_5", "toy_A"): dict(
        dataset="toy_A",
        label="KS2.5 on toy_A",
        params=dict(sorter_name="kilosort2_5"),
    ),
    ("spykingcircus2", "toy_A"): dict(
        dataset="toy_A",
        label="SC2 on toy_A",
        params=dict(sorter_name="spykingcircus2"),
    ),
}

study = SorterStudy.create(
    study_folder="/tmp/sorter_study",
    datasets=datasets,
    cases=cases,
    levels=["sorter", "dataset"],
)

study.run()
study.compute_results(match_score=0.5, exhaustive_gt=True)

study.plot_agreement_matrix()
study.plot_performances_vs_snr()
study.plot_unit_counts()
```
