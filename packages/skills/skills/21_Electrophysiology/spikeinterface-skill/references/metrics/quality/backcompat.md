# Quality Metrics — Backward compatibility notes
Source in repo: `spikeinterface/src/spikeinterface/metrics/quality/quality_metrics.py`
Parent index: [../INDEX.md](../INDEX.md)
---

## Backward compatibility notes

Handled by `ComputeQualityMetrics._handle_backward_compatibility_on_load` (called at load time when `need_backward_compatibility_on_load = True`):

1. `qm_params` in stored params is renamed to `metric_params`.
2. Legacy metric names `isolation_distance` and `l_ratio` are replaced by the merged `mahalanobis`.
3. `peak_sign` is removed from top-level params and from any of these metric-specific params: `amplitude_cutoff`, `amplitude_median`, `snr`, `sd_ratio`, `nn_isolation`, `nn_noise_overlap`, `nn_advanced`.
4. `snr`'s legacy `peak_mode` param is renamed to `method`.
5. `qualitymetrics` module is a deprecation wrapper — the direct import path is `spikeinterface.metrics.quality` and the old module will be removed in 0.105.0.
6. `get_default_qm_params` is a deprecated alias for `get_default_quality_metrics_params`, removed in 0.105.0.
