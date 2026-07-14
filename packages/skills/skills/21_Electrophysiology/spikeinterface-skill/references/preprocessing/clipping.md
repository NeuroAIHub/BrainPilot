# Clipping & saturation blanking
Source in repo: `spikeinterface/src/spikeinterface/preprocessing/clip.py`
Parent index: [INDEX.md](INDEX.md)
---

## Clipping & saturation blanking

### clip / ClipRecording

```python
ClipRecording(recording, a_min=None, a_max=None)
```

- `a_min=None` disables lower clip; `a_max=None` disables upper clip.

### blank_saturation / BlankSaturationRecording

Detects extreme values using an absolute or quantile threshold and replaces them with
`fill_value` (default: median).

```python
BlankSaturationRecording(
    recording,
    abs_threshold=None,
    quantile_threshold=None,
    direction="upper",
    fill_value=None,
    num_chunks_per_segment=50,
    chunk_size=500,
    seed=0,
)
```

- `direction` ∈ {`"upper"`, `"lower"`, `"both"`}.
- `quantile_threshold` in `[0, 1]`; required when `abs_threshold` is None.

### rectify / RectifyRecording

`|traces|`. No parameters.

```python
RectifyRecording(recording)
```
