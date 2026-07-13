# SpikeInterface Metrics — Reference Index

This index lists the leaf reference files under `references/metrics/`. Each leaf covers a small, focused slice of the `spikeinterface.metrics` public surface and is kept under 300 lines.

Source packages (in the repo):
- `spikeinterface/src/spikeinterface/metrics/__init__.py`
- `spikeinterface/src/spikeinterface/metrics/quality/`
- `spikeinterface/src/spikeinterface/metrics/spiketrain/`
- `spikeinterface/src/spikeinterface/metrics/template/`
- `spikeinterface/src/spikeinterface/metrics/utils.py`

Original combined references (kept for reference; do not edit):
- `../qualitymetrics-part-a.md`
- `../qualitymetrics-part-b.md`

---

## Root

| File | Contents |
|---|---|
| [package_exports.md](package_exports.md) | Package-level exports of `spikeinterface.metrics` — table mapping every public name to its subpackage. |
| [spiketrain.md](spiketrain.md) | Spike-train metrics: `ComputeSpikeTrainMetrics`, `compute_spiketrain_metrics`, `NumSpikes`, `FiringRate`, and their public compute functions. |
| [utils.md](utils.md) | `metrics/utils.py`: `compute_bin_edges_per_unit`, `compute_total_samples_per_unit`, `compute_total_durations_per_unit`, `create_regular_periods`, `create_ground_truth_pc_distributions`. |

---

## `quality/` — quality metrics (spike-train + waveform + PCA)

| File | Contents |
|---|---|
| [quality/api.md](quality/api.md) | Public API: `ComputeQualityMetrics`, `compute_quality_metrics`, `get_quality_metric_list`, `get_quality_pca_metric_list`, `get_default_quality_metrics_params`, per-metric public `compute_*` list. |
| [quality/misc_a.md](quality/misc_a.md) | Misc metric registry A: `num_spikes`, `firing_rate`, `presence_ratio`, `snr`, `isi_violation`, `rp_violation`. |
| [quality/misc_b.md](quality/misc_b.md) | Misc metric registry B: `sliding_rp_violation`, `synchrony`, `firing_range`, `amplitude_cv`, `amplitude_cutoff`, `noise_cutoff`. |
| [quality/misc_c.md](quality/misc_c.md) | Misc metric registry C: `amplitude_median`, `drift`, `sd_ratio`. |
| [quality/pca_registry.md](quality/pca_registry.md) | PCA metric registry: `mahalanobis` (isolation_distance + l_ratio), `d_prime`, `nearest_neighbor`, `silhouette`, `nn_advanced` (nn_isolation + nn_noise_overlap). |
| [quality/per_file_signatures.md](quality/per_file_signatures.md) | Verbatim function signatures for every `def compute_*` and helper in `quality/__init__.py`, `quality_metrics.py`, `misc_metrics.py`, `pca_metrics.py`. |
| [quality/string_literal_params.md](quality/string_literal_params.md) | Complete table of string-Literal parameters, backward-compat notes on `peak_sign`, same-name parameter cross-references, class attribute name enumeration, `metric_columns` and `metric_params` per class. |
| [quality/recommended_sets.md](quality/recommended_sets.md) | Recommended metric sets (no formal bundles — behavioural defaults + suggested groupings by required extensions). |
| [quality/backcompat.md](quality/backcompat.md) | Backward compatibility notes handled by `_handle_backward_compatibility_on_load` (renamings, `peak_sign` stripping, deprecated aliases). |

---

## `template/` — template metrics

| File | Contents |
|---|---|
| [template/template_a.md](template/template_a.md) | Public exports, module-level helpers, `ComputeTemplateMetrics` extension, all single-channel metric classes (`PeakToTroughDuration`, `HalfWidth`, `RepolarizationSlope`, `RecoverySlope`, `NumberOfPeaks`, `MainToNextExtremumDuration`, `WaveformRatios`, `WaveformWidths`, `WaveformBaselineFlatness`). |
| [template/template_b.md](template/template_b.md) | Multi-channel metric classes (`VelocityFits`, `ExpDecay`, `Spread`), plus underlying `get_*` metric functions from `peak_to_trough_duration` through `waveform_widths`. |
| [template/template_c.md](template/template_c.md) | `get_waveform_baseline_flatness`, `get_velocity_fits`, `get_exp_decay`, `get_spread`, multi-channel helpers (`transform_column_range`, `sort_template_and_locations`, `fit_line_robust`), and detection helpers (`get_trough_and_peak_idx`, `detect_peaks_on_templates`, `_compute_halfwidth`). |

---

## `spiketrain/` — spike-train metrics

Single leaf at [spiketrain.md](spiketrain.md).

---

## Reading order

For a new reader:
1. `package_exports.md` — see everything reachable from `spikeinterface.metrics`.
2. `quality/api.md` — the main entry point for quality-metric computation.
3. Registry files (`quality/misc_a.md`, `quality/misc_b.md`, `quality/misc_c.md`, `quality/pca_registry.md`) — per-metric class definitions with signatures and semantics.
4. `quality/per_file_signatures.md` — verbatim signatures for every function in the quality package.
5. `quality/string_literal_params.md` — reference for allowed string values and same-name parameter defaults.
6. `spiketrain.md`, `template/template_a.md`, `template/template_b.md`, `template/template_c.md` — the smaller sub-packages.
7. `utils.md` — helpers not re-exported at the package level.
8. `quality/recommended_sets.md`, `quality/backcompat.md` — pragmatic notes.
