# export_report
Source in repo: `spikeinterface/src/spikeinterface/exporters/report.py`
Parent index: [INDEX.md](INDEX.md)
---

Exports a SpikeInterface spike sorting summary report (unit summaries, per-unit plots, CSVs). Source: `spikeinterface/exporters/report.py`.

### Signature (verbatim from source)

```python
def export_report(
    sorting_analyzer,
    output_folder,
    remove_if_exists=False,
    format="png",
    show_figures=False,
    force_computation=False,
    **job_kwargs,
):
```

The source signature does NOT include a `peak_sign` parameter — no such parameter exists on `export_report`.

### Parameters (verbatim from docstring)

- `sorting_analyzer : SortingAnalyzer` — A SortingAnalyzer object.
- `output_folder : str` — The output folder where the report files are saved.
- `remove_if_exists : bool, default: False` — If True and the output folder exists, it is removed.
- `format : str, default: "png"` — The output figure format (any format handled by matplotlib). See [format enum values](helpers_and_enums.md#format-in-export_report).
- `show_figures : bool, default: False` — If True, figures are shown. If False, figures are closed after saving.
- `force_computation : bool, default: False` — Force or not some heavy computaion before exporting.
- `**job_kwargs` — Shared job kwargs (`n_jobs`, `chunk_duration`, `progress_bar`, `mp_context`, `max_threads_per_worker`, etc.).

### Behaviour and required extensions

Report content depends on which extensions have been computed:

- **Always computed if missing**: `"unit_locations"` — the function calls `sorting_analyzer.compute("unit_locations")` if not present.
- **Optional (used if present; auto-computed when `force_computation=True`)**:
  - `"spike_amplitudes"` — needed for amplitude distribution figure; when `force_computation=True` is loaded with `get_data(outputs="by_unit")` after `sorting_analyzer.compute("spike_amplitudes", **job_kwargs)`.
  - `"quality_metrics"` — written as `quality metrics.csv`; when `force_computation=True` computed via `sorting_analyzer.compute("quality_metrics")` (no job kwargs).
  - `"correlograms"` — used in per-unit summary; if missing and `force_computation=True`, computed via `compute_correlograms(sorting_analyzer, window_ms=100.0, bin_ms=1.0)`.

If an optional extension is missing and `force_computation=False`, a warning is emitted and that piece of the report is skipped. Verbatim warning strings:

- `"export_report(): spike_amplitudes will not be exported. Use sorting_analyzer.compute('spike_amplitudes') if you want to include them."`
- `"export_report(): quality metrics will not be exported. Use sorting_analyzer.compute('quality_metrics') if you want to include them."`
- `"export_report(): correlograms will not be exported. Use sorting_anlyzer.compute('correlograms') if you want to include them."` (note: `sorting_anlyzer` typo is present in the source string).

### Files written to `output_folder`

- `unit list.csv` (tab-separated) — one row per unit with columns `max_on_channel_id`, `main_channel_id`, `amplitude` (added in that order; index column: `unit_id`). Both channel-id columns are populated from `sorting_analyzer.get_main_channels(outputs="id", with_dict=False)`.
- `unit_locations.<format>`, `unit_depths.<format>`.
- `amplitudes_distribution.<format>` (only if `spike_amplitudes` is truthy AND `len(unit_ids) < 100`).
- `quality metrics.csv` (only if quality metrics available).
- `units/<unit_id>.<format>` — one per-unit summary figure per unit (via `sw.plot_unit_summary`).

### Constraints

- If `output_folder` exists and `remove_if_exists=False`, `FileExistsError` is raised.

### Usage

The docstring contains no example. Minimal usage:

```python
from spikeinterface.exporters import export_report

export_report(
    sorting_analyzer,
    output_folder="si_report",
    format="png",
    remove_if_exists=True,
    force_computation=True,
)
```
