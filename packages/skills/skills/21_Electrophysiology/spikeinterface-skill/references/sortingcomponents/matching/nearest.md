# Template matching — nearest and nearest-svd

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/matching/nearest.py`
Parent index: [../INDEX.md](../INDEX.md)

---

### `nearest` — `NearestTemplatesPeeler`

Class attributes: `name = "nearest"`, `need_noise_levels = True`,
`need_first_call_before_pipeline = True`.

```python
NearestTemplatesPeeler(
    recording,
    templates,
    return_output=True,
    peak_sign="neg",
    exclude_sweep_ms=0.8,
    detect_threshold=5,
    noise_levels=None,
    detection_radius_um=100.0,
    neighborhood_radius_um=50.0,
    sparsity_radius_um=100.0,
)
```

- `peak_sign : "neg" | "pos" | "both"`, default `"neg"`.
- `exclude_sweep_ms : float`, default `0.8`.
- `detect_threshold : float`, default `5`.
- `noise_levels : array | None`, default `None` (required for use).
- `detection_radius_um : float`, default `100.0`.
- `neighborhood_radius_um : float`, default `50.0`.
- `sparsity_radius_um : float`, default `100.0`.
- `return_output : bool`, default `True`.

### `nearest-svd` — `NearestTemplatesSVDPeeler`

Class attributes: `name = "nearest-svd"`, `need_noise_levels = True`.
Inherits from `NearestTemplatesPeeler`.

```python
NearestTemplatesSVDPeeler(
    recording,
    templates,
    svd_model,
    return_output=True,
    peak_sign="neg",
    exclude_sweep_ms=0.8,
    detect_threshold=5,
    noise_levels=None,
    detection_radius_um=100.0,
    neighborhood_radius_um=50.0,
    sparsity_radius_um=100.0,
)
```

- `svd_model` (positional, required) — pre-fit SVD model used to project
  waveforms.
- All other parameters are identical to `NearestTemplatesPeeler` and have
  the same defaults.
- (The `params_doc` string mentions `svd_radius_um` but that name does NOT
  appear in `__init__`.)
