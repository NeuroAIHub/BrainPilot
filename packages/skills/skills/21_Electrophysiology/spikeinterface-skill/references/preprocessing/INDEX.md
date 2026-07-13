# SpikeInterface Preprocessing Reference — Index

Split of the top-level `references/preprocessing.md` into leaf files, one per topic.
The full source module in the repo is at
`spikeinterface/src/spikeinterface/preprocessing/`.

Preprocessors are **lazy**: every function returns a new `BaseRecording`; the
computation happens per-chunk when `get_traces()` is called (or when the recording is
saved). Each preprocessing step exists as both a **function** (lowercase, recommended
for end users) and a **class** (CamelCase, `...Recording`).

## Files

- [standard_pipelines.md](standard_pipelines.md) — Module overview, public exports,
  and standard-pipeline recipes (IBL destriping, SpikeGLX CatGT, Neuropixels
  common-reference variant).
- [filtering.md](filtering.md) — `filter`, `bandpass_filter`, `highpass_filter`,
  `notch_filter`, `causal_filter`, `gaussian_filter`, `filter_opencl`.
- [referencing.md](referencing.md) — `common_reference`, `phase_shift`.
- [spatial_filtering.md](spatial_filtering.md) — `highpass_spatial_filter`,
  `depth_order`, `average_across_direction`, `directional_derivative`.
- [bad_channels.md](bad_channels.md) — `detect_bad_channels`,
  `detect_and_remove_bad_channels`, `interpolate_bad_channels`,
  `detect_and_interpolate_bad_channels`.
- [artifact_handling.md](artifact_handling.md) — `detect_saturation_periods`,
  `detect_artifact_periods_by_envelope`, `detect_artifact_periods`,
  `detect_and_remove_artifacts`, `remove_artifacts`, `silence_periods`.
- [scaling.md](scaling.md) — `scale`, `normalize_by_quantile`, `center`, `zscore`,
  `scale_to_uV`, `scale_to_physical_units`.
- [clipping.md](clipping.md) — `clip`, `blank_saturation`, `rectify`.
- [resampling.md](resampling.md) — `resample`, `decimate`.
- [dtype_conversion.md](dtype_conversion.md) — `astype`, `unsigned_to_signed`,
  `correct_lsb`.
- [whitening.md](whitening.md) — `whiten`, `compute_whitening_matrix`.
- [channel_padding.md](channel_padding.md) — `zero_channel_pad`, `pad_traces`.
- [deep_learning.md](deep_learning.md) — `deepinterpolate`,
  `train_deepinterpolation`.
- [motion_correction.md](motion_correction.md) — `correct_motion`, `compute_motion`,
  `get_motion_presets`, `get_motion_parameters_preset`, `save_motion_info`,
  `load_motion_info`.
- [snippets_and_helpers.md](snippets_and_helpers.md) — `AlignSnippets`,
  `get_spatial_interpolation_kernel`, `PreprocessingPipeline`,
  `apply_preprocessing_pipeline`, `get_preprocessing_dict_from_analyzer`,
  `get_preprocessing_dict_from_file`.

## Recommended pipeline (NP1 / NP2 / NP-Ultra)

`bandpass_filter` (or `highpass_filter`) → `phase_shift` →
(bad-channel handling: `detect_bad_channels` + `remove_channels`, or
`interpolate_bad_channels`) → `common_reference` or `highpass_spatial_filter`.

If motion correction is used, apply it **after** filtering/denoising and **before**
whitening.
