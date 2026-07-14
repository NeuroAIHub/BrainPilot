# SpikeInterface Postprocessing Extensions Reference — Index

All extensions attach to a `SortingAnalyzer` and are computed via
`analyzer.compute("<extension_name>", **params)` (or the standalone
`compute_*` convenience functions listed under each extension). Parameter
signatures below are copied verbatim from the corresponding
`_set_params(...)` / `_run(...)` methods in the source tree at
`src/spikeinterface/postprocessing/`.

Every extension named here is one of the classes actually registered by
`register_result_extension(...)` inside `postprocessing/`, and every
`compute_*` convenience function is one of the callables exposed by
`postprocessing/__init__.py`. Same-named parameters that appear in
different extensions (`method`, `mode`, `fast_mode`, `peak_sign`,
`feature`, `support`, `period_mode`, ...) are enumerated separately
under each extension / function.

Notes on canonical names:
- Localization method dict `_unit_location_methods` (localization_tools.py) has keys `"center_of_mass"`, `"grid_convolution"`, `"monopolar_triangulation"`, `"max_channel"`. There is **no** `"peak_channel"` key in this dispatch dict — the max-channel method is registered under `"max_channel"`. (The unrelated `dtype_localize_by_method` dict in `unit_locations.py` does define a `"peak_channel"` entry for legacy dtype lookups, but it is not a callable method.)
- `spike_locations` docstring lists `"center_of_mass" | "monopolar_triangulation" | "grid_convolution"`; `unit_locations` supports the additional `"max_channel"` method.

## Leaf files

- [amplitude_scalings.md](amplitude_scalings.md) — `ComputeAmplitudeScalings` (extension `"amplitude_scalings"`)
- [correlograms.md](correlograms.md) — `ComputeCorrelograms`, `ComputeAutoCorrelograms`, `ComputeACG3D` (extensions `"correlograms"`, `"auto_correlograms"`, `"acgs_3d"`)
- [isi_histograms.md](isi_histograms.md) — `ComputeISIHistograms` (extension `"isi_histograms"`)
- [spike_amplitudes.md](spike_amplitudes.md) — `ComputeSpikeAmplitudes` (extension `"spike_amplitudes"`)
- [spike_locations.md](spike_locations.md) — `ComputeSpikeLocations` (extension `"spike_locations"`)
- [unit_locations.md](unit_locations.md) — `ComputeUnitLocations` (extension `"unit_locations"`)
- [principal_components.md](principal_components.md) — `ComputePrincipalComponents` (extension `"principal_components"`)
- [template_metrics_deprecated.md](template_metrics_deprecated.md) — `ComputeTemplateMetrics` deprecated re-export (extension `"template_metrics"`)
- [template_similarity.md](template_similarity.md) — `ComputeTemplateSimilarity` (extension `"template_similarity"`)
- [noise_levels.md](noise_levels.md) — `ComputeNoiseLevels` (extension `"noise_levels"`)
- [valid_unit_periods.md](valid_unit_periods.md) — `ComputeValidUnitPeriods` (extension `"valid_unit_periods"`)
- [localization_tools.md](localization_tools.md) — Module-level localization functions (`compute_center_of_mass`, `compute_monopolar_triangulation`, `compute_grid_convolution`, `compute_location_max_channel`, `get_convolution_weights`)
- [align_sorting.md](align_sorting.md) — `align_sorting` / `AlignSortingExtractor`
- [dependency_graph.md](dependency_graph.md) — Extension dependency graph + full registry of extensions and public `compute_*` functions

## Extension → file map

| extension | leaf file |
| --- | --- |
| `"amplitude_scalings"` | amplitude_scalings.md |
| `"correlograms"` | correlograms.md |
| `"auto_correlograms"` | correlograms.md |
| `"acgs_3d"` | correlograms.md |
| `"isi_histograms"` | isi_histograms.md |
| `"spike_amplitudes"` | spike_amplitudes.md |
| `"spike_locations"` | spike_locations.md |
| `"unit_locations"` | unit_locations.md |
| `"principal_components"` | principal_components.md |
| `"template_metrics"` | template_metrics_deprecated.md |
| `"template_similarity"` | template_similarity.md |
| `"noise_levels"` | noise_levels.md |
| `"valid_unit_periods"` | valid_unit_periods.md |
