# SpikeInterface Widgets Reference — Index

Reference for `spikeinterface.widgets` split into topical leaf files. Every widget is exposed as both a `BaseWidget` subclass and a `plot_*` function alias (the function alias is literally the class — e.g. `plot_traces is TracesWidget`). Widgets support multiple rendering backends selected via the `backend=` argument.

Source module in repo: `spikeinterface/src/spikeinterface/widgets/`

## Leaf files

- [overview.md](overview.md) — module overview, imports, and full table of contents (widget-name index).
- [backends.md](backends.md) — the six rendering backends, `get_default_plotter_backend` / `set_default_plotter_backend`, and per-backend `**backend_kwargs` defaults.
- [recording_plots.md](recording_plots.md) — `plot_traces`, `plot_spikes_on_traces`, `plot_probe_map`, `plot_peak_activity`, `plot_peaks_on_probe`, `plot_timeseries` (deprecated alias).
- [sorting_plots.md](sorting_plots.md) — `plot_rasters` (+ `BaseRasterWidget`), `plot_isi_distribution`, `plot_autocorrelograms`, `plot_crosscorrelograms`, `plot_unit_presence`, `plot_locations` (spike locations vs time).
- [analyzer_plots_a.md](analyzer_plots_a.md) — amplitudes and locations: `plot_amplitudes`, `plot_all_amplitudes_distributions`, `plot_spike_locations`, `plot_unit_locations`, `plot_unit_depths`, `plot_unit_probe_map`.
- [analyzer_plots_b.md](analyzer_plots_b.md) — waveforms and templates: `plot_unit_waveforms`, `plot_unit_templates`, `plot_unit_waveforms_density_map`, `plot_template_similarity`.
- [analyzer_plots_c.md](analyzer_plots_c.md) — metrics, summaries, and specialty analyzer plots: `plot_quality_metrics`, `plot_template_metrics` (+ `MetricsBaseWidget`), `plot_metric_histograms`, `plot_unit_summary`, `plot_sorting_summary`, `plot_valid_unit_periods`, `plot_unit_labels`, `plot_potential_merges`, `plot_drifting_templates`.
- [bombcell_curation_plots.md](bombcell_curation_plots.md) — `plot_bombcell_labels_upset` (`BombcellUpsetPlotWidget`) and `plot_bombcell_unit_labeling_all`.
- [comparison_plots.md](comparison_plots.md) — `plot_confusion_matrix`, `plot_agreement_matrix`, `plot_multicomparison_graph`, `plot_multicomparison_agreement`, `plot_multicomparison_agreement_by_sorter`, `plot_comparison_collision_by_similarity`, `plot_study_comparison_collision_by_similarity`, `plot_study_run_times`, `plot_study_unit_counts`, `plot_study_performances`, `plot_study_agreement_matrix`, `plot_study_summary`.
- [motion_plots.md](motion_plots.md) — `plot_motion`, `plot_motion_info`, `plot_drift_raster_map`.
- [helpers_and_notes.md](helpers_and_notes.md) — helper utilities (`get_some_colors`, `get_unit_colors`, `array_to_image`, non-exported helpers), notes on inheritance / shared backends, and docstring inconsistencies.

## Quick widget-to-leaf lookup

### Recording plots
- `plot_traces`, `plot_spikes_on_traces`, `plot_probe_map`, `plot_peak_activity`, `plot_peaks_on_probe`, `plot_timeseries` — [recording_plots.md](recording_plots.md)

### Sorting plots
- `plot_rasters`, `plot_isi_distribution`, `plot_autocorrelograms`, `plot_crosscorrelograms`, `plot_unit_presence`, `plot_locations` — [sorting_plots.md](sorting_plots.md)

### Analyzer plots (require a `SortingAnalyzer`)
- `plot_amplitudes`, `plot_all_amplitudes_distributions`, `plot_spike_locations`, `plot_unit_locations`, `plot_unit_depths`, `plot_unit_probe_map` — [analyzer_plots_a.md](analyzer_plots_a.md)
- `plot_unit_waveforms`, `plot_unit_templates`, `plot_unit_waveforms_density_map`, `plot_template_similarity` — [analyzer_plots_b.md](analyzer_plots_b.md)
- `plot_quality_metrics`, `plot_template_metrics`, `plot_metric_histograms`, `plot_unit_summary`, `plot_sorting_summary`, `plot_valid_unit_periods`, `plot_unit_labels`, `plot_potential_merges`, `plot_drifting_templates` — [analyzer_plots_c.md](analyzer_plots_c.md)
- `plot_bombcell_labels_upset`, `plot_bombcell_unit_labeling_all` — [bombcell_curation_plots.md](bombcell_curation_plots.md)

### Comparison plots
- `plot_confusion_matrix`, `plot_agreement_matrix`, `plot_multicomparison_graph`, `plot_multicomparison_agreement`, `plot_multicomparison_agreement_by_sorter`, `plot_comparison_collision_by_similarity`, `plot_study_comparison_collision_by_similarity`, `plot_study_run_times`, `plot_study_unit_counts`, `plot_study_performances`, `plot_study_agreement_matrix`, `plot_study_summary` — [comparison_plots.md](comparison_plots.md)

### Motion plots
- `plot_motion`, `plot_motion_info`, `plot_drift_raster_map` — [motion_plots.md](motion_plots.md)

### Backend system
- `get_default_plotter_backend`, `set_default_plotter_backend`, `default_backend_kwargs` — [backends.md](backends.md)

### Helpers
- `get_some_colors`, `get_unit_colors`, `array_to_image` — [helpers_and_notes.md](helpers_and_notes.md)
