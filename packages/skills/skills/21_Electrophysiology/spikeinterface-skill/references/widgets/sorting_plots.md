# Sorting plots

Source in repo: `spikeinterface/src/spikeinterface/widgets/rasters.py`
Parent index: [INDEX.md](INDEX.md)
---

## Sorting plots

### plot_rasters

Class `RasterWidget` (from `widgets/rasters.py`, subclass of `BaseRasterWidget`). Backends inherited from `BaseRasterWidget`: `matplotlib`, `ipywidgets`.

```python
RasterWidget(
    sorting_analyzer_or_sorting: SortingAnalyzer | BaseSorting | None = None,
    segment_indices: int | None = None,
    unit_ids: list | None = None,
    time_range: list | None = None,
    color="k",
    backend: str | None = None,
    sorting: BaseSorting | None = None,
    sorting_analyzer: SortingAnalyzer | None = None,
    sort_by_depth: bool = False,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | "ipywidgets" | None`.

`sorting` and `sorting_analyzer` are deprecated positional/keyword paths. `sort_by_depth=True` requires a `SortingAnalyzer` with the `"unit_locations"` extension.

`BaseRasterWidget` itself (not directly instantiated by users) has:

```python
BaseRasterWidget(
    spike_train_data: dict,
    y_axis_data: dict,
    depth_dict: dict | None = None,
    sort_by_depth: bool = False,
    unit_ids: list | None = None,
    segment_indices: list | None = None,
    durations: list | None = None,
    plot_histograms: bool = False,
    bins: int | None = None,
    scatter_decimate: int = 1,
    unit_colors: dict | None = None,
    color_kwargs: dict | None = None,
    plot_legend: bool | None = False,
    y_lim: tuple[float, float] | None = None,
    x_lim: tuple[float, float] | None = None,
    title: str | None = None,
    y_label: str | None = None,
    y_ticks: bool = False,
    hide_unit_selector: bool = True,
    segment_boundary_kwargs: dict | None = None,
    backend: str | None = None,
    **backend_kwargs,
)
```

### plot_isi_distribution

Class `ISIDistributionWidget` (from `widgets/isi_distribution.py`). Backends: `matplotlib`.

```python
ISIDistributionWidget(
    sorting_analyzer_or_sorting: SortingAnalyzer | BaseSorting | None = None,
    unit_ids: list | None = None,
    window_ms: float = 100.0,
    bin_ms: float = 1.0,
    backend: str | None = None,
    sorting: BaseSorting | None = None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | None`.

### plot_autocorrelograms

Class `AutoCorrelogramsWidget` (from `widgets/autocorrelograms.py`, subclass of `CrossCorrelogramsWidget`). Backends: `matplotlib`, `sortingview`, `figpack`.

```python
AutoCorrelogramsWidget(*args, **kargs)
# All kwargs of CrossCorrelogramsWidget; min_similarity_for_correlograms is forced to None.
```

Literal values:

- `backend : "matplotlib" | "sortingview" | "figpack" | None`.

Docstring is copied from `CrossCorrelogramsWidget`.

### plot_crosscorrelograms

Class `CrossCorrelogramsWidget` (from `widgets/crosscorrelograms.py`). Backends: `matplotlib`, `sortingview`, `figpack`.

```python
CrossCorrelogramsWidget(
    sorting_analyzer_or_sorting: SortingAnalyzer | BaseSorting,
    unit_ids=None,
    min_similarity_for_correlograms=0.2,
    window_ms=100.0,
    bin_ms=1.0,
    hide_unit_selector=False,
    unit_colors=None,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | "sortingview" | "figpack" | None`.

Requires the `"correlograms"` extension when given a `SortingAnalyzer` (and `"template_similarity"` when `min_similarity_for_correlograms > 0`, figpack only).

### plot_unit_presence

Class `UnitPresenceWidget` (from `widgets/unit_presence.py`). Backends: `matplotlib`.

```python
UnitPresenceWidget(
    sorting_analyzer_or_sorting: SortingAnalyzer | BaseSorting | None = None,
    segment_index: int | None = None,
    time_range: list | None = None,
    bin_duration_s: float = 0.05,
    smooth_sigma: float = 4.5,
    backend: str | None = None,
    sorting: BaseSorting | None = None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | None`.

Note: docstring says `bin_duration_s` default `0.5`, but code default is `0.05`.

### plot_locations

Class `LocationsWidget` (from `widgets/spike_locations_by_time.py`). Backends: `matplotlib`, `ipywidgets`. Plots spike locations as a function of time.

```python
LocationsWidget(
    sorting_analyzer: SortingAnalyzer,
    unit_ids=None,
    unit_colors=None,
    segment_index=None,
    max_spikes_per_unit=None,
    plot_histograms=False,
    bins=None,
    plot_legend=True,
    locations_axis="y",
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `locations_axis : str, default "y"`. Which key of the per-unit `spike_locations` structured array to plot along the y-axis (typical values: `"x"`, `"y"`; also `"z"` if present in the extension).
- `backend : "matplotlib" | "ipywidgets" | None`.

Requires the `"spike_locations"` extension.

---
