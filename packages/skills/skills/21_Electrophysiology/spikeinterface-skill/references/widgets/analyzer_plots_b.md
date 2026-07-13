# Analyzer plots (b): waveforms and templates

Source in repo: `spikeinterface/src/spikeinterface/widgets/unit_waveforms.py`
Parent index: [INDEX.md](INDEX.md)
---

### plot_unit_waveforms

Class `UnitWaveformsWidget` (from `widgets/unit_waveforms.py`). Backends: `matplotlib`, `ipywidgets`.

```python
UnitWaveformsWidget(
    sorting_analyzer_or_templates: SortingAnalyzer | Templates,
    channel_ids=None,
    unit_ids=None,
    plot_waveforms=True,
    plot_templates=True,
    plot_channels=False,
    unit_colors=None,
    sparsity=None,
    ncols=5,
    scale=1,
    abs_y_scale=None,
    widen_narrow_scale=1,
    lw_waveforms=1,
    lw_templates=2,
    axis_equal=False,
    unit_selected_waveforms=None,
    max_spikes_per_unit=50,
    set_title=True,
    same_axis=False,
    shade_templates=True,
    templates_percentile_shading=(1, 25, 75, 99),
    scalebar=False,
    x_offset_units=False,
    alpha_waveforms=0.5,
    alpha_templates=1,
    hide_unit_selector=False,
    plot_legend=True,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | "ipywidgets" | None`.

Passing a `Templates` object forces `plot_waveforms=False`. `templates_percentile_shading` must be an even-length list/tuple (nested percentile pairs); sortingview requires exactly 2 or 4 elements.

### plot_unit_templates

Class `UnitTemplatesWidget` (from `widgets/unit_templates.py`, subclass of `UnitWaveformsWidget`). Backends: `matplotlib`, `ipywidgets` (inherited) plus `sortingview`, `figpack` (defined on the class).

```python
UnitTemplatesWidget(*args, **kargs)
# All kwargs of UnitWaveformsWidget; plot_waveforms is forced to False.
```

Literal values:

- `backend : "matplotlib" | "ipywidgets" | "sortingview" | "figpack" | None`.

Docstring inherits from `UnitWaveformsWidget`.

### plot_unit_waveforms_density_map

Class `UnitWaveformDensityMapWidget` (from `widgets/unit_waveforms_density_map.py`). Backends: `matplotlib`.

```python
UnitWaveformDensityMapWidget(
    sorting_analyzer,
    channel_ids=None,
    unit_ids=None,
    sparsity=None,
    same_axis=False,
    use_max_channel=False,
    unit_colors=None,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | None`.

### plot_template_similarity

Class `TemplateSimilarityWidget` (from `widgets/template_similarity.py`). Backends: `matplotlib`, `sortingview`, `figpack`.

```python
TemplateSimilarityWidget(
    sorting_analyzer: SortingAnalyzer,
    unit_ids=None,
    cmap="viridis",
    display_diagonal_values=False,
    show_unit_ticks=False,
    show_colorbar=True,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `cmap : str, default "viridis"` (any matplotlib colormap name).
- `backend : "matplotlib" | "sortingview" | "figpack" | None`.

Requires the `"template_similarity"` extension.

---
