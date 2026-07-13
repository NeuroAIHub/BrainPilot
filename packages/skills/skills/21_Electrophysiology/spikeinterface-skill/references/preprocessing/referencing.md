# Re-referencing
Source in repo: `spikeinterface/src/spikeinterface/preprocessing/common_reference.py`
Parent index: [INDEX.md](INDEX.md)
---

## Re-referencing

### common_reference / CommonReferenceRecording

Removes a common reference (CMR / CAR) from each channel.

```python
CommonReferenceRecording(
    recording: BaseRecording,
    reference: Literal["global", "single", "local"] = "global",
    operator: Literal["median", "average"] = "median",
    groups: list | None = None,
    ref_channel_ids: list | str | int | None = None,
    local_radius: tuple[float, float] = (30.0, 55.0),
    min_local_neighbors: int = 5,
    dtype: str | np.dtype | None = None,
)
```

- `reference` ∈ {`"global"`, `"single"`, `"local"`}:
  - `"global"`: subtract median/average of all channels (or of `ref_channel_ids` if given).
  - `"single"`: subtract a single specified channel (or the median/average of specified
    channels). Requires `ref_channel_ids`. Zeroes out the reference channel.
  - `"local"`: subtract the median/average of the channels inside an annulus
    `(exclude_radius, include_radius)` around each channel. Not compatible with
    `groups`.
- `operator` ∈ {`"median"` (CMR), `"average"` (CAR)}.
- `local_radius`: `(exclude_radius, include_radius)` in µm.
- `min_local_neighbors`: minimum neighbors within the annulus; if fewer are available,
  the closest ones beyond the inner radius are used.

### phase_shift / PhaseShiftRecording

Corrects the sub-sample time shifts between multiplexed channels (Neuropixels).

```python
PhaseShiftRecording(
    recording,
    margin_ms=40.0,
    inter_sample_shift=None,
    dtype=None,
)
```

- `inter_sample_shift` overrides the recording's `"inter_sample_shift"` property; if
  provided, its length must equal `num_channels`.
- Uses FFT-based frequency-domain shifting (`apply_frequency_shift`).

Note: the source code accepts `dtype` in `__init__`, but currently the `_kwargs`
dumped for provenance excludes it.
