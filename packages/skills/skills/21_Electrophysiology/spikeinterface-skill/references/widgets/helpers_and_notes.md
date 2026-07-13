# Helper utilities and notes

Source in repo: `spikeinterface/src/spikeinterface/widgets/utils.py`
Parent index: [INDEX.md](INDEX.md)
---

## Helper utilities

Re-exported from `spikeinterface.widgets` (see `widgets/__init__.py`).

### get_some_colors

From `widgets/utils.py`:

```python
def get_some_colors(
    keys,
    color_engine="auto",
    map_name="gist_ncar",
    format="RGBA",
    shuffle=None,
    seed=None,
    margin=None,
    resample=True,
):
    """
    Return a dict of colors for given keys
    """
```

Literal values:

- `color_engine : "auto" | "matplotlib" | "colorsys" | "distinctipy"` (default `"auto"`). Enforced by an internal `assert color_engine in ("auto", "distinctipy", "matplotlib", "colorsys")`.
  - `"auto"`: prefer `"matplotlib"` if available, else `"distinctipy"`, else `"colorsys"`.
- `format : "RGBA"` — the only accepted output format (enforced by `assert format in possible_formats` where `possible_formats = ("RGBA",)`).
- `map_name : str, default "gist_ncar"` — matplotlib colormap name used when `color_engine="matplotlib"`.
- `shuffle : bool | None`. `None` -> `True` for matplotlib and colorsys, `False` for distinctipy (with `seed = 91`).

### get_unit_colors

From `widgets/utils.py`:

```python
def get_unit_colors(
    sorting_or_analyzer_or_templates,
    color_engine="auto",
    map_name="gist_ncar",
    format="RGBA",
    shuffle=None,
    seed=None,
):
    """
    Return a dict colors per units.
    """
```

Forwards to `get_some_colors(sorting_or_analyzer_or_templates.unit_ids, ...)`. Same Literal enumerations as `get_some_colors` apply.

### array_to_image

From `widgets/utils.py`. Used by the sortingview/figpack backends of `plot_traces`:

```python
def array_to_image(
    data,
    colormap="RdGy",
    clim=None,
    spatial_zoom=(0.75, 1.25),
    num_timepoints_per_row=30000,
    row_spacing=0.25,
    scalebar=False,
    sampling_frequency=None,
):
    """
    Converts a 2D numpy array (width x height) to a
    3D image array (width x height x RGB color).
    """
```

`colormap` accepts any matplotlib colormap name (default `"RdGy"`). Requires `Pillow` when `scalebar=True`.

### Non-exported helpers in `widgets/utils.py`

- `make_units_table_from_sorting(sorting, units_table=None)` -> `pd.DataFrame` (used by the sortingview / spikeinterface-gui unit table).
- `make_units_table_from_analyzer(analyzer, extra_properties=None, with_unit_locations=True, with_quality_metrics=True, with_template_metrics=True)` -> `pd.DataFrame`.
- `validate_segment_indices(segment_indices: list[int] | None, sorting: BaseSorting) -> list[int]`.
- `get_segment_durations(sorting: BaseSorting, segment_indices: list[int] = None) -> list[float]`.

---

## Notes on inheritance / shared plot backends

- `AutoCorrelogramsWidget` inherits from `CrossCorrelogramsWidget`; docstrings are shared.
- `UnitTemplatesWidget` inherits from `UnitWaveformsWidget` (with `plot_waveforms=False` forced) and adds `plot_sortingview` / `plot_figpack`.
- `QualityMetricsWidget` and `TemplateMetricsWidget` both inherit from `MetricsBaseWidget` (`widgets/metrics.py`), which supplies `plot_matplotlib`, `plot_ipywidgets`, `plot_sortingview`, `plot_figpack`.
- `AmplitudesWidget`, `RasterWidget`, and `DriftRasterMapWidget` inherit from `BaseRasterWidget`, which supplies `plot_matplotlib` and `plot_ipywidgets`; `AmplitudesWidget` additionally defines `plot_sortingview` / `plot_figpack`.
- `StudySummary` composes multiple `Study*` widgets in a single figure; every class in `gtstudy.py` (`StudyRunTimesWidget`, `StudyUnitCountsWidget`, `StudyPerformances`, `StudyAgreementMatrix`, `StudySummary`) emits a deprecation warning and delegates to `spikeinterface.benchmark.benchmark_plot_tools`.
- `TracesWidget.plot_sortingview` forwards to `TracesWidget.plot_figpack(..., use_sortingview=True, ...)`.

## Docstring inconsistencies to be aware of

- `UnitPresenceWidget.bin_duration_s` -- docstring says `0.5`, code default is `0.05`.
- `MultiCompAgreementBySorterWidget.cmap` / `MultiCompGlobalAgreementWidget.cmap` -- docstring says `"Reds"`, code default is `"YlOrRd"`.
- `PotentialMergesWidget` -- docstring calls the parameter `max_spike_samples`, code uses `max_spikes_per_unit`; `unit_colors` is undocumented.
- `MotionWidget.motion_lim` and `PeakActivityMapWidget.with_color_bar` are undocumented in their docstrings.
- `LocationsWidget.plot_histograms` -- docstring erroneously names the parameter `plot_histogram` (singular).
