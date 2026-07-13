# Snippets, spatial interpolation kernel & pipeline helpers
Source in repo: `spikeinterface/src/spikeinterface/preprocessing/pipeline.py`
Parent index: [INDEX.md](INDEX.md)
---

## Snippets

### AlignSnippets

Aligns waveform snippets to the peak (main-channel peak or per-channel peak).

```python
AlignSnippets(
    snippets,
    new_nbefore,
    new_nafter,
    mode="main_peak",
    interpolate=1,
    det_sign=0,
)
```

- `mode` ∈ {`"main_peak"`, `"ch_peak"`}.
- `interpolate > 1` → cubic-spline upsampling.
- `det_sign`: `0` → `|x|`, `>0` → positive peak, `<0` → negative peak.

---

## Spatial interpolation kernel

### get_spatial_interpolation_kernel

```python
get_spatial_interpolation_kernel(
    source_location,
    target_location,
    method="kriging",
    sigma_um=20.0,
    p=1,
    num_closest=4,
    sparse_thresh=None,
    dtype="float32",
    force_extrapolate=False,
)
```

- `method` ∈ {`"kriging"`, `"idw"`, `"nearest"`}.
- Used internally by bad-channel interpolation and motion interpolation.

---

## Pipeline helpers

Defined in `preprocessing/pipeline.py`.

### PreprocessingPipeline

Container for an ordered chain of preprocessors, described by a dict
`{preprocessor_name: kwargs, ...}`.

```python
PreprocessingPipeline(preprocessor_dict)
```

Example:

```python
from spikeinterface.preprocessing import PreprocessingPipeline
pp = PreprocessingPipeline({
    "bandpass_filter": {"freq_min": 300., "freq_max": 6000.},
    "common_reference": {},
})
processed = pp._apply(recording)
```

Method: `_apply(recording, apply_precomputed_kwargs=False)`.

### apply_preprocessing_pipeline

```python
apply_preprocessing_pipeline(
    recording: BaseRecording,
    pipeline_or_dict: PreprocessingPipeline | dict,
    apply_precomputed_kwargs=True,
)
```

### get_preprocessing_dict_from_analyzer

```python
get_preprocessing_dict_from_analyzer(
    analyzer_folder,
    format="auto",
    backend_options=None,
)
```

- `format` ∈ {`"auto"`, `"binary_folder"`, `"zarr"`}.

### get_preprocessing_dict_from_file

```python
get_preprocessing_dict_from_file(recording_dictionary_path)
```

Reads a `.json` or `.pkl` / `.pickle` recording dictionary and returns the
preprocessing pipeline dict. Only extracts steps that can be applied "globally";
`ChannelSlice` and `FrameSlice` steps are omitted.
