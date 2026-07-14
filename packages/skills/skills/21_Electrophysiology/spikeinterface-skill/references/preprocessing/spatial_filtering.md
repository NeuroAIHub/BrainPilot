# Spatial filtering & channel geometry
Source in repo: `spikeinterface/src/spikeinterface/preprocessing/highpass_spatial_filter.py`
Parent index: [INDEX.md](INDEX.md)
---

## Spatial filtering & channel geometry

### highpass_spatial_filter / HighpassSpatialFilterRecording

"Destriping" filter from the IBL pipeline (`kfilt`). All channels must be in a single
group.

```python
HighpassSpatialFilterRecording(
    recording: BaseRecording,
    n_channel_pad=60,
    n_channel_taper=0,
    direction="y",
    apply_agc=True,
    agc_window_length_s=0.1,
    highpass_butter_order=3,
    highpass_butter_wn=0.01,
    epsilon=0.003,
    random_slice_kwargs=None,
    dtype=None,
    rms_values=None,
)
```

- `direction` ∈ {`"x"`, `"y"`, `"z"`}.
- `highpass_butter_wn` — critical frequency relative to Nyquist.
- If `apply_agc=False`, `agc_window_length_s` is ignored.

### depth_order / DepthOrderRecording

Re-orders channels lexicographically by their probe locations.

```python
DepthOrderRecording(
    parent_recording,
    channel_ids=None,
    dimensions=("x", "y"),
    flip=False,
)
```

- `dimensions`: `str` in {`"x"`, `"y"`, `"z"`}, or a tuple/list of them (default
  `("x", "y")` — lex sort).
- `flip=False` → bottom-first (starting from probe tip); `flip=True` → top-first.

### average_across_direction / AverageAcrossDirectionRecording

```python
AverageAcrossDirectionRecording(
    parent_recording: BaseRecording,
    direction: str = "y",
    dtype="float32",
)
```

- `direction` ∈ {`"x"`, `"y"`, `"z"`}.

### directional_derivative / DirectionalDerivativeRecording

```python
DirectionalDerivativeRecording(
    recording: BaseRecording,
    direction: str = "y",
    order: int = 1,
    edge_order: int = 1,
    dtype="float32",
)
```

- `direction` ∈ {`"x"`, `"y"`, `"z"`}.
- `order=0` performs a spatial common reference (subtracts each column's mean).
- `edge_order` is forwarded to `np.gradient`.
