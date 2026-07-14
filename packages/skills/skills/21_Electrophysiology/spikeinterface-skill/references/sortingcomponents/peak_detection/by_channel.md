# Peak detection — by_channel and by_channel_torch

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/peak_detection/by_channel.py`
Parent index: [../INDEX.md](../INDEX.md)

---

### `by_channel` — `ByChannelPeakDetector`

Class attributes: `name = "by_channel"`, `engine = "numpy"`,
`need_noise_levels = True`, `preferred_mp_context = None`.

```python
ByChannelPeakDetector(
    recording,
    peak_sign="neg",
    detect_threshold=5,
    exclude_sweep_ms=1.0,
    noise_levels=None,
    return_output=True,
)
```

- `peak_sign : "neg" | "pos" | "both"`, default `"neg"` — validated by
  `assert peak_sign in ("both", "neg", "pos")`.
- `detect_threshold : float`, default `5` — threshold in units of MAD.
- `exclude_sweep_ms : float`, default `1.0` — refractory time (ms).
- `noise_levels : array | None`, default `None` — asserted not-None inside
  `__init__` (the wrapper `detect_peaks()` fills it if missing).
- `return_output : bool`, default `True`.

### `by_channel_torch` — `ByChannelTorchPeakDetector`

Class attributes: `name = "by_channel_torch"`, `engine = "torch"`,
`preferred_mp_context = "spawn"`, `need_noise_levels = True`.

```python
ByChannelTorchPeakDetector(
    recording,
    peak_sign="neg",
    detect_threshold=5,
    exclude_sweep_ms=1.0,
    noise_levels=None,
    device=None,
    return_tensor=False,
    return_output=True,
)
```

- `peak_sign : "neg" | "pos" | "both"`, default `"neg"`.
- `detect_threshold : float`, default `5`.
- `exclude_sweep_ms : float`, default `1.0`.
- `noise_levels : array | None`, default `None`.
- `device : str | None`, default `None` — `"cpu"`, `"cuda"` or `None`
  (auto: cuda if available).
- `return_tensor : bool`, default `False` — return torch tensors instead of
  numpy arrays.
- `return_output : bool`, default `True`.
