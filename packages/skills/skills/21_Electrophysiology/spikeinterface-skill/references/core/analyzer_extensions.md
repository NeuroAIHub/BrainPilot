# Core AnalyzerExtension classes
Source in repo: `spikeinterface/src/spikeinterface/core/analyzer_extension_core.py`
Parent index: [INDEX.md](INDEX.md)
Related: [sorting_analyzer_class_a.md](sorting_analyzer_class_a.md), [extension_registry.md](extension_registry.md), [templates_class.md](templates_class.md)
---

## 5. Core AnalyzerExtension classes

### Name → CamelCase class mapping (core extensions)

| Extension name | Class | Depends on | Needs recording | Uses node pipeline | Needs job_kwargs |
|---|---|---|---|---|---|
| `"random_spikes"` | `ComputeRandomSpikes` | `[]` | False | False | False |
| `"waveforms"` | `ComputeWaveforms` | `["random_spikes"]` | True | False | True |
| `"templates"` | `ComputeTemplates` | `["random_spikes|waveforms"]` | False | False | True |
| `"noise_levels"` | `ComputeNoiseLevels` | `[]` | True | False | True |

Other extensions (`amplitude_scalings`, `correlograms`, `auto_correlograms`, `isi_histograms`, `principal_components`, `spike_amplitudes`, `spike_locations`, `template_similarity`, `unit_locations`, `valid_unit_periods`, `quality_metrics`, `template_metrics`, `spiketrain_metrics`) are provided by the `spikeinterface.postprocessing` and `spikeinterface.metrics` modules (see extension_registry.md).

---

### `ComputeRandomSpikes` — `_default_params` (from `_set_params` signature)

```python
def _set_params(
    self, method="uniform", max_spikes_per_unit=500, margin_size=None, seed=None,
    percentage=None, maximum_rate=None,
):
```

Parameters:
- `method`: `"uniform" | "percentage" | "maximum_rate" | "all"` (default `"uniform"`).
- `max_spikes_per_unit: int = 500` — ignored if `method="all"`.
- `margin_size: int | None = None` — border margin, ignored if `method="all"`.
- `seed: int | None = None`.
- `percentage: float | None = None` — for `method="percentage"`.
- `maximum_rate: float | None = None` — for `method="maximum_rate"`.

Extra methods on the instance: `get_random_spikes()`, `get_selected_indices_in_spike_train(unit_id, segment_index)`.

Data produced: `data["random_spikes_indices"]` (indices into `sorting.to_spike_vector()`).

---

### `ComputeWaveforms` — `_default_params`

```python
def _set_params(
    self,
    ms_before: float = 1.0,
    ms_after: float = 2.0,
    dtype=None,
):
```

Parameters:
- `ms_before: float = 1.0` — ms to extract before spike.
- `ms_after: float = 2.0` — ms to extract after spike.
- `dtype: None | dtype = None` — if `None`, uses recording dtype (integer dtypes are promoted to `"float32"` if `return_in_uV` is True).

Instance properties: `nbefore`, `nafter`.

Extra methods: `get_waveforms_one_unit(unit_id, force_dense: bool = False)`.

Data produced: `data["waveforms"]` — shape `(num_random_spikes, num_samples, num_channels)`.

---

### `ComputeTemplates` — `_default_params`

```python
def _set_params(self, ms_before: float = 1.0, ms_after: float = 2.0, operators=None):
```

- `ms_before: float = 1.0`.
- `ms_after: float = 2.0`.
- `operators: list | None = None` — defaults to `["average", "std"]`. Allowed string operators: `"average" | "std" | "median" | "mad"`. Also accepts `("percentile", <float>)` tuples.

Note: when `waveforms` is already computed, `ms_before` / `ms_after` are overridden from that extension.

Extra methods: `get_templates(unit_ids=None, operator="average", percentile=None, save=True, outputs="numpy")` (with `outputs: "numpy" | "Templates"`), `get_unit_template(unit_id, operator="average")`.

Data produced: keys `"average"`, `"std"`, `"median"`, `"mad"`, `"percentile_<value>"` — each with shape `(num_units, num_samples, num_channels)`.

---

### `ComputeNoiseLevels` — `_default_params`

```python
def _set_params(self, **noise_level_params):
    params = noise_level_params.copy()
    return params
```

No explicit defaults — all kwargs are forwarded to `spikeinterface.core.get_noise_levels(recording)`. Historical parameters (auto-migrated on load): `num_chunks_per_segment=20`, `chunk_size=10000`, `seed=None` — these are now grouped under `random_slices_kwargs`.

Data produced: `data["noise_levels"]` — per-channel noise vector.
