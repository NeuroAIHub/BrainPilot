# Analyzer plots (c): metrics, summaries, and specialty plots

Source in repo: `spikeinterface/src/spikeinterface/widgets/metrics.py`
Parent index: [INDEX.md](INDEX.md)
---

### plot_quality_metrics

Class `QualityMetricsWidget` (from `widgets/quality_metrics.py`, subclass of `MetricsBaseWidget`). Backends inherited from `MetricsBaseWidget`: `matplotlib`, `ipywidgets`, `sortingview`, `figpack`.

```python
QualityMetricsWidget(
    sorting_analyzer: SortingAnalyzer,
    unit_ids=None,
    include_metrics=None,
    skip_metrics=None,
    unit_colors=None,
    hide_unit_selector=False,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | "ipywidgets" | "sortingview" | "figpack" | None`.

Requires the `"quality_metrics"` extension.

### plot_template_metrics

Class `TemplateMetricsWidget` (from `widgets/template_metrics.py`, subclass of `MetricsBaseWidget`). Backends inherited: `matplotlib`, `ipywidgets`, `sortingview`, `figpack`.

```python
TemplateMetricsWidget(
    sorting_analyzer: SortingAnalyzer,
    unit_ids=None,
    include_metrics=None,
    skip_metrics=None,
    unit_colors=None,
    hide_unit_selector=False,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | "ipywidgets" | "sortingview" | "figpack" | None`.

Requires the `"template_metrics"` extension.

`MetricsBaseWidget` (base class in `widgets/metrics.py`, not typically called directly) has:

```python
MetricsBaseWidget(
    metrics,
    sorting,
    unit_ids=None,
    include_metrics=None,
    skip_metrics=None,
    unit_colors=None,
    hide_unit_selector=False,
    include_metrics_data=True,
    backend=None,
    **backend_kwargs,
)
```

### plot_metric_histograms

Class `MetricsHistogramsWidget` (from `widgets/metrics.py`). Backends: `matplotlib`.

```python
MetricsHistogramsWidget(
    sorting_analyzer,
    thresholds: dict | None = None,
    metrics_to_plot: list | None = None,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | None`.

Draws histograms per metric with threshold lines. `thresholds` shape: `{metric_name: {"greater": v, "less": v, "abs": bool}}`. Defaults from `bombcell_get_default_thresholds()` when `thresholds` is `None`.

### plot_unit_summary

Class `UnitSummaryWidget` (from `widgets/unit_summary.py`). Backends: `matplotlib`.

```python
UnitSummaryWidget(
    sorting_analyzer,
    unit_id,
    unit_colors=None,
    sparsity=None,
    subwidget_kwargs=None,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | None`.

`subwidget_kwargs` is a nested dict with these exact keys (matching sub-widget names):

- `"unit_locations"` -> forwarded to `UnitLocationsWidget`
- `"unit_waveforms"` -> forwarded to `UnitWaveformsWidget`
- `"unit_waveform_density_map"` -> forwarded to `UnitWaveformDensityMapWidget`
- `"autocorrelograms"` -> forwarded to `AutoCorrelogramsWidget`
- `"amplitudes"` -> forwarded to `AmplitudesWidget`

Do **not** set `unit_colors` inside `subwidget_kwargs`; pass it as a top-level arg.

### plot_sorting_summary

Class `SortingSummaryWidget` (from `widgets/sorting_summary.py`). Backends: `sortingview`, `figpack`, `spikeinterface_gui`. No matplotlib/ipywidgets backend.

```python
SortingSummaryWidget(
    sorting_analyzer: SortingAnalyzer,
    unit_ids=None,
    sparsity=None,
    max_amplitudes_per_unit=None,
    min_similarity_for_correlograms=0.2,
    curation=False,
    displayed_unit_properties=None,
    extra_unit_properties=None,
    label_choices=None,
    curation_dict=None,
    label_definitions=None,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "sortingview" | "figpack" | "spikeinterface_gui" | None`.

Requires the `"correlograms"`, `"spike_amplitudes"`, `"unit_locations"`, and `"template_similarity"` extensions. Module-level default (`_default_displayed_unit_properties`) is `["firing_rate", "num_spikes", "x", "y", "amplitude_median", "snr", "rp_violations"]`. Curation (`curation=True`) is supported by figpack and spikeinterface_gui only.

### plot_valid_unit_periods

Class `ValidUnitPeriodsWidget` (from `widgets/unit_valid_periods.py`). Backends: `matplotlib`, `ipywidgets`.

```python
ValidUnitPeriodsWidget(
    sorting_analyzer: SortingAnalyzer | None = None,
    segment_index: int | None = None,
    unit_ids: list | None = None,
    show_only_units_with_valid_periods: bool = False,
    clip_amplitude_scalings: float | None = 5.0,
    backend: str | None = None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | "ipywidgets" | None`.

### plot_unit_labels

Class `WaveformOverlayByLabelWidget` (from `widgets/unit_labels.py`). Backends: `matplotlib`.

```python
WaveformOverlayByLabelWidget(
    sorting_analyzer,
    unit_labels: np.ndarray,
    labels_order: list[str] | None = None,
    max_columns: int = 3,
    ylims=None,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | None`.

Overlays waveforms grouped by string labels (needs the `"templates"` extension).

### plot_potential_merges

Class `PotentialMergesWidget` (from `widgets/potential_merges.py`). Backends: `ipywidgets` only.

```python
PotentialMergesWidget(
    sorting_analyzer: SortingAnalyzer,
    potential_merges: list,
    unit_colors: list = None,
    segment_index: int = 0,
    max_spikes_per_unit: int = 100,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "ipywidgets" | None`.

Interactive review of candidates from `spikeinterface.curation.get_potential_auto_merges`. Docstring mistakenly calls the parameter `max_spike_samples`; code uses `max_spikes_per_unit`. `unit_colors` is undocumented.

### plot_drifting_templates

Class `DriftingTemplatesWidget` (from `widgets/drift_templates.py`). Backends: `ipywidgets` only.

```python
DriftingTemplatesWidget(
    drifting_templates: SortingAnalyzer,
    scale=1,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "ipywidgets" | None`.

---
