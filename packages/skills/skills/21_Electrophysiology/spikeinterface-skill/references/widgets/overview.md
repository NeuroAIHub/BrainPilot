# SpikeInterface Widgets Overview

Source in repo: `spikeinterface/src/spikeinterface/widgets/widget_list.py`
Parent index: [INDEX.md](INDEX.md)
---

The `spikeinterface.widgets` module provides plotting/visualization utilities. Every widget is exposed as both a `BaseWidget` subclass and a `plot_*` function alias (the function alias is literally the class — `plot_traces is TracesWidget`). Widgets support multiple rendering backends selected via the `backend=` argument.

Imports:

```python
import spikeinterface.widgets as sw
# or, equivalently
from spikeinterface.widgets import plot_traces, plot_unit_waveforms, ...
```

Signatures below are copied verbatim from source (`spikeinterface/widgets/*.py`). All `plot_<name>` aliases resolve to the corresponding `*Widget` class defined in `widget_list.py`.

## Table of Contents

### Backend System
- [Backends overview](#backends-overview)
- [set_default_plotter_backend / get_default_plotter_backend](#default-backend-management)
- [Common backend keyword arguments](#common-backend-keyword-arguments)

### Recording plots
- [`plot_traces`](#plot_traces)
- [`plot_spikes_on_traces`](#plot_spikes_on_traces)
- [`plot_probe_map`](#plot_probe_map)
- [`plot_peak_activity`](#plot_peak_activity)
- [`plot_peaks_on_probe`](#plot_peaks_on_probe)
- [`plot_timeseries` (deprecated alias)](#plot_timeseries-deprecated)

### Sorting plots
- [`plot_rasters`](#plot_rasters)
- [`plot_isi_distribution`](#plot_isi_distribution)
- [`plot_autocorrelograms`](#plot_autocorrelograms)
- [`plot_crosscorrelograms`](#plot_crosscorrelograms)
- [`plot_unit_presence`](#plot_unit_presence)
- [`plot_locations` (spike locations vs time)](#plot_locations)

### Analyzer plots (require a `SortingAnalyzer`)
- [`plot_amplitudes`](#plot_amplitudes)
- [`plot_all_amplitudes_distributions`](#plot_all_amplitudes_distributions)
- [`plot_spike_locations`](#plot_spike_locations)
- [`plot_unit_locations`](#plot_unit_locations)
- [`plot_unit_depths`](#plot_unit_depths)
- [`plot_unit_probe_map`](#plot_unit_probe_map)
- [`plot_unit_waveforms`](#plot_unit_waveforms)
- [`plot_unit_templates`](#plot_unit_templates)
- [`plot_unit_waveforms_density_map`](#plot_unit_waveforms_density_map)
- [`plot_template_similarity`](#plot_template_similarity)
- [`plot_quality_metrics`](#plot_quality_metrics)
- [`plot_template_metrics`](#plot_template_metrics)
- [`plot_metric_histograms`](#plot_metric_histograms)
- [`plot_unit_summary`](#plot_unit_summary)
- [`plot_sorting_summary`](#plot_sorting_summary)
- [`plot_valid_unit_periods`](#plot_valid_unit_periods)
- [`plot_unit_labels`](#plot_unit_labels)
- [`plot_potential_merges`](#plot_potential_merges)
- [`plot_drifting_templates`](#plot_drifting_templates)
- [`plot_bombcell_labels_upset` and `plot_bombcell_unit_labeling_all`](#bombcell-curation-plots)

### Comparison plots
- [`plot_confusion_matrix`](#plot_confusion_matrix)
- [`plot_agreement_matrix`](#plot_agreement_matrix)
- [`plot_multicomparison_graph`](#plot_multicomparison_graph)
- [`plot_multicomparison_agreement`](#plot_multicomparison_agreement)
- [`plot_multicomparison_agreement_by_sorter`](#plot_multicomparison_agreement_by_sorter)
- [`plot_comparison_collision_by_similarity`](#plot_comparison_collision_by_similarity)
- [`plot_study_comparison_collision_by_similarity`](#plot_study_comparison_collision_by_similarity)
- [`plot_study_run_times`](#plot_study_run_times)
- [`plot_study_unit_counts`](#plot_study_unit_counts)
- [`plot_study_performances`](#plot_study_performances)
- [`plot_study_agreement_matrix`](#plot_study_agreement_matrix)
- [`plot_study_summary`](#plot_study_summary)

### Motion plots
- [`plot_motion`](#plot_motion)
- [`plot_motion_info`](#plot_motion_info)
- [`plot_drift_raster_map`](#plot_drift_raster_map)

### Helper utilities
- [`get_some_colors`, `get_unit_colors`, `array_to_image`](#helper-utilities)

---
