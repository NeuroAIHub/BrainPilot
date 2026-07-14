# Whitening
Source in repo: `spikeinterface/src/spikeinterface/preprocessing/whiten.py`
Parent index: [INDEX.md](INDEX.md)
---

## Whitening

### whiten / WhitenRecording

ZCA whitening.

```python
WhitenRecording(
    recording,
    dtype=None,
    apply_mean=False,
    regularize=False,
    regularize_kwargs=None,
    mode="global",
    radius_um=100.0,
    int_scale=None,
    eps=None,
    W=None,
    M=None,
    **random_chunk_kwargs,
)
```

- `mode` ∈ {`"global"` (SVD of full covariance), `"local"` (per-channel SVD restricted
  to channels within `radius_um` µm)}.
- `regularize=True` requires `apply_mean=True`. When regularising, the sklearn
  covariance class is chosen via `regularize_kwargs["method"]` (default
  `"GraphicalLassoCV"`); `assume_centered` is forced to `True`.
- `eps=None` → auto (1e-8 or ~median(data²)·1e-3 when data is small).
- `W`, `M`: precomputed whitening matrix / mean matrix.
- `_precomputable_kwarg_names = ["W", "M"]`.

### compute_whitening_matrix

Low-level helper returning `(W, M)`.

```python
compute_whitening_matrix(
    recording, mode, random_chunk_kwargs, apply_mean,
    radius_um=None, eps=None, regularize=False, regularize_kwargs=None,
)
```
