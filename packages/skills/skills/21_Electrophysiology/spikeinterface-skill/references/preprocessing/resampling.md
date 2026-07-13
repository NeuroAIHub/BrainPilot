# Sample-rate manipulation
Source in repo: `spikeinterface/src/spikeinterface/preprocessing/resample.py`
Parent index: [INDEX.md](INDEX.md)
---

## Sample-rate manipulation

### resample / ResampleRecording

Anti-aliased resampling (`scipy.signal.decimate` when the ratio is integer,
`scipy.signal.resample` otherwise).

```python
ResampleRecording(
    recording,
    resample_rate,
    gap_tolerance_ms=None,
    margin_ms=100.0,
    dtype=None,
    skip_checks=False,
)
```

- `resample_rate`: int (Hz), asserted with `isinstance(..., (int, np.integer))`.
- `gap_tolerance_ms=None` → error on any timestamp gap ≥ 1.5 sample periods;
  set a value (ms) to enable section-wise resampling.
- `skip_checks=True` skips the Nyquist / cutoff safety check.

### decimate / DecimateRecording

Pure slice-decimation (no anti-aliasing filter). Consider `resample` when Nyquist
safety is needed.

```python
DecimateRecording(
    recording,
    decimation_factor,
    decimation_offset=0,
)
```

- `decimation_factor`: strictly positive int.
- `decimation_offset < decimation_factor` and `< num samples`.
