# Neuropixels utils
Source in repo: `spikeinterface/src/spikeinterface/extractors/neuropixels_utils.py`
Parent index: [INDEX.md](INDEX.md)
---

File: `extractors/neuropixels_utils.py`. Not re-exported by `extractors/__init__.py`; import directly as `from spikeinterface.extractors.neuropixels_utils import ...`.

## `get_neuropixels_sample_shifts_from_probe(probe: Probe) -> np.ndarray`

Compute inter-sample (ADC phase) shifts per channel from `probeinterface.Probe` annotations. Requires the probe to carry `num_channels_per_adc`, `ap_sample_frequency_hz`, `lf_sample_frequency_hz` (probe annotations) and `adc_sample_order` (contact annotations); returns `None` and warns if any are missing.

Formula: `num_cycles_in_adc = int(num_channels_per_adc * (1 + lf_sample_frequency_hz / ap_sample_frequency_hz))`, then `sample_shifts = adc_sample_order / num_cycles_in_adc`. NP 1.0 → 13 cycles; NP 2.0 → equal to `num_channels_per_adc`.

## `compute_saturation_threshold_from_probe(probe: Probe, stream_name: str) -> float`

Returns saturation threshold in microvolts. Uses `adc_range_vpp` and the appropriate gain: `lf_gain` when `"lf"` is in `stream_name.lower()`, otherwise `ap_gain`. Formula: `(adc_range_vpp / 2) / gain * 1e6`. Returns `None` (with a warning) if the required annotations are absent.

## `synchronize_neuropixel_streams(recording_ref, recording_other)`

Placeholder that raises `NotImplementedError` (planned linear-regression sync from the last "sync" channel).
