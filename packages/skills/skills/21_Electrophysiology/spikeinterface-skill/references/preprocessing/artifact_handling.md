# Artifact & saturation handling
Source in repo: `spikeinterface/src/spikeinterface/preprocessing/detect_bad_periods.py`
Parent index: [INDEX.md](INDEX.md)
---

## Artifact & saturation handling

### detect_saturation_periods

Run on **raw** traces (before preprocessing).

```python
detect_saturation_periods(
    recording: BaseRecording,
    saturation_threshold_uV: float | None = None,
    diff_threshold_uV: float | None = None,
    proportion: float = 0.2,
    signed: bool = False,
    job_kwargs: dict | None = None,
) -> np.ndarray
```

- Returns an array with dtype `artifact_dtype` (fields
  `"start_sample_index"`, `"end_sample_index"`, `"segment_index"`).
- If `signed=True`, an extra `"sign"` field is added with values
  `"positive"` or `"negative"`.
- If `saturation_threshold_uV=None`, reads the `"saturation_threshold_uV"` annotation
  of `recording`.

### detect_artifact_periods_by_envelope

```python
detect_artifact_periods_by_envelope(
    recording: BaseRecording,
    detect_threshold: float = 5,
    apply_envelope_common_reference: bool = False,
    freq_max: float = 20.0,
    seed: int | None = None,
    job_kwargs: dict | None = None,
    random_slices_kwargs: dict | None = None,
    return_envelope: bool = False,
) -> np.ndarray | tuple[np.ndarray, BaseRecording]
```

### detect_artifact_periods

Dispatch wrapper.

```python
detect_artifact_periods(
    recording: BaseRecording,
    method: Literal["envelope", "saturation"] = "envelope",
    method_kwargs: dict | None = None,
    job_kwargs: dict | None = None,
) -> np.ndarray
```

- `method` ∈ {`"envelope"`, `"saturation"`}.

### detect_and_remove_artifacts / DetectAndRemoveArtifactsRecording

```python
DetectAndRemoveArtifactsRecording(
    recording: BaseRecording,
    recording_to_detect: BaseRecording | None = None,
    method: Literal["envelope", "saturation"] = "envelope",
    method_kwargs: dict | None = None,
    job_kwargs: dict | None = None,
    mode: Literal["zeros", "noise", "apodization"] = "zeros",
    noise_levels_kwargs: dict | None = None,
    apodization: int = 7,
    seed: int | None = None,
    artifact_periods=None,
)
```

- `method` ∈ {`"envelope"`, `"saturation"`}.
- `mode` ∈ {`"zeros"`, `"noise"`, `"apodization"`}.

### remove_artifacts / RemoveArtifactsRecording

Removes stimulation artifacts at user-provided trigger frames.

```python
RemoveArtifactsRecording(
    recording,
    list_triggers,
    ms_before=0.5,
    ms_after=3.0,
    mode="zeros",
    fit_sample_spacing=1.0,
    list_labels=None,
    artifacts=None,
    sparsity=None,
    scale_amplitude=False,
    time_jitter=0,
    waveforms_kwargs=None,
)
```

- `mode` ∈ {`"zeros"`, `"linear"`, `"cubic"`, `"average"`, `"median"`}.
- `list_labels` required for `"median"` and `"average"` modes.
- `artifacts`: `dict[label -> template]` for `"median"` / `"average"`.
- `sparsity`: `dict[label -> boolean channel mask]`.
- `time_jitter` (ms): search window for `"median"` / `"average"` alignment.
- `waveforms_kwargs`: deprecated and ignored.

### silence_periods / SilencedPeriodsRecording

Replaces arbitrary user-provided periods.

```python
SilencedPeriodsRecording(
    recording,
    periods=None,
    list_periods=None,  # deprecated, kept for backward compatibility; use `periods`
    mode="zeros",
    apodization_samples=7,
    noise_levels=None,
    seed=None,
    **noise_levels_kwargs,
)
```

- `mode` ∈ {`"zeros"`, `"noise"`, `"apodization"`}:
  - `"zeros"`: silenced periods → 0.
  - `"noise"`: silenced periods → per-channel Gaussian noise with matching variance.
  - `"apodization"`: silenced periods zeroed with a cosine-taper transition.
- `periods` is a structured numpy array with fields `segment_index`,
  `start_sample_index`, `end_sample_index` (dtype `base_period_dtype`).
