# Waveforms

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/waveforms/`
Parent index: [INDEX.md](INDEX.md)

---

## Waveforms

Module: `spikeinterface.sortingcomponents.waveforms`. The `__init__.py` is
empty — all objects live in submodules.

### `waveforms.peak_svd.extract_peaks_svd`

```python
from spikeinterface.sortingcomponents.waveforms.peak_svd import extract_peaks_svd

extract_peaks_svd(
    recording,
    peaks,
    ms_before=0.5,
    ms_after=1.5,
    n_peaks_fit=5000,
    svd_model=None,
    n_components=5,
    radius_um=120.0,
    sparsity_mask=None,
    motion_aware=False,
    motion=None,
    folder=None,
    seed=None,
    ensure_peak_same_sign=True,
    job_kwargs=None,
)
```

Fits a `TruncatedSVD` on max-channel waveforms then projects sparse local
waveforms. Output shape `(num_peaks, n_components, max_sparse_channel)`.
When `motion_aware=True` returns `(peaks_svd, sparse_mask, svd_model,
new_peaks)`; otherwise `(peaks_svd, sparse_mask, svd_model)`. If
`motion_aware=True` the projected features are back-transformed with cubic
interpolation using the `motion` object.

### `waveforms.waveform_utils`

- `to_temporal_representation(waveforms)` — reshape a
  `(n_wf, n_samples, n_channels)` block into
  `(n_wf * n_channels, n_samples)`.
- `from_temporal_representation(temporal_waveforms, num_channels)` — inverse
  reshape.

### `WaveformsNode` subclasses

All defined as `WaveformsNode` (extending the pipeline node framework):

#### `hanning_filter.HanningFilter`

```python
HanningFilter(
    recording: BaseRecording,
    return_output: bool = True,
    parents: Optional[List[PipelineNode]] = None,
)
```

Apply a Hanning window to waveforms.

#### `savgol_denoiser.SavGolDenoiser`

```python
SavGolDenoiser(
    recording: BaseRecording,
    return_output: bool = True,
    parents: Optional[List[PipelineNode]] = None,
    order: int = 3,
    window_length_ms: float = 0.25,
)
```

Savitzky–Golay filter over the temporal axis.

#### `waveform_thresholder.WaveformThresholder`

```python
WaveformThresholder(
    recording: BaseRecording,
    return_output: bool = True,
    parents: Optional[List[PipelineNode]] = None,
    feature: Literal["ptp", "mean", "energy", "peak_voltage"] = "ptp",
    threshold: float = 2,
    noise_levels: Optional[np.array] = None,
    random_chunk_kwargs: dict = {},
    operator: callable = operator.le,
)
```

`feature` is asserted in `["ptp", "mean", "energy", "peak_voltage"]`.

#### `neural_network_denoiser.SingleChannelToyDenoiser`

```python
SingleChannelToyDenoiser(
    recording: BaseRecording,
    return_output: bool = True,
    parents: Optional[List[PipelineNode]] = None,
)
```

Downloads a pretrained toy CNN from HuggingFace
(`SpikeInterface/test_repo`, subfolder `mearec_toy_model`).

Internal helper class `SingleChannel1dCNNDenoiser` with signature:
`__init__(self, pretrained_path=None, n_filters=[16, 8],
filter_sizes=[5, 11], spike_size=121)`.

#### `temporal_pca.TemporalPCBaseNode`

```python
TemporalPCBaseNode(
    recording: BaseRecording,
    parents: List[PipelineNode],
    pca_model=None,
    model_folder_path=None,
    return_output=True,
)
```

Base class with static `fit(recording, n_components, model_folder_path,
detect_peaks_params, peak_selection_params, job_kwargs=None,
ms_before=1.0, ms_after=1.0, whiten=True, radius_um=None)`.

#### `temporal_pca.TemporalPCAProjection`

```python
TemporalPCAProjection(
    recording: BaseRecording,
    parents: List[PipelineNode],
    pca_model=None,
    model_folder_path=None,
    dtype="float32",
    return_output=True,
)
```

#### `temporal_pca.TemporalPCADenoising`

```python
TemporalPCADenoising(
    recording: BaseRecording,
    parents: List[PipelineNode],
    pca_model=None,
    model_folder_path=None,
    return_output=True,
)
```

#### `temporal_pca.MotionAwareTemporalPCAProjection`

```python
MotionAwareTemporalPCAProjection(
    recording: BaseRecording,
    parents: List[PipelineNode],
    pca_model=None,
    model_folder_path=None,
    motion=None,
    final_sparsity_mask=None,
    interpolation_method="cubic",
    dtype="float32",
    return_output=True,
)
```

Class attribute: `_compute_has_extended_signature = True`. Used by
`extract_peaks_svd(motion_aware=True)`.

### Extracting waveforms to buffers

The primitive `extract_waveforms_to_buffers` referenced by the requirements
lives in `spikeinterface.core.waveform_tools` and is used inside
`sortingcomponents/tools.py::extract_waveform_at_max_channel` via
`extract_waveforms_to_single_buffer`. See the utility tools section.
