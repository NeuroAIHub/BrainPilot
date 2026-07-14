# Template matching — wobble

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/matching/wobble.py`
Parent index: [../INDEX.md](../INDEX.md)

---

### `wobble` — `WobbleMatch`

Class attributes: `name = "wobble"`, `need_noise_levels = False`.

```python
WobbleMatch(
    recording,
    templates,
    return_output=True,
    parameters={},
    engine="numpy",
    torch_device="cpu",
    shared_memory=True,
)
```

- `parameters : dict`, default `{}` — forwarded to `WobbleParameters`
  dataclass. Fields (all with defaults):
  - `amplitude_variance : float = 1`
  - `max_iter : int = 1_000`
  - `jitter_factor : int = 8`
  - `threshold : float = 50`
  - `approx_rank : int = 5`
  - `visibility_threshold : float = 1`
  - `verbose : bool = False`
  - `template_indices2unit_indices : Optional[np.ndarray] = None`
  - `refractory_period_frames : int = 10`
  - `scale_min : float = 0`
  - `scale_max : float = np.inf`
  - `scale_amplitudes : bool = False` (auto-set to
    `amplitude_variance > 0` in `__post_init__`)
  - `engine : str = "numpy"` (`"numpy"`, `"torch"`, `"auto"`)
  - `torch_device : str = "cpu"` (`"cuda"`, `"cpu"`, `None`)
  - `shared_memory : bool = True`
- `engine : str`, default `"numpy"` — asserted in
  `["numpy", "torch", "auto"]`.
- `torch_device : str`, default `"cpu"` — asserted in
  `["cuda", "cpu", None]`.
- `shared_memory : bool`, default `True`.
- `return_output : bool`, default `True`.
