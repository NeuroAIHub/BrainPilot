# Peak detection — locally_exclusive variants

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/peak_detection/locally_exclusive.py`
Parent index: [../INDEX.md](../INDEX.md)

---

### `locally_exclusive` — `LocallyExclusivePeakDetector`

Class attributes: `name = "locally_exclusive"`, `engine = "numba"`,
`need_noise_levels = True`, `preferred_mp_context = None`,
`need_first_call_before_pipeline = True`.

```python
LocallyExclusivePeakDetector(
    recording,
    peak_sign="neg",
    detect_threshold=5,
    exclude_sweep_ms=1.0,
    radius_um=50,
    noise_levels=None,
    return_output=True,
)
```

- `peak_sign : "neg" | "pos" | "both"`, default `"neg"`.
- `detect_threshold : float`, default `5`.
- `exclude_sweep_ms : float`, default `1.0`.
- `radius_um : float`, default `50` — radius (um) selecting neighbour
  channels for spatial deduplication.
- `noise_levels : array | None`, default `None`.
- `return_output : bool`, default `True`.

Requires `numba`.

### `locally_exclusive_torch` — `LocallyExclusiveTorchPeakDetector`

Class attributes: `name = "locally_exclusive_torch"`, `engine = "torch"`,
`need_noise_levels = True`, `preferred_mp_context = "spawn"`.

```python
LocallyExclusiveTorchPeakDetector(
    recording,
    peak_sign="neg",
    detect_threshold=5,
    exclude_sweep_ms=1.0,
    noise_levels=None,
    device=None,
    radius_um=50,
    return_tensor=False,
    return_output=True,
)
```

- `peak_sign : "neg" | "pos" | "both"`, default `"neg"`.
- `detect_threshold : float`, default `5`.
- `exclude_sweep_ms : float`, default `1.0`.
- `noise_levels : array | None`, default `None`.
- `device : str | None`, default `None`.
- `radius_um : float`, default `50`.
- `return_tensor : bool`, default `False`.
- `return_output : bool`, default `True`.

### `locally_exclusive_cl` — `LocallyExclusiveOpenCLPeakDetector`

Class attributes: `name = "locally_exclusive_cl"`, `engine = "opencl"`,
`preferred_mp_context = None`, `need_noise_levels = True`.

```python
LocallyExclusiveOpenCLPeakDetector(
    recording,
    peak_sign="neg",
    detect_threshold=5,
    exclude_sweep_ms=1.0,
    radius_um=50,
    noise_levels=None,
    opencl_context_kwargs={},
)
```

- `peak_sign : "neg" | "pos" | "both"`, default `"neg"`.
- `detect_threshold : float`, default `5`.
- `exclude_sweep_ms : float`, default `1.0`.
- `radius_um : float`, default `50`.
- `noise_levels : array | None`, default `None`.
- `opencl_context_kwargs : dict`, default `{}`.

Note: this class does NOT accept `return_output` in its signature.
Requires `pyopencl`.
