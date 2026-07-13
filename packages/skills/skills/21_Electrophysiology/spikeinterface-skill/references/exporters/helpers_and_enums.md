# Helpers and Enums
Source in repo: `spikeinterface/src/spikeinterface/exporters/to_ibl.py`
Parent index: [INDEX.md](INDEX.md)
---

## Module-level helpers referenced in the public API

### `compute_rms` (used by `export_to_ibl_gui`)

Module-level helper defined in `spikeinterface/exporters/to_ibl.py`. Not re-exported from `spikeinterface.exporters.__init__`, but invoked internally by `export_to_ibl_gui` to build the AP-band and LFP `_iblqc_ephysTimeRms*` arrays. The wrapping executor internals (`_init_rms_worker`, `_compute_rms_chunk`) are private worker functions and are not part of the public surface.

#### Signature (verbatim from source)

```python
def compute_rms(
    recording: BaseRecording,
    verbose: bool = False,
    **job_kwargs,
):
```

#### Parameters (verbatim from docstring)

- `recording: BaseRecording` — The recording object to compute the RMS for.
- `**job_kwargs` — Shared job kwargs (`n_jobs`, `chunk_duration`, `progress_bar`, `mp_context`, `max_threads_per_worker`, etc.). When called by `export_to_ibl_gui`, `chunk_duration` is set to `f"{rms_win_length_s}s"`.

#### Returns

- `rms_values : np.ndarray` — shape `(num_chunks, num_channels)`; RMS per channel per chunk.
- `rms_times : np.ndarray` — shape `(num_chunks,)`; middle-of-chunk time in seconds.

---

## Enum / Literal parameter values

### `template_mode` in `export_to_phy`

Passed as `operator=template_mode` to `templates_ext.get_templates(...)`. The `templates` extension (`spikeinterface/core/analyzer_extension_core.py`) enforces the following string operators in `_set_params` and rejects any other:

- `"average"` (default for `template_mode`; also always stored by default)
- `"std"` (also always stored by default)
- `"median"`
- `"mad"`

The `templates` extension also accepts a `("percentile", <value>)` tuple form as an operator, but `template_mode` in `export_to_phy` is typed as `str`, so only the four string operators above are usable here. Only operators that were actually requested when computing the `"templates"` extension are available at export time — the default computation stores only `"average"` and `"std"`, so requesting `"median"` or `"mad"` requires computing them beforehand (e.g. `analyzer.compute("templates", operators=["average", "std", "median", "mad"])`).

### `remove_if_exists` (bool, all four functions)

`export_to_phy`, `export_to_ibl_gui`, `export_report` each expose `remove_if_exists: bool = False`. `to_pynapple_tsgroup` does not take this parameter (it writes no output folder).

- `False` (default) — if `output_folder` already exists, a `FileExistsError` is raised.
- `True` — if `output_folder` exists, it is removed via `shutil.rmtree(output_folder)` and recreated.

### `peak_sign` in exporters

None of the four exporter functions accept a `peak_sign` parameter. `export_to_phy`, `export_report`, `export_to_ibl_gui`, and `to_pynapple_tsgroup` all rely on the underlying extensions (`"templates"`, `"spike_amplitudes"`, `"template_metrics"`, `"quality_metrics"`) which may themselves have been computed with a `peak_sign` — but that choice is made when computing the extensions, not at export time.

### `format` in `export_report`

Any format handled by matplotlib's `Figure.savefig` (documented in the docstring as "any format handled by matplotlib"). Standard matplotlib-supported values:

- `"png"` (default)
- `"pdf"`
- `"svg"`
- `"svgz"`
- `"jpg"`
- `"jpeg"`
- `"tif"`
- `"tiff"`
- `"ps"`
- `"eps"`
- `"pgf"`
- `"raw"`
- `"rgba"`
- `"webp"`

Availability of each format depends on the matplotlib backend/build installed in your environment.

---

## Required SortingAnalyzer extensions (summary)

| Exporter | Strictly required | Auto-computed if missing | Optional (used if present) |
|---|---|---|---|
| `export_to_phy` | `"templates"` | `"template_similarity"`; `"spike_amplitudes"` (if `compute_amplitudes=True`); `"principal_components"` (if `compute_pc_features=True`, with `n_components=5, mode="by_channel_local"`) | `"quality_metrics"` (when `add_quality_metrics=True`), `"template_metrics"` (when `add_template_metrics=True`) |
| `export_to_ibl_gui` | `"templates"`, `"spike_amplitudes"`, `"quality_metrics"` (with columns referenced by `good_units_query`) | — | `"spike_locations"`, `"template_metrics"` |
| `to_pynapple_tsgroup` | — | — | `"unit_locations"`, `"quality_metrics"`, `"template_metrics"` (only when passed a `SortingAnalyzer` with `attach_unit_metadata=True`) |
| `export_report` | — | `"unit_locations"`; and (when `force_computation=True`) `"spike_amplitudes"`, `"quality_metrics"`, `"correlograms"` (with `window_ms=100.0, bin_ms=1.0`) | `"spike_amplitudes"`, `"quality_metrics"`, `"correlograms"` |
