# Cheatsheets and common patterns

Source in repo: `spikeinterface/src/spikeinterface/benchmark/` (multiple modules)
Parent index: [INDEX.md](INDEX.md)
---

## Cheatsheet: mapping study → method string literals

| Class | Parameter | Accepted values |
| --- | --- | --- |
| `SorterBenchmark.compute_result` | `exhaustive_gt` | bool |
| `SorterBenchmarkWithoutGroundTruth.compute_result` | `detect_peaks_kwargs["method"]` | (from `detect_peaks`) — hard-coded to `"locally_exclusive"` |
| `SorterBenchmarkWithoutGroundTruth.compute_result` | `detect_peaks_kwargs["peak_sign"]` | hard-coded to `"neg"` |
| `PeakDetectionBenchmark` | `params["method"]` | any name in `spikeinterface.sortingcomponents.peak_detection.detect_peaks` (e.g. `"by_channel"`, `"locally_exclusive"`, `"by_channel_torch"`, `"locally_exclusive_torch"`, `"matched_filtering"`) |
| `PeakDetectionStudy.plot_template_similarities` | `metric` | `"cosine"` or any distance for `sklearn.metrics.pairwise_distances` (`"l2"`, `"l1"`, ...) |
| `UnitLocalizationBenchmark` | `params["method"]` | `"center_of_mass"`, `"monopolar_triangulation"`, `"grid_convolution"` |
| `ClusteringBenchmark` | `params["method"]` | any name in `find_clusters_from_peaks` (e.g. `"position"`, `"position_and_features"`, `"sliding_hdbscan"`, `"tdc_clustering"`, `"random_projections"`) |
| `ClusteringStudy.plot_error_metrics` | `metric` | `"cosine"` or any distance for `sklearn.metrics.pairwise_distances` |
| `ClusteringStudy.plot_metrics_vs_snr` | `metric` | `"cosine"`, `"l2"`, `"agreement"` |
| `ClusteringStudy.plot_metrics_vs_depth_and_snr` | `metric` | `"cosine"`, `"l2"`, `"agreement"`, `"recall"`, `"precision"`, `"accuracy"` |
| `MatchingBenchmark` | `params["method"]` | any name in `find_spikes_from_templates` (e.g. `"circus"`, `"circus-omp-svd"`, `"tridesclous"`, `"wobble"`, `"naive"`) |
| `MatchingStudy.plot_collisions` | `metric` | any distance name for `sklearn.metrics.pairwise_distances` (`"l2"`, `"cosine"`, `"l1"`, ...) |
| `MatchingStudy.plot_collisions` | `mode` | `"lines"`, `"matrix"` |
| `MergingStudy.plot_*` | `backend` | `"matplotlib"`, `"ipywidgets"`, `"sortingview"`, `"ephyviewer"` |
| `MotionEstimationBenchmark` | `direction` | `"x"`, `"y"` |
| `MotionInterpolationBenchmark` | `params["recording_source"]` | `"static"`, `"drifting"`, `"corrected"` |
| `MotionInterpolationStudy.plot_sorting_accuracy` | `mode` | `"ordered_accuracy"`, `"depth_snr"`, `"snr"`, `"depth"` |
| `plot_run_times` | `mode` | `"bar"`, `"box"` |
| `plot_performances_vs_snr`, `plot_performances_vs_firing_rate`, `plot_performances_ordered` | `orientation` | `"vertical"`, `"horizontal"` |
| `analyse_residual` | `detect_peaks_kwargs["method"]` | any peak-detection method (default `"locally_exclusive"`) |
| `analyse_residual` | `detect_peaks_kwargs["peak_sign"]` | `"neg"`, `"pos"`, `"both"` (default `"both"`) |
| Base `Benchmark._save_keys` formats | format string | `"npy"`, `"pickle"`, `"sorting"`, `"Motion"`, `"zarr_templates"`, `"sorting_analyzer"` |

## Cheatsheet: unit-count criteria

`MixinStudyUnitCount.get_count_units` (also overridden verbatim on `ClusteringStudy` and `MergingStudy`) accepts these criteria:

* `well_detected_score` — float or None. Forwarded to `comp.count_well_detected_units()`.
* `redundant_score` — float or None. Forwarded to `comp.count_redundant_units()` **and** `comp.count_false_positive_units()`.
* `overmerged_score` — float or None. Forwarded to `comp.count_overmerged_units()`.
* `num_bad` uses `comp.count_bad_units()` (no threshold argument).

The output columns are always:

* `"num_gt"`, `"num_sorter"`, `"num_well_detected"` (always).
* Plus `"num_false_positive"`, `"num_redundant"`, `"num_overmerged"`, `"num_bad"` when `comp.exhaustive_gt` is True.

## Common patterns

Set colors per group and produce a legend:

```python
study.set_colors(map_name="tab10", levels_to_group_by=["sorter"])
plot_study_legend(study, levels_to_group_by=["sorter"])
```

Retrieve everything as tidy pandas frames:

```python
metrics_df = study.get_all_metrics()          # multi-indexed by case levels
run_times  = study.get_run_times()
perfs_df   = study.get_performance_by_unit()  # from MixinStudyUnitCount
counts_df  = study.get_count_units(well_detected_score=0.8,
                                    redundant_score=0.2,
                                    overmerged_score=0.2)
```

Manually seed results (e.g. from a legacy run):

```python
study.set_precomputed_results(
    precomputed_results={"case1": dict(sorting=some_sorting, run_time=42.0)},
    verbose=True,
)
```

Rerun only new cases (keep existing results):

```python
study.run(keep=True)              # default: existing results kept
```

Rerun everything from scratch:

```python
study.run(keep=False, n_jobs=8, chunk_duration="1s")
```
