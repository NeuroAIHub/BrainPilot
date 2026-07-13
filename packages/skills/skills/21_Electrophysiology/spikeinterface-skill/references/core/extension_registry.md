# Built-in extension registry
Source in repo: `spikeinterface/src/spikeinterface/core/sortinganalyzer.py`
Parent index: [INDEX.md](INDEX.md)
Related: [analyzer_extensions.md](analyzer_extensions.md), [sorting_analyzer_class_a.md](sorting_analyzer_class_a.md)
---

## 8. Built-in extension registry

`_builtin_extensions` in `sortinganalyzer.py` (line 3196) — extension name → providing module:

| Extension name | Module |
|---|---|
| `"random_spikes"` | `spikeinterface.core` |
| `"waveforms"` | `spikeinterface.core` |
| `"templates"` | `spikeinterface.core` |
| `"noise_levels"` | `spikeinterface.core` |
| `"amplitude_scalings"` | `spikeinterface.postprocessing` |
| `"correlograms"` | `spikeinterface.postprocessing` |
| `"auto_correlograms"` | `spikeinterface.postprocessing` |
| `"isi_histograms"` | `spikeinterface.postprocessing` |
| `"principal_components"` | `spikeinterface.postprocessing` |
| `"spike_amplitudes"` | `spikeinterface.postprocessing` |
| `"spike_locations"` | `spikeinterface.postprocessing` |
| `"template_similarity"` | `spikeinterface.postprocessing` |
| `"unit_locations"` | `spikeinterface.postprocessing` |
| `"valid_unit_periods"` | `spikeinterface.postprocessing` |
| `"quality_metrics"` | `spikeinterface.metrics` |
| `"template_metrics"` | `spikeinterface.metrics` |
| `"spiketrain_metrics"` | `spikeinterface.metrics` |

Related helpers exported from `sortinganalyzer.py`:
- `get_available_analyzer_extensions() -> list[str]` — returns `list(_builtin_extensions.keys())`.
- `get_default_analyzer_extension_params(extension_name: str) -> dict` — inspects the `_set_params` signature of the registered class.
- `get_extension_class(extension_name: str, auto_import: bool = True)` — resolves and imports the module if necessary; returns the extension class.
- `register_result_extension(extension_class)` — used by plugin modules to register their extensions at import time.
