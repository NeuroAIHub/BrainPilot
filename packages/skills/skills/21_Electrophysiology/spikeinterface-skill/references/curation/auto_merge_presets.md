# Auto-merge preset details
Source in repo: `spikeinterface/src/spikeinterface/curation/auto_merge.py`
Parent index: [INDEX.md](INDEX.md)
---

### Auto-merge preset details

Presets registered in `auto_merge.py._compute_merge_presets`:

| Preset                        | Steps applied (in order) |
|-------------------------------|---------------------------|
| `"similarity_correlograms"`   | `num_spikes`, `remove_contaminated`, `unit_locations`, `template_similarity`, `correlogram`, `quality_score` |
| `"temporal_splits"`           | `num_spikes`, `remove_contaminated`, `unit_locations`, `template_similarity`, `presence_distance`, `quality_score` |
| `"x_contaminations"`          | `num_spikes`, `remove_contaminated`, `unit_locations`, `template_similarity`, `cross_contamination`, `quality_score` |
| `"feature_neighbors"`         | `num_spikes`, `snr`, `remove_contaminated`, `unit_locations`, `knn`, `quality_score` |
| `"slay"`                      | `template_similarity`, `slay_score` |

Complete list of registered preset names: `"similarity_correlograms"`,
`"temporal_splits"`, `"x_contaminations"`, `"feature_neighbors"`, `"slay"`. Any other
name raises `ValueError: preset must be one of [...]`. Names like `"lupin"` are NOT
recognised in this module.

Available step keys and default parameters (`_default_step_params`):

- `num_spikes`: `{"min_spikes": 100}`
- `snr`: `{"min_snr": 2.0}`
- `remove_contaminated`: `{"contamination_thresh": 0.2, "refractory_period_ms": 1.0, "censored_period_ms": 0.3}`
- `unit_locations`: `{"max_distance_um": 150.0}`
- `correlogram`: `{"corr_diff_thresh": 0.16, "censor_correlograms_ms": 0.15, "sigma_smooth_ms": 0.6, "adaptative_window_thresh": 0.5}`
- `template_similarity`: `{"similarity_method": "l1", "template_diff_thresh": 0.25}` -
  `similarity_method` is one of `"cosine" | "l1" | "l2"` (the metrics supported by the
  `template_similarity` extension).
- `presence_distance`: `{"presence_distance_thresh": 100.0}`
- `knn`: `{"k_nn": 10}`
- `cross_contamination`: `{"cc_thresh": 0.1, "p_value": 0.2, "refractory_period_ms": 1.0, "censored_period_ms": 0.3}`
- `quality_score`: `{"firing_contamination_balance": 1.5, "refractory_period_ms": 1.0, "censored_period_ms": 0.3}`
- `slay_score`: `{"k1": 0.25, "k2": 1.0, "slay_threshold": 0.5}`

Extensions required per step (`_required_extensions`):

- `unit_locations`: `templates`, `unit_locations`
- `correlogram`: `correlograms`
- `snr`: `templates`, `noise_levels`
- `template_similarity`: `templates`, `template_similarity`
- `knn`: `templates`, `spike_locations`, `spike_amplitudes`
- `slay_score`: `correlograms`, `template_similarity`

Steps not listed above have no analyzer-extension prerequisite beyond what their
underlying computation needs (e.g., `remove_contaminated`, `quality_score` compute
refractory-period violations directly; `num_spikes` uses `count_num_spikes_per_unit`).


### SLAy auto-merge preset

The `"slay"` preset is an approximate SpikeInterface implementation of SLAy
(Sai Koukuntla, [github.com/saikoukunt/SLAy](https://github.com/saikoukunt/SLAy)). It runs
`template_similarity` followed by `slay_score` (a combined score using template similarity,
cross-correlation significance, and a sliding refractory-period-violation measure). Instead
of the original auto-encoder, the SpikeInterface variant uses standard
`template_similarity`. Default `slay_score` parameters: `k1=0.25`, `k2=1.0`,
`slay_threshold=0.5`.
