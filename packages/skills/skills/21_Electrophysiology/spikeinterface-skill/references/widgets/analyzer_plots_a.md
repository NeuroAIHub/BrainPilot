# Analyzer plots (a): amplitudes and locations

Source in repo: `spikeinterface/src/spikeinterface/widgets/amplitudes.py`
Parent index: [INDEX.md](INDEX.md)
---

## Analyzer plots

### plot_amplitudes

Class `AmplitudesWidget` (from `widgets/amplitudes.py`, subclass of `BaseRasterWidget`). Backends: `matplotlib`, `ipywidgets` (from `BaseRasterWidget`), plus `sortingview`, `figpack` (defined on the class).

```python
AmplitudesWidget(
    sorting_analyzer: SortingAnalyzer,
    unit_ids=None,
    unit_colors=None,
    segment_indices=None,
    max_spikes_per_unit=None,
    y_lim=None,
    scatter_decimate=1,
    hide_unit_selector=False,
    plot_histograms=False,
    bins=None,
    plot_legend=True,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | "ipywidgets" | "sortingview" | "figpack" | None`.

Requires the `"spike_amplitudes"` extension. Under `figpack`/`sortingview` only the first segment is used.

### plot_all_amplitudes_distributions

Class `AllAmplitudesDistributionsWidget` (from `widgets/all_amplitudes_distributions.py`). Backends: `matplotlib`.

```python
AllAmplitudesDistributionsWidget(
    sorting_analyzer: SortingAnalyzer,
    unit_ids=None,
    unit_colors=None,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | None`.

Violin plot of per-unit amplitude distributions. Requires the `"spike_amplitudes"` extension.

### plot_spike_locations

Class `SpikeLocationsWidget` (from `widgets/spike_locations.py`). Backends: `matplotlib`, `ipywidgets`, `sortingview`, `figpack`.

```python
SpikeLocationsWidget(
    sorting_analyzer: SortingAnalyzer,
    unit_ids=None,
    segment_index=None,
    max_spikes_per_unit=500,
    with_channel_ids=False,
    unit_colors=None,
    hide_unit_selector=False,
    plot_all_units=True,
    plot_legend=False,
    hide_axis=False,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | "ipywidgets" | "sortingview" | "figpack" | None`.

Requires the `"spike_locations"` extension.

### plot_unit_locations

Class `UnitLocationsWidget` (from `widgets/unit_locations.py`). Backends: `matplotlib`, `ipywidgets`, `sortingview`, `figpack`.

```python
UnitLocationsWidget(
    sorting_analyzer: SortingAnalyzer,
    unit_ids: list | None = None,
    with_channel_ids: bool = False,
    unit_colors: dict | None = None,
    hide_unit_selector: bool = False,
    plot_all_units: bool = True,
    plot_legend: bool = False,
    hide_axis: bool = False,
    backend: str | None = None,
    margin: float = 50,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | "ipywidgets" | "sortingview" | "figpack" | None`.

Requires the `"unit_locations"` extension.

### plot_unit_depths

Class `UnitDepthsWidget` (from `widgets/unit_depths.py`). Backends: `matplotlib`.

```python
UnitDepthsWidget(
    sorting_analyzer,
    unit_colors=None,
    depth_axis=1,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | None`.

Bar plot of unit depths using column `depth_axis` of `unit_locations`.

### plot_unit_probe_map

Class `UnitProbeMapWidget` (from `widgets/unit_probe_map.py`). Backends: `matplotlib`.

```python
UnitProbeMapWidget(
    sorting_analyzer,
    unit_ids=None,
    channel_ids=None,
    animated=None,
    with_channel_ids=False,
    colorbar=True,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | None`.

---
