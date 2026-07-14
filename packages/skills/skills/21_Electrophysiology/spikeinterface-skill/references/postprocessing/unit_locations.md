# unit_locations — ComputeUnitLocations
Source in repo: `spikeinterface/src/spikeinterface/postprocessing/unit_locations.py`
Parent index: [INDEX.md](INDEX.md)
---

## unit_locations — ComputeUnitLocations

- extension name: `"unit_locations"`
- Compute class: `ComputeUnitLocations(AnalyzerExtension)`
- depends on: `["templates"]`, `need_recording=False`, `use_nodepipeline=False`, `need_job_kwargs=False`
- `need_backward_compatibility_on_load = True` (older analyzers stored `method_kwargs` as a nested dict; `_handle_backward_compatibility_on_load` flattens it into top-level params)
- Source: `src/spikeinterface/postprocessing/unit_locations.py`

Parameters (from `_set_params`):

```python
def _set_params(self, method="monopolar_triangulation", **method_kwargs):
    params = dict(method=method)
    params.update(method_kwargs)
    return params
```

- `method`: `"monopolar_triangulation" | "center_of_mass" | "grid_convolution" | "max_channel"`, default `"monopolar_triangulation"`. The registry (`_unit_location_methods`) uses the key `"max_channel"` (not `"peak_channel"`).
- `**method_kwargs`: forwarded verbatim to the underlying method function (see [Localization tools](localization_tools.md)).

Return: `unit_locations.shape == (num_units, 2)` for `center_of_mass` / `max_channel`, `(num_units, 3)` for `grid_convolution`, `(num_units, 3)` or `(num_units, 4)` (with `alpha`) for `monopolar_triangulation`.

`ComputeUnitLocations.get_data(outputs="numpy"|"by_unit")` supports a dict-keyed-by-unit_id output.

Public convenience function:
```python
compute_unit_locations = ComputeUnitLocations.function_factory()
```

Recommended usage:

```python
analyzer.compute("unit_locations", method="monopolar_triangulation", radius_um=75)
unit_locs = analyzer.get_extension("unit_locations").get_data()   # (n_units, 3) or 4
locs_by_unit = analyzer.get_extension("unit_locations").get_data(outputs="by_unit")
```
