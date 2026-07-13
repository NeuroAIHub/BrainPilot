# Extension dependency graph & full extension registry
Source in repo: `spikeinterface/src/spikeinterface/postprocessing/__init__.py`
Parent index: [INDEX.md](INDEX.md)
---

## Extension dependency graph

Reproduced from each `Compute...` class's `depend_on` attribute (from the `postprocessing` module, plus core prerequisites `"random_spikes"` and `"waveforms"` when relevant):

| extension | depends on |
| --- | --- |
| `amplitude_scalings` | `["templates"]` (plus `sparse` on analyzer or `max_dense_channels`) |
| `correlograms` | `[]` |
| `auto_correlograms` | `[]` |
| `acgs_3d` | `[]` |
| `isi_histograms` | `[]` |
| `spike_amplitudes` | `["templates"]` |
| `spike_locations` | `["templates"]` |
| `unit_locations` | `["templates"]` |
| `principal_components` | `["random_spikes", "waveforms"]` |
| `template_metrics` | `["templates"]` |
| `template_similarity` | `["templates"]` |
| `noise_levels` | `[]` (needs recording) |
| `valid_unit_periods` | `[]` (needs `"amplitude_scalings"` when `method in {"false_positives_and_negatives", "combined"}`) |

Typical bootstrapping pipeline:

```python
analyzer = create_sorting_analyzer(sorting, recording, sparse=True)
analyzer.compute([
    "random_spikes",
    "waveforms",
    "templates",
    "noise_levels",
])
analyzer.compute([
    "spike_amplitudes",
    "amplitude_scalings",
    "spike_locations",
    "unit_locations",
    "template_similarity",
    "template_metrics",
    "correlograms",
    "isi_histograms",
    "principal_components",
])
```

---

## Complete list of registered extensions and public compute_* functions

For quick reference — every class in `postprocessing/` that calls
`register_result_extension(...)`, plus the two extensions re-exported
via the `postprocessing` namespace but defined elsewhere:

| `extension_name` | class | source file |
| --- | --- | --- |
| `"amplitude_scalings"` | `ComputeAmplitudeScalings` | `amplitude_scalings.py` |
| `"correlograms"` | `ComputeCorrelograms` | `correlograms.py` |
| `"auto_correlograms"` | `ComputeAutoCorrelograms` | `correlograms.py` |
| `"acgs_3d"` | `ComputeACG3D` | `correlograms.py` |
| `"isi_histograms"` | `ComputeISIHistograms` | `isi.py` |
| `"spike_amplitudes"` | `ComputeSpikeAmplitudes` | `spike_amplitudes.py` |
| `"spike_locations"` | `ComputeSpikeLocations` | `spike_locations.py` |
| `"unit_locations"` | `ComputeUnitLocations` | `unit_locations.py` |
| `"principal_components"` | `ComputePrincipalComponents` | `principal_component.py` |
| `"template_similarity"` | `ComputeTemplateSimilarity` | `template_similarity.py` |
| `"valid_unit_periods"` | `ComputeValidUnitPeriods` | `valid_unit_periods.py` |
| `"noise_levels"` | `ComputeNoiseLevels` | defined in `core.analyzer_extension_core`, re-exported via `noise_level.py` |
| `"template_metrics"` | `ComputeTemplateMetrics` | defined in `metrics.template.template_metrics`, re-exported via `template_metrics.py` with a deprecation warning |

Every `compute_*` convenience function exposed by
`postprocessing/__init__.py`:

- `compute_amplitude_scalings` (from `amplitude_scalings.py`)
- `compute_correlograms` (from `correlograms.py`)
- `compute_auto_correlograms` (from `correlograms.py`)
- `compute_acgs_3d` (from `correlograms.py`)
- `compute_isi_histograms` (from `isi.py`)
- `compute_isi_histograms_numpy` (from `isi.py`)
- `compute_isi_histograms_numba` (from `isi.py`)
- `compute_spike_amplitudes` (from `spike_amplitudes.py`)
- `compute_spike_locations` (from `spike_locations.py`)
- `compute_unit_locations` (from `unit_locations.py`)
- `compute_principal_components` (from `principal_component.py`)
- `compute_template_similarity` (from `template_similarity.py`)
- `compute_template_similarity_by_pair` (from `template_similarity.py`)
- `compute_noise_levels` (from `noise_level.py`, defined in `core.analyzer_extension_core`)
- `compute_template_metrics` (deprecated re-export from `template_metrics.py`)
- `compute_valid_unit_periods` (from `valid_unit_periods.py`)

Additional helpers re-exported from `postprocessing/__init__.py` (not
themselves `compute_*` functions but frequently used alongside them):

- `correlogram_for_one_segment`, `auto_correlogram_for_one_segment`
- `check_equal_template_with_distribution_overlap`
- `align_sorting`, `AlignSortingExtractor`
