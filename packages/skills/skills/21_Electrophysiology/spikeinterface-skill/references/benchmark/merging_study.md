# MergingStudy

Source in repo: `spikeinterface/src/spikeinterface/benchmark/benchmark_merging.py`
Parent index: [INDEX.md](INDEX.md)
---

## MergingStudy

Located in `benchmark_merging.py`. Benchmarks automatic unit merging on an already-obtained (possibly oversplit) sorting.

### `MergingBenchmark`

```python
class MergingBenchmark(Benchmark):
    def __init__(self, recording, splitted_sorting, params, gt_sorting, splitted_cells=None):
        ...
        self.method_kwargs = params["method_kwargs"]

    def run(self, **job_kwargs):
        sorting_analyzer = create_sorting_analyzer(
            self.splitted_sorting, self.recording,
            format="memory", sparse=True, **job_kwargs,
        )
        merged_analyzer, self.result["merged_pairs"], self.result["merges"], self.result["outs"] = auto_merge_units(
            sorting_analyzer, extra_outputs=True, **self.method_kwargs, **job_kwargs
        )
        self.result["sorting"] = merged_analyzer.sorting

    def compute_result(self, match_score=0.5, exhaustive_gt=True):
        ...

    _run_key_saved = [
        ("sorting", "sorting"),
        ("merges", "pickle"),
        ("merged_pairs", "pickle"),
        ("outs", "pickle"),
    ]
    _result_key_saved = [("gt_comparison", "pickle")]
```

`params["method_kwargs"]` is expanded into `spikeinterface.curation.auto_merge.auto_merge_units` (see the curation reference for its full list of `preset`, `resolve_graph`, `steps`, and per-step kwargs).

### `MergingStudy`

```python
class MergingStudy(BenchmarkStudy):
    benchmark_class = MergingBenchmark

    def create_benchmark(self, key): ...
    def get_count_units(self, case_keys=None,
                        well_detected_score=None,
                        redundant_score=None,
                        overmerged_score=None): ...
    def plot_agreement_matrix(self, **kwargs): ...
    def plot_unit_counts(self, case_keys=None, **kwargs): ...

    def get_splitted_pairs(self, case_key): ...
    def get_splitted_pairs_index(self, case_key, pair): ...

    def plot_splitted_amplitudes(self, case_key, pair_index=0, backend="ipywidgets"): ...
    def plot_splitted_correlograms(self, case_key, pair_index=0, backend="ipywidgets"): ...
    def plot_splitted_templates(self, case_key, pair_index=0, backend="ipywidgets"): ...
    def plot_potential_merges(self, case_key, min_snr=None, backend="ipywidgets"): ...
    def plot_performed_merges(self, case_key, backend="ipywidgets"): ...
```

The `backend` parameter is forwarded to `spikeinterface.widgets` and accepts any of the widget backends: `"matplotlib"`, `"ipywidgets"` (default), `"sortingview"`, `"ephyviewer"`.
