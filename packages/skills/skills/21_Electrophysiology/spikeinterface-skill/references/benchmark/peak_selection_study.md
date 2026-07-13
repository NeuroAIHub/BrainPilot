# PeakSelectionStudy

Source in repo: `spikeinterface/src/spikeinterface/benchmark/benchmark_peak_selection.py`
Parent index: [INDEX.md](INDEX.md)
---

## PeakSelectionStudy

Located in `benchmark_peak_selection.py`.

```python
class PeakSelectionBenchmark(Benchmark):
    def __init__(self, recording, gt_sorting, params, indices, exhaustive_gt=True):
        pass  # stub
    def run(self, **job_kwargs):
        pass
    def compute_result(self, **result_params):
        pass

class PeakSelectionStudy(BenchmarkStudy):
    benchmark_class = PeakSelectionBenchmark

    def create_benchmark(self, key):
        dataset_key = self.cases[key]["dataset"]
        recording, gt_sorting = self.datasets[dataset_key]
        params = self.cases[key]["params"]
        init_kwargs = self.cases[key]["init_kwargs"]
        benchmark = PeakSelectionBenchmark(recording, gt_sorting, params, **init_kwargs)
        return benchmark
```

The active `PeakSelectionBenchmark` is a stub in the current codebase; a legacy `BenchmarkPeakSelection` implementation is commented out and preserved for reference. The `Study` inherits every plot helper and utility from `BenchmarkStudy`.
