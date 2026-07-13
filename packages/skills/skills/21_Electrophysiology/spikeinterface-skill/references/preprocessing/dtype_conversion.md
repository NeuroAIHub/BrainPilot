# dtype conversion & LSB correction
Source in repo: `spikeinterface/src/spikeinterface/preprocessing/astype.py`
Parent index: [INDEX.md](INDEX.md)
---

## dtype conversion

### astype / AstypeRecording

`numpy.astype` analogue.

```python
AstypeRecording(
    recording,
    dtype=None,
    round: bool | None = None,
)
```

- `round=None` → auto = `True` for integer dtypes.
- Class attribute: `name = "astype"`.

### unsigned_to_signed / UnsignedToSignedRecording

Convert `uint*` → matching `int*`. `bit_depth` (e.g. 12) can override the storage bit
depth when computing the offset.

```python
UnsignedToSignedRecording(recording, bit_depth=None)
```

---

## LSB correction

### correct_lsb

Estimates the LSB (least significant bit) of the recording as the mode of the
per-channel LSBs, centers by per-channel median, then divides by the LSB. Returns a
chain of `ScaleRecording`s.

```python
correct_lsb(
    recording,
    num_chunks_per_segment=20,
    chunk_size=10000,
    seed=None,
    verbose=False,
)
```
