# noise_levels — ComputeNoiseLevels
Source in repo: `spikeinterface/src/spikeinterface/postprocessing/noise_level.py`
Parent index: [INDEX.md](INDEX.md)
---

## noise_levels — ComputeNoiseLevels

- extension name: `"noise_levels"`
- Compute class: `ComputeNoiseLevels(AnalyzerExtension)` — defined in `spikeinterface.core.analyzer_extension_core` and re-exported from `spikeinterface.postprocessing.noise_level` (and hence `spikeinterface.postprocessing`) for backward compatibility.
- depends on: `[]`, `need_recording=True`, `use_nodepipeline=False`, `need_job_kwargs=True`
- `need_backward_compatibility_on_load = True` (migrates legacy per-parameter random-slice keys into `random_slices_kwargs`)
- Sources: `src/spikeinterface/postprocessing/noise_level.py` (re-export), `src/spikeinterface/core/analyzer_extension_core.py` (implementation)

Parameters (from `_set_params`):

```python
def _set_params(self, **noise_level_params):
    params = noise_level_params.copy()
    return params
```

All `noise_level_params` are forwarded to the underlying `spikeinterface.core.get_noise_levels(recording, ...)`, whose signature is:

```python
def get_noise_levels(
    recording: "BaseRecording",
    return_scaled: bool | None = None,     # DEPRECATED alias for return_in_uV
    return_in_uV: bool = True,
    method: Literal["mad", "std", "rms"] = "mad",
    force_recompute: bool = False,
    random_slices_kwargs: dict = {},
    **kwargs,
)
```

- `return_scaled`: `bool | None`, default `None`. Deprecated alias for `return_in_uV`.
- `return_in_uV`: `bool`, default `True`.
- `method`: `"mad" | "std" | "rms"`, default `"mad"`.
- `force_recompute`: `bool`, default `False`.
- `random_slices_kwargs`: `dict`, default `{}` — keys such as `num_chunks_per_segment`, `chunk_size`, `seed` are passed to `get_random_sample_slices()`.

The legacy call `get_noise_levels(recording, num_chunks_per_segment=20, chunk_size=1000, seed=...)` still works but issues a deprecation warning; the new form is:

```python
random_slices_kwargs=dict(num_chunks_per_segment=20, chunk_size=1000, seed=0)
```

`ComputeNoiseLevels._handle_backward_compatibility_on_load` migrates the older per-parameter keys (`num_chunks_per_segment`, `chunk_size`, `seed`) into `random_slices_kwargs` automatically.

Public convenience function:
```python
compute_noise_levels = ComputeNoiseLevels.function_factory()
```

Recommended usage:

```python
analyzer.compute(
    "noise_levels",
    method="mad",
    random_slices_kwargs=dict(num_chunks_per_segment=20, chunk_size=10000, seed=0),
)
noise_levels = analyzer.get_extension("noise_levels").get_data()
```
