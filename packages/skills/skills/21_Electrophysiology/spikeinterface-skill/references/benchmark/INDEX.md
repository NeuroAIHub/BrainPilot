# spikeinterface.benchmark

Comprehensive reference for the `spikeinterface.benchmark` subpackage. This module benchmarks:

* spike sorters (with or without ground truth),
* sorting components: peak detection, peak localization, peak selection, clustering, template matching,
* curation steps: merging,
* motion estimation and motion interpolation (drift correction).

Every benchmark task is organised around two paired objects:

* a **`Benchmark`** subclass responsible for one case — implements `run()` and `compute_result()`.
* a **`BenchmarkStudy`** subclass — the top-level API that manages many `Benchmark` instances, runs them, stores results on disk, and exposes plotting helpers.

## Leaf files

| # | File | Contents |
| --- | --- | --- |
| 1 | [package_exports.md](package_exports.md) | Top-level `spikeinterface.benchmark` re-exports and fully-qualified imports for other classes. |
| 2 | [base_classes.md](base_classes.md) | `Benchmark`, `MixinStudyUnitCount`, `BenchmarkStudy` (base classes in `benchmark_base.py`). |
| 3 | [sorter_study.md](sorter_study.md) | `SorterBenchmark` + `SorterStudy` — sorter comparison with ground truth. |
| 4 | [sorter_study_no_gt.md](sorter_study_no_gt.md) | `SorterBenchmarkWithoutGroundTruth` + `SorterStudyWithoutGroundTruth`. |
| 5 | [peak_detection_study.md](peak_detection_study.md) | `PeakDetectionBenchmark` + `PeakDetectionStudy`. |
| 6 | [peak_localization_study.md](peak_localization_study.md) | `PeakLocalizationBenchmark`/`Study` and `UnitLocalizationBenchmark`/`Study`. |
| 7 | [peak_selection_study.md](peak_selection_study.md) | `PeakSelectionBenchmark` (stub) + `PeakSelectionStudy`. |
| 8 | [clustering_study.md](clustering_study.md) | `ClusteringBenchmark` + `ClusteringStudy`. |
| 9 | [matching_study.md](matching_study.md) | `MatchingBenchmark` + `MatchingStudy` (template matching). |
| 10 | [merging_study.md](merging_study.md) | `MergingBenchmark` + `MergingStudy` (auto-merging). |
| 11 | [motion_estimation_study.md](motion_estimation_study.md) | `MotionEstimationBenchmark` + `MotionEstimationStudy` and `get_gt_motion_from_unit_displacement`. |
| 12 | [motion_interpolation_study.md](motion_interpolation_study.md) | `MotionInterpolationBenchmark` + `MotionInterpolationStudy`. |
| 13 | [plot_helpers_a.md](plot_helpers_a.md) | `benchmark_plot_tools` first half: `despine`, `plot_study_legend`, `aggregate_dataframe_by_levels`, `plot_run_times`, `plot_unit_counts`, `plot_agreement_matrix`, `plot_performances_vs_snr`, `plot_performances_vs_firing_rate`. |
| 14 | [plot_helpers_b.md](plot_helpers_b.md) | `benchmark_plot_tools` second half: `plot_performances_ordered`, `plot_performances_swarm`, `plot_performances_comparison`, `plot_performances_vs_depth_and_snr`, `plot_performance_losses`, `plot_some_over_merged`/`plot_some_over_splited`. |
| 15 | [utility_helpers.md](utility_helpers.md) | `sigmoid`, `fit_sigmoid` (`benchmark_tools.py`). |
| 16 | [residual_analysis.md](residual_analysis.md) | `analyse_residual`, `make_residual_recording` (`residual_analysis.py`). |
| 17 | [cheatsheets.md](cheatsheets.md) | Study → method-literal cheatsheet, unit-count criteria cheatsheet, common patterns. |

## Repo reference

Source files live under `spikeinterface/src/spikeinterface/benchmark/`:

* `benchmark_base.py` — base classes
* `benchmark_sorter.py`, `benchmark_sorter_without_gt.py` — sorter studies
* `benchmark_peak_detection.py`, `benchmark_peak_localization.py`, `benchmark_peak_selection.py` — sorting-component studies
* `benchmark_clustering.py`, `benchmark_matching.py`, `benchmark_merging.py` — sorting-component / curation studies
* `benchmark_motion_estimation.py`, `benchmark_motion_interpolation.py` — motion / drift studies
* `benchmark_plot_tools.py` — plot helpers
* `benchmark_tools.py` — sigmoid utilities
* `residual_analysis.py` — residual peak analysis for no-GT studies
