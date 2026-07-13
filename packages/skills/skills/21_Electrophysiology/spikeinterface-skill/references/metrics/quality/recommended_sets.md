# Quality Metrics — Recommended metric sets
Source in repo: `spikeinterface/src/spikeinterface/metrics/quality/quality_metrics.py`
Parent index: [../INDEX.md](../INDEX.md)
---

## Recommended metric sets

The source does not define named "recommended" bundles. Behavioural defaults from `ComputeQualityMetrics._set_params`:

- **`metric_names=None`** — all metrics from `misc_metrics_list + pca_metrics_list`, but with `nn_advanced` removed (too slow). PCA metrics are included only if the `principal_components` extension is available.
- **`skip_pc_metrics=True`** — all metrics in `pca_metrics_list` are filtered out; only the misc list runs.

The docstring notes: `principal_components are loaded automatically if already computed.`

If you want a fast baseline set, pick from the always-available (no-extension) metrics: `num_spikes`, `firing_rate`, `presence_ratio`, `isi_violation`, `rp_violation`, `sliding_rp_violation`, `synchrony`, `firing_range`.

Common "amplitude quality" set (requires `spike_amplitudes` or `amplitude_scalings`): `amplitude_median` (strict — needs `spike_amplitudes`), `amplitude_cutoff`, `noise_cutoff`, `amplitude_cv`, `sd_ratio` (needs `templates` + `spike_amplitudes` + recording).

Common "waveform quality" set (requires `templates`, `noise_levels`): `snr`.

Common "drift" (requires `spike_locations`): `drift`.

Common "PCA" set (requires `principal_components`): `mahalanobis`, `d_prime`, `nearest_neighbor`, `silhouette`. Add `nn_advanced` (also needs `waveforms`, `templates`) only when compute time is acceptable.

---

