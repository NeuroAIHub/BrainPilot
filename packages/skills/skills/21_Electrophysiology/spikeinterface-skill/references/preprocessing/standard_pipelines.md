# Standard pipelines & public exports
Source in repo: `spikeinterface/src/spikeinterface/preprocessing/preprocessing_classes.py`
Parent index: [INDEX.md](INDEX.md)
---

# SpikeInterface Preprocessing Reference

The `spikeinterface.preprocessing` module contains **lazy** preprocessors. Every function
returns a new `BaseRecording` object without loading data into memory; the actual
computation happens chunk-by-chunk when `get_traces()` is called (or when the recording
is saved). Because the return value is itself a `Recording`, preprocessors can be
**chained**:

```python
import spikeinterface.preprocessing as spre

rec1 = spre.bandpass_filter(recording, freq_min=300., freq_max=6000.)
rec2 = spre.phase_shift(rec1)
rec3 = spre.common_reference(rec2, operator="median", reference="global")
# rec3.save(folder="preprocessed", n_jobs=8, chunk_duration="1s")  # optional
```

Each preprocessing step exists in two forms: a **function** (lowercase, recommended for
end-users) and a **class** (CamelCase, `...Recording`). The function is a thin wrapper
around the class and shares the same signature. Below we document each pair.

Signatures are copied verbatim from source under
`spikeinterface/src/spikeinterface/preprocessing/`.

---

## Public exports (from `preprocessing/__init__.py`)

The following are the public names exposed from `spikeinterface.preprocessing`:

Preprocessor functions and their `...Recording` classes (from
`_all_preprocesser_dict` in `preprocessing_classes.py`):

| Function | Class |
| --- | --- |
| `filter` | `FilterRecording` |
| `bandpass_filter` | `BandpassFilterRecording` |
| `highpass_filter` | `HighpassFilterRecording` |
| `notch_filter` | `NotchFilterRecording` |
| `gaussian_filter` | `GaussianFilterRecording` |
| `normalize_by_quantile` | `NormalizeByQuantileRecording` |
| `scale` | `ScaleRecording` |
| `center` | `CenterRecording` |
| `zscore` | `ZScoreRecording` |
| `scale_to_physical_units` | `ScaleToPhysicalUnits` |
| `whiten` | `WhitenRecording` |
| `common_reference` | `CommonReferenceRecording` |
| `phase_shift` | `PhaseShiftRecording` |
| `detect_and_remove_bad_channels` | `DetectAndRemoveBadChannelsRecording` |
| `detect_and_interpolate_bad_channels` | `DetectAndInterpolateBadChannelsRecording` |
| `detect_and_remove_artifacts` | `DetectAndRemoveArtifactsRecording` |
| `rectify` | `RectifyRecording` |
| `clip` | `ClipRecording` |
| `blank_saturation` | `BlankSaturationRecording` |
| `silence_periods` | `SilencedPeriodsRecording` |
| `remove_artifacts` | `RemoveArtifactsRecording` |
| `zero_channel_pad` | `ZeroChannelPaddedRecording` |
| `deepinterpolate` | `DeepInterpolatedRecording` |
| `resample` | `ResampleRecording` |
| `decimate` | `DecimateRecording` |
| `highpass_spatial_filter` | `HighpassSpatialFilterRecording` |
| `interpolate_bad_channels` | `InterpolateBadChannelsRecording` |
| `depth_order` | `DepthOrderRecording` |
| `average_across_direction` | `AverageAcrossDirectionRecording` |
| `directional_derivative` | `DirectionalDerivativeRecording` |
| `astype` | `AstypeRecording` |
| `unsigned_to_signed` | `UnsignedToSignedRecording` |

Other exported callables (no `Recording` class pair):
`causal_filter`, `scale_to_uV`, `compute_whitening_matrix`, `train_deepinterpolation`,
`correct_motion`, `compute_motion`, `load_motion_info`, `save_motion_info`,
`get_motion_parameters_preset`, `get_motion_presets`, `detect_bad_channels`,
`correct_lsb`, `apply_preprocessing_pipeline`, `get_preprocessing_dict_from_analyzer`,
`get_preprocessing_dict_from_file`, `PreprocessingPipeline`,
`detect_artifact_periods`, `detect_artifact_periods_by_envelope`,
`detect_saturation_periods`, `AlignSnippets`, `get_spatial_interpolation_kernel`,
and `preprocessor_dict` (a mapping of class-name → function).

---

## Standard pipelines (recipes)

These recipes are copied from the SpikeInterface docs
(`doc/modules/preprocessing.rst`, section "How to implement IBL destriping or SpikeGLX
CatGT"). They are the recommended starting points for **Neuropixels 1.0 / 2.0 / NP-Ultra**
data.

### IBL "destriping" (recommended for Neuropixels)

```python
rec = read_spikeglx(folder_path='my_spikeglx_folder')
rec = highpass_filter(recording=rec, n_channel_pad=60)
rec = phase_shift(recording=rec)
bad_channel_ids = detect_bad_channels(recording=rec)
rec = interpolate_bad_channels(recording=rec, bad_channel_ids=bad_channel_ids)
rec = highpass_spatial_filter(recording=rec)
# optional
rec.save(folder='clean_traces', n_jobs=10, chunk_duration='1s', progres_bar=True)
```

### SpikeGLX CatGT equivalent

```python
rec = read_spikeglx(folder_path='my_spikeglx_folder')
rec = phase_shift(recording=rec)
rec = common_reference(recording=rec, operator="median", reference="global")
# optional
rec.save(folder='clean_traces', n_jobs=10, chunk_duration='1s', progres_bar=True)
```

### Common-reference variant used in the "Analyze Neuropixels" how-to

```python
rec1 = si.highpass_filter(raw_rec, freq_min=400.)
bad_channel_ids, channel_labels = si.detect_bad_channels(rec1)
rec2 = rec1.remove_channels(bad_channel_ids)
rec3 = si.phase_shift(rec2)
rec4 = si.common_reference(rec3, operator="median", reference="global")
rec = rec4
```

**Summary of the recommended NP1/NP2/NP-Ultra flow:**
`bandpass_filter` (or `highpass_filter`) → `phase_shift` → (bad-channel handling:
`detect_bad_channels` + `remove_channels` **or** `interpolate_bad_channels`) →
`common_reference` **or** `highpass_spatial_filter`. `phase_shift` is essential for
Neuropixels because AP channels are sampled sequentially (multiplexed) and needs the
recording to carry an `inter_sample_shift` property (present in SpikeGLX/OpenEphys
extractors).

Motion correction, if used, should be applied **after** filtering/denoising but
**before** whitening (see [correct_motion](#correct_motion) and the docs comment
"we recommend to not use whitening before motion estimation").
