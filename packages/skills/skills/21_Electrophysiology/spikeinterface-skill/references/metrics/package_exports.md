# Metrics — package-level exports (`spikeinterface.metrics`)
Source in repo: `spikeinterface/src/spikeinterface/metrics/__init__.py`
Parent index: [INDEX.md](INDEX.md)
---

## 0. Metrics package-level exports (`spikeinterface.metrics`)

Because of star-import re-exports, the following helpers are all reachable as `spikeinterface.metrics.<name>` (or `si.metrics.<name>`):

| Name | Kind | Source subpackage |
|---|---|---|
| `ComputeTemplateMetrics` | class | `template.template_metrics` |
| `compute_template_metrics` | function (extension factory) | `template.template_metrics` |
| `get_template_metric_list` | function | `template.template_metrics` |
| `get_template_metric_names` | function (deprecated → `get_template_metric_list`) | `template.template_metrics` |
| `get_single_channel_template_metric_names` | function | `template.template_metrics` |
| `get_multi_channel_template_metric_names` | function | `template.template_metrics` |
| `get_default_template_metrics_params` | function | `template.template_metrics` |
| `get_default_tm_params` | function (deprecated → `get_default_template_metrics_params`) | `template.template_metrics` |
| `get_trough_and_peak_idx` | function | `template.metrics` |
| `ComputeSpikeTrainMetrics` | class | `spiketrain.spiketrain_metrics` |
| `compute_spiketrain_metrics` | function (extension factory) | `spiketrain.spiketrain_metrics` |
| `get_spiketrain_metric_list` | function | `spiketrain.spiketrain_metrics` |
| `get_default_spiketrain_metrics_params` | function | `spiketrain.spiketrain_metrics` |
| `compute_num_spikes` | function | `spiketrain.metrics` |
| `compute_firing_rates` | function | `spiketrain.metrics` |
| `ComputeQualityMetrics` | class | `quality.quality_metrics` (Part A) |
| `compute_quality_metrics` | function (extension factory) | `quality.quality_metrics` (Part A) |
| `get_quality_metric_list` | function | `quality.quality_metrics` (Part A) |
| `get_quality_pca_metric_list` | function | `quality.quality_metrics` (Part A) |
| `get_default_quality_metrics_params` | function | `quality.quality_metrics` (Part A) |
| `get_default_qm_params` | function (deprecated → `get_default_quality_metrics_params`) | `quality.quality_metrics` (Part A) |
| `compute_snrs`, `compute_isi_violations`, `compute_amplitude_cutoffs`, `compute_presence_ratios`, `compute_drift_metrics`, `compute_amplitude_cv_metrics`, `compute_amplitude_medians`, `compute_noise_cutoffs`, `compute_firing_ranges`, `compute_sliding_rp_violations`, `compute_sd_ratio`, `compute_synchrony_metrics`, `compute_refrac_period_violations` | functions | `quality.misc_metrics` (Part A) |

Notes:
- There is **no** `get_spiketrain_metric_names` function (the string appears only inside a docstring). The correct name is `get_spiketrain_metric_list`.
- The utility functions in `metrics/utils.py` (§3) are **not** re-exported at the metrics package level; they must be imported from `spikeinterface.metrics.utils`.
- Base classes (`BaseMetric`, `BaseMetricExtension`) come from `spikeinterface.core.analyzer_extension_core`, not `spikeinterface.metrics`.

---

