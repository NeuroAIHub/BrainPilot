# Bad channel handling
Source in repo: `spikeinterface/src/spikeinterface/preprocessing/detect_bad_channels.py`
Parent index: [INDEX.md](INDEX.md)
---

## Bad channel handling

### detect_bad_channels

```python
detect_bad_channels(
    recording: BaseRecording,
    method: str = "coherence+psd",
    std_mad_threshold: float = 5,
    psd_hf_threshold: float = 0.02,
    dead_channel_threshold: float = -0.5,
    noisy_channel_threshold: float = 1.0,
    outside_channel_threshold: float = -0.75,
    outside_channels_location: Literal["top", "bottom", "both"] = "top",
    n_neighbors: int = 11,
    nyquist_threshold: float = 0.8,
    direction: Literal["x", "y", "z"] = "y",
    chunk_duration_s: float = 0.3,
    num_random_chunks: int = 100,
    welch_window_ms: float = 10.0,
    highpass_filter_cutoff: float = 300,
    neighborhood_r2_threshold: float = 0.9,
    neighborhood_r2_radius_um: float = 30.0,
    seed: int | None = None,
    channel_filters: set | None = None,
)
# returns (bad_channel_ids, channel_labels)
```

- `method` ∈ {`"std"`, `"mad"`, `"coherence+psd"`, `"neighborhood_r2"`}.
- `outside_channels_location` ∈ {`"top"`, `"bottom"`, `"both"`}.
- `direction` ∈ {`"x"`, `"y"`, `"z"`}.
- `channel_filters`: subset of `{"dead", "noise", "out"}` (or `None` for all).
- Returned label strings: `"good"`, `"dead"`, `"noise"`, `"out"` (for
  `"coherence+psd"`); only `"good"` and `"noise"` for `"std"` / `"mad"` /
  `"neighborhood_r2"`.

### detect_and_remove_bad_channels / DetectAndRemoveBadChannelsRecording

Runs `detect_bad_channels` and returns a `ChannelSliceRecording` with those channels
removed.

```python
DetectAndRemoveBadChannelsRecording(
    parent_recording: BaseRecording,
    bad_channel_ids=None,
    channel_labels=None,
    **detect_bad_channels_kwargs,
)
```

### interpolate_bad_channels / InterpolateBadChannelsRecording

Kriging-style Gaussian-kernel interpolation from good channels. Requires channel
locations in **µm**.

```python
InterpolateBadChannelsRecording(
    recording,
    bad_channel_ids,
    sigma_um=None,
    p=1.3,
    weights=None,
)
```

- `sigma_um=None` → most common y-spacing on the probe.

### detect_and_interpolate_bad_channels / DetectAndInterpolateBadChannelsRecording

```python
DetectAndInterpolateBadChannelsRecording(
    recording: BaseRecording,
    bad_channel_ids=None,
    **detect_bad_channels_kwargs,
)
```
