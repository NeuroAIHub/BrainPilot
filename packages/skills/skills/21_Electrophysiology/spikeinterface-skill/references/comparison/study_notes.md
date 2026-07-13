# GroundTruthStudy (removed) and SorterStudy
Source in repo: `spikeinterface/src/spikeinterface/comparison/groundtruthstudy.py`
Parent index: [INDEX.md](INDEX.md)
---

`spikeinterface.comparison.GroundTruthStudy` is **removed**. Instantiating it
or calling its (only) classmethod raises `RuntimeError`:

```python
class GroundTruthStudy:
    def __init__(self, study_folder):
        raise RuntimeError(_txt_error_message)

    @classmethod
    def create(cls, study_folder, datasets={}, cases={}, levels=None):
        raise RuntimeError(_txt_error_message)
```

The message points at the replacement in `spikeinterface.benchmark`:

```python
from spikeinterface.benchmark import SorterStudy

study = SorterStudy.create(
    study_folder,
    datasets=datasets,   # dict: {name: SortingAnalyzer}  (or (recording, gt_sorting) tuple, deprecated)
    cases=cases,         # dict: {key: {"dataset": ..., "label": ..., "params": {"sorter_name": ..., ...}}}
    levels=None,         # list of level names when case keys are tuples
)
study.run()                    # run sorters
study.compute_results(         # run GT comparisons (forwards kwargs to SorterBenchmark.compute_result)
    match_score=0.5,
    exhaustive_gt=True,
    with_analyzer=False,
)

# result accessors (inherited from BenchmarkStudy / MixinStudyUnitCount)
study.get_run_times(case_keys=None)
study.get_count_units(
    case_keys=None,
    well_detected_score=None,
    redundant_score=None,
    overmerged_score=None,
)
study.get_performance_by_unit(case_keys=None)
study.get_result(key)                          # dict with "sorting", "gt_comparison", ...
study.get_sorting_analyzer(case_key=None, dataset_key=None)
study.get_templates(key, operator="average", outputs="numpy")
study.get_metrics(key)
study.get_all_metrics(case_keys=None)
study.get_units_snr(key)
study.get_gt_unit_locations(case_key)
study.compute_metrics(case_keys=None, metric_names=["snr", "firing_rate"], force=False, **job_kwargs)
study.compute_analyzer_extension(extensions, dataset_keys=None, **extension_kwargs)
study.add_cases(cases)
study.remove_cases(case_keys)
study.remove_benchmark(key)
study.set_precomputed_results(precomputed_results, verbose=False)
study.set_colors(colors=None, map_name="tab10", levels_to_group_by=None)
study.get_colors(levels_to_group_by=None)
study.get_grouped_keys_mapping(levels_to_group_by=None, case_keys=None)
study.get_pairs_by_level(level)

# plots (delegate to benchmark_plot_tools)
study.plot_run_times(case_keys=None, **kwargs)
study.plot_unit_counts(**kwargs)
study.plot_performances(**kwargs)
study.plot_performances_vs_snr(**kwargs)
study.plot_performances_vs_firing_rate(**kwargs)
study.plot_performances_ordered(**kwargs)
study.plot_performances_swarm(**kwargs)
study.plot_agreement_matrix(**kwargs)
study.plot_performance_losses(*args, **kwargs)
study.plot_some_over_merged(*args, **kwargs)
study.plot_some_over_splited(*args, **kwargs)
```

Under the hood each case is a `SorterBenchmark(recording, gt_sorting, params, sorter_folder)`
whose `run()` calls `run_sorter(...)` and whose `compute_result(match_score=0.5,
exhaustive_gt=True, with_analyzer=False, **job_kwargs)` calls
`compare_sorter_to_ground_truth(...)` and stores the result under the
`"gt_comparison"` key in `benchmark.result` (accessible via
`study.get_result(key)["gt_comparison"]`).

Note: `spikeinterface.comparison` has no `hybrid` submodule. Hybrid-recording
generation lives elsewhere in the codebase (e.g. `spikeinterface.generation`);
this module only exposes the collision helpers (`CollisionGTComparison`,
`make_collision_events`, `make_matching_events`) documented above.
