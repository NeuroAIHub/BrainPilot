# Template matching — circus-omp

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/matching/circus.py`
Parent index: [../INDEX.md](../INDEX.md)

---

### `circus-omp` — `CircusOMPPeeler`

Class attributes: `name = "circus-omp"`, `need_noise_levels = False`.

```python
CircusOMPPeeler(
    recording,
    templates,
    return_output=True,
    amplitudes=[0.6, np.inf],
    stop_criteria="max_failures",
    max_failures=5,
    omp_min_sps=0.1,
    relative_error=5e-5,
    rank=5,
    ignore_inds=[],
    vicinity=2,
    precomputed=None,
    engine="numpy",
    shared_memory=True,
    torch_device="cpu",
)
```

- `amplitudes : list[float]`, default `[0.6, np.inf]` — per-template
  minimum/maximum allowed amplitude scaling.
- `stop_criteria : str`, default `"max_failures"` — asserted in
  `_prepare_templates` to be one of:
  - `"max_failures"`
  - `"omp_min_sps"`
  - `"relative_error"`
- `max_failures : int`, default `5`.
- `omp_min_sps : float`, default `0.1`.
- `relative_error : float`, default `5e-5`.
- `rank : int`, default `5` — SVD rank for template compression.
- `ignore_inds : list[int]`, default `[]`.
- `vicinity : int`, default `2` — modification area around a spike,
  expressed in units of template width.
- `precomputed : dict | None`, default `None` — reuse precomputed SVD /
  overlaps (keys listed in `_more_output_keys`: `"norms"`, `"temporal"`,
  `"spatial"`, `"singular"`, `"units_overlaps"`,
  `"unit_overlaps_indices"`, `"normed_templates"`, `"overlaps"`).
- `engine : str`, default `"numpy"` — asserted in
  `["numpy", "torch", "auto"]`.
- `shared_memory : bool`, default `True`.
- `torch_device : str`, default `"cpu"` — asserted in
  `["cuda", "cpu", None]`.
- `return_output : bool`, default `True`.
