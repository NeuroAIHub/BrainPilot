# spike_locations — ComputeSpikeLocations
Source in repo: `spikeinterface/src/spikeinterface/postprocessing/spike_locations.py`
Parent index: [INDEX.md](INDEX.md)
---

## spike_locations — ComputeSpikeLocations

- extension name: `"spike_locations"`
- Compute class: `ComputeSpikeLocations(BaseSpikeVectorExtension)`
- depends on: `["templates"]`
- exposes `nodepipeline_variables = ["spike_locations"]`
- `need_backward_compatibility_on_load = True` (renames legacy `spike_retriver_kwargs` → `spike_retriever_kwargs`, strips legacy `peak_sign` from nested dict)
- Source: `src/spikeinterface/postprocessing/spike_locations.py`

Parameters (from `_set_params`):

```python
def _set_params(
    self,
    ms_before=0.5,
    ms_after=0.5,
    spike_retriever_kwargs=None,
    method="center_of_mass",
    method_kwargs={},
):
```

- `ms_before`: `float`, default `0.5` — left window in ms.
- `ms_after`: `float`, default `0.5` — right window in ms.
- `spike_retriever_kwargs`: `dict | None`, default `None` (becomes `{}`). Forwarded to the underlying `SpikeRetriever` (with `channel_from_template=True` always added).
- `method`: `"center_of_mass" | "monopolar_triangulation" | "grid_convolution"`, default `"center_of_mass"`. These match the localization methods used through `spikeinterface.sortingcomponents.peak_localization.get_localization_pipeline_nodes`. Note that `spike_locations` does **not** accept the `"max_channel"` method (unlike `unit_locations`).
- `method_kwargs`: `dict`, default `{}`. Forwarded to the chosen method (see the parameters of `compute_center_of_mass`, `compute_monopolar_triangulation`, `compute_grid_convolution` in the Localization tools section below).

Public convenience function:
```python
compute_spike_locations = ComputeSpikeLocations.function_factory()
```

Recommended usage:

```python
analyzer.compute("spike_locations", ms_before=0.5, ms_after=0.5,
                 method="monopolar_triangulation",
                 method_kwargs={"radius_um": 75, "optimizer": "least_square"})
locs = analyzer.get_extension("spike_locations").get_data()
```
