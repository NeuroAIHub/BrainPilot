# Base classes

Source in repo: `spikeinterface/src/spikeinterface/benchmark/benchmark_base.py`
Parent index: [INDEX.md](INDEX.md)
---

## Base classes

Defined in `spikeinterface/benchmark/benchmark_base.py`.

### `Benchmark`

```python
class Benchmark:
    """
    Responsible to make a unique run() and compute_result() for one case.
    """

    def __init__(self):
        self.result = {}

    # this must not be changed in inherited
    _main_key_saved = [("run_time", "pickle")]

    # this must be updated in inherited
    _run_key_saved = []
    _result_key_saved = []

    def save_main(self, folder): ...
    def save_run(self, folder): ...
    def save_result(self, folder): ...

    @classmethod
    def load_folder(cls, folder): ...

    def run(self):
        raise NotImplementedError

    def compute_result(self):
        raise NotImplementedError
```

Subclasses define `_run_key_saved` and `_result_key_saved` — lists of `(key, format)` tuples that instruct how each entry in `self.result` should be serialised. The supported `format` string literals are:

* `"npy"` — numpy `.npy` file
* `"pickle"` — pickle file
* `"sorting"` — save via `sorting.save(format="numpy_folder", overwrite=True)`
* `"Motion"` — call `Motion.save(folder=...)`
* `"zarr_templates"` — call `Templates.to_zarr(folder)`
* `"sorting_analyzer"` — save via `analyzer.save_as(format="binary_folder", folder=...)`

Any other value raises `ValueError`. `load_folder` reads those keys back from disk.

### `MixinStudyUnitCount`

Mixed into any study that has `gt_comparison` results (e.g. `SorterStudy`, `MatchingStudy`, `ClusteringStudy` overrides). Adds:

```python
class MixinStudyUnitCount:
    def get_count_units(
        self,
        case_keys=None,
        well_detected_score=None,
        redundant_score=None,
        overmerged_score=None,
    ):
        ...

    def get_performance_by_unit(self, case_keys=None):
        ...
```

`get_count_units` returns a `pandas.DataFrame` indexed by case key with columns:

* `"num_gt"`, `"num_sorter"`, `"num_well_detected"` — always present.
* `"num_false_positive"`, `"num_redundant"`, `"num_overmerged"`, `"num_bad"` — added only when the comparison was created with `exhaustive_gt=True`.

The three thresholds are the same-named scores used by `spikeinterface.comparison.GroundTruthComparison`:

* `well_detected_score` : passed to `comp.count_well_detected_units()`
* `redundant_score` : passed to `comp.count_redundant_units()` **and** `comp.count_false_positive_units()`
* `overmerged_score` : passed to `comp.count_overmerged_units()`

### `BenchmarkStudy`

Central manager for a set of benchmark cases sharing common datasets.

```python
class BenchmarkStudy:
    """
    Generic study for sorting components.
    This manage a list of Benchmark.
    This manage a dict of "cases" every case is one Benchmark.

    Benchmark is responsible for run() and compute_result()
    BenchmarkStudy is the main API for:
      * running (re-running) some cases
      * save (run + compute_result) in results dict
      * make some plots in inherited classes.
    """

    benchmark_class = None

    def __init__(self, study_folder):
        self.folder = Path(study_folder)
        self.datasets = {}
        self.analyzers = {}
        self.cases = {}
        self.benchmarks = {}
        self.levels = None
        self.colors_by_case = None
        self.colors_by_levels = {}
        self.labels_by_levels = {}
        self.scan_folder()
```

#### `BenchmarkStudy.create` — factory

```python
@classmethod
def create(cls, study_folder, datasets={}, cases={}, levels=None):
    """
    Create a BenchmarkStudy from a dict of datasets and cases.

    Parameters
    ----------
    study_folder : str | Path
        The folder where the study will be saved.
    datasets : dict
        A dict of datasets. The keys are the dataset names and the values are
        `SortingAnalyzer` objects. Values can also be tuples with
        (recording, gt_sorting), but this is deprecated.
    cases : dict
        A dict of cases. The keys are the cases (str, or tuples) and the values
        are dictionaries containing:
            * dataset
            * label
            * params
    levels : list | None
        If the keys of the cases are tuples, this is the list of levels names.

    Returns
    -------
    study : BenchmarkStudy
        The created study.
    """
```

Case keys must be homogeneously either strings (single-level study) or tuples of the same length (multi-level study). When tuples are used, `levels` supplies human-readable names for each tuple position; default names are `["level0", "level1", ...]`.

For each dataset that is passed as a `(recording, gt_sorting)` tuple:

* If `gt_sorting` has a `"gt_unit_locations"` property, a channel sparsity is built around the true max-channel using a hard-coded `radius_um = 100.0`.
* Otherwise sparsity defaults to `sparse=True`.
* If `gt_sorting is None`, an empty `NumpySorting` is created and `sparse=False` is used so an analyzer still exists for internal API needs.

The folder layout created by `create()` is:

```
study_folder/
    analyzers_path.json
    info.json
    cases.pickle
    run_logs/
    results/
    sorting_analyzer/<dataset_key>/    # only for freshly created analyzers
```

#### Other `BenchmarkStudy` methods

```python
def create_benchmark(self, key):
    """Create a benchmark for a given key.  Overridden by each subclass."""
    raise NotImplementedError

def scan_folder(self): ...
def key_to_str(self, key): ...
def remove_benchmark(self, key): ...
def add_cases(self, cases): ...
def remove_cases(self, case_keys): ...

def set_precomputed_results(self, precomputed_results, verbose=False):
    """
    Set precomputed results for some cases. This is useful when you want to
    compute results outside of the benchmark and then set them in the benchmark.

    Parameters
    ----------
    precomputed_results : dict
        A dict with the same keys as cases and values are dict with the results
        to set for each case. 'run_time' is a special key that will be set to
        0.0 if not present.
    verbose : bool, default: False
    """

def run(self, case_keys=None, keep=True, verbose=False, **job_kwargs):
    """Run all (or a subset of) cases."""

def set_colors(self, colors=None, map_name="tab10", levels_to_group_by=None):
    """
    Set colors for the study cases or for a given levels_to_group_by.

    Parameters
    ----------
    colors : dict | None, default: None
    map_name : str, default: 'tab10'
    levels_to_group_by : list | None, default: None
    """

def get_colors(self, levels_to_group_by=None): ...
def get_run_times(self, case_keys=None): ...

def get_grouped_keys_mapping(self, levels_to_group_by=None, case_keys=None):
    """
    Returns
    -------
    grouped_keys : dict of new_key -> list of matching case keys.
    labels : dict of new_key -> label str.
    """

def plot_run_times(self, case_keys=None, **kwargs): ...
def compute_results(self, case_keys=None, verbose=False, **result_params): ...

def get_sorting_analyzer(self, case_key=None, dataset_key=None): ...
def compute_analyzer_extension(self, extensions, dataset_keys=None, **extension_kwargs): ...
def get_gt_unit_locations(self, case_key): ...
def get_templates(self, key, operator="average", outputs="numpy"): ...
def compute_metrics(self, case_keys=None, metric_names=["snr", "firing_rate"], force=False, **job_kwargs): ...
def get_metrics(self, key): ...
def get_all_metrics(self, case_keys=None): ...
def get_units_snr(self, key): ...
def get_result(self, key): ...
def get_pairs_by_level(self, level): ...
```

Notes on the string-literal parameters that appear across `BenchmarkStudy`:

* `get_templates(operator=...)`: forwarded to `SortingAnalyzer` → `TemplatesExtension.get_data`. Accepted values are the standard ones understood by that extension (typically `"average"`, `"median"`, `"std"`, `"percentile"`; forwarded as-is).
* `get_templates(outputs=...)`: `"numpy"` (default) or `"Templates"`.
* `set_colors(map_name=...)`: any valid matplotlib colormap name; default `"tab10"`.
* `compute_metrics(metric_names=...)`: default `["snr", "firing_rate"]`; any valid `qualitymetrics` metric name is accepted.
