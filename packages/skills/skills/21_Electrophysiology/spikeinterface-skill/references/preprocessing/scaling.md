# Scaling / normalization / centering
Source in repo: `spikeinterface/src/spikeinterface/preprocessing/normalize_scale.py`
Parent index: [INDEX.md](INDEX.md)
---

## Scaling / normalization / centering

### scale / ScaleRecording

`new_traces = traces * gain + offset`.

```python
ScaleRecording(recording, gain=1.0, offset=0.0, dtype="float32")
```

- `gain`, `offset`: scalar or array of shape `(num_channels,)`.

### normalize_by_quantile / NormalizeByQuantileRecording

```python
NormalizeByQuantileRecording(
    recording,
    scale=1.0,
    median=0.0,
    q1=0.01,
    q2=0.99,
    mode="by_channel",
    dtype="float32",
    **random_chunk_kwargs,
)
```

- `mode` ∈ {`"by_channel"`, `"pool_channel"`}.
- `**random_chunk_kwargs` forwarded to `spikeinterface.core.get_random_data_chunks`.

### center / CenterRecording

```python
CenterRecording(
    recording,
    mode="median",
    dtype="float32",
    **random_chunk_kwargs,
)
```

- `mode` ∈ {`"median"`, `"mean"`}.

### zscore / ZScoreRecording

Center then divide by MAD (or by std).

```python
ZScoreRecording(
    recording,
    mode="median+mad",
    gain=None,
    offset=None,
    int_scale=None,
    dtype="float32",
    **random_chunk_kwargs,
)
```

- `mode` ∈ {`"median+mad"`, `"mean+std"`}.
- `int_scale`: multiplier applied to `gain` and `offset` so that integer output is
  scaled (e.g. `int_scale=200`).

### scale_to_uV

```python
scale_to_uV(recording: BasePreprocessor) -> BasePreprocessor
```

Uses the recording's `gain_to_uV` / `offset_to_uV` channel properties (and
`has_scaleable_traces`); returns a `ScaleRecording` in µV, `dtype="float32"`.

### scale_to_physical_units / ScaleToPhysicalUnits

Same idea using `gain_to_physical_unit` / `offset_to_physical_unit` properties (any
physical unit).

```python
ScaleToPhysicalUnits(recording)
```

Class attribute: `name = "recording_in_physical_units"`.
