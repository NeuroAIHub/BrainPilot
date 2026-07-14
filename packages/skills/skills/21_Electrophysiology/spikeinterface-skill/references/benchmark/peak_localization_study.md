# PeakLocalizationStudy

Source in repo: `spikeinterface/src/spikeinterface/benchmark/benchmark_peak_localization.py`
Parent index: [INDEX.md](INDEX.md)
---

## PeakLocalizationStudy

Located in `benchmark_peak_localization.py`. Two paired classes live here.

### `PeakLocalizationBenchmark` / `PeakLocalizationStudy`

Benchmarks localisation of individual detected peaks. Under the hood, the analyzer computes the `"spike_locations"` extension with your chosen method.

```python
class PeakLocalizationBenchmark(Benchmark):
    def __init__(self, recording, gt_sorting, params, gt_positions,
                 channel_from_template=False):
        ...

    def run(self, **job_kwargs): ...
    def compute_result(self, **result_params): ...

    _run_key_saved = [
        ("spikes_locations", "pickle"),
        ("templates", "zarr_templates"),
    ]
    _result_key_saved = [
        ("errors", "pickle"),
        ("medians_over_templates", "npy"),
        ("mads_over_templates", "npy"),
    ]

class PeakLocalizationStudy(BenchmarkStudy):
    benchmark_class = PeakLocalizationBenchmark
    def create_benchmark(self, key): ...
    def plot_comparison_positions(self, case_keys=None): ...
```

### `UnitLocalizationBenchmark` / `UnitLocalizationStudy`

Benchmarks unit-level localisation (one location per unit, computed from templates).

```python
class UnitLocalizationBenchmark(Benchmark):
    def __init__(self, recording, gt_sorting, params, gt_positions):
        ...
        assert "method" in params, "Method should be specified in the params!"
        self.method = params["method"]
        self.params = params["method_kwargs"]
        ...

    def run(self, **job_kwargs):
        # dispatches on self.method
        if self.method == "center_of_mass":
            unit_locations = compute_center_of_mass(sorting_analyzer, **self.params)
        elif self.method == "monopolar_triangulation":
            unit_locations = compute_monopolar_triangulation(sorting_analyzer, **self.params)
        elif self.method == "grid_convolution":
            unit_locations = compute_grid_convolution(sorting_analyzer, **self.params)
        ...

    _run_key_saved = [
        ("unit_locations", "npy"),
        ("templates", "zarr_templates"),
    ]
    _result_key_saved = [("errors", "npy")]

class UnitLocalizationStudy(BenchmarkStudy):
    """
    Benchmark study to compare peaks localization methods.

    The ground truth position of units must be known and method outputs will be
    compared to them.
    """

    benchmark_class = UnitLocalizationBenchmark

    def create_benchmark(self, key): ...
    def plot_template_errors(self, case_keys=None, show_probe=True): ...
    def plot_comparison_positions(self, case_keys=None): ...
```

`UnitLocalizationBenchmark` accepts exactly three string literals for `params["method"]`:

* `"center_of_mass"`
* `"monopolar_triangulation"`
* `"grid_convolution"`

Any other value silently produces no `unit_locations` (a NameError is likely).
