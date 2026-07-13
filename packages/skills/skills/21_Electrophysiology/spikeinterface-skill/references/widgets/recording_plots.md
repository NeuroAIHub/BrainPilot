# Recording plots

Source in repo: `spikeinterface/src/spikeinterface/widgets/traces.py`
Parent index: [INDEX.md](INDEX.md)
---

## Recording plots

### plot_traces

Class `TracesWidget` (from `widgets/traces.py`). Backends: `matplotlib`, `ipywidgets`, `sortingview`, `figpack`, `ephyviewer`.

```python
TracesWidget(
    recording,
    segment_index=None,
    channel_ids=None,
    order_channel_by_depth=False,
    time_range=None,
    mode="auto",
    return_scaled=None,
    return_in_uV=False,
    cmap="RdBu_r",
    show_channel_ids=False,
    events=None,
    events_color="gray",
    events_alpha=0.5,
    color_groups=False,
    color=None,
    clim=None,
    tile_size=1500,
    seconds_per_row=0.2,
    scale=1,
    vspacing_factor=1.5,
    with_colorbar=True,
    add_legend=True,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `mode : "line" | "map" | "auto"` (default `"auto"`). `"auto"` -> `"line"` if `<= 64` channels, else `"map"`.
- `backend : "matplotlib" | "ipywidgets" | "sortingview" | "figpack" | "ephyviewer" | None`.

`recording` accepts a `BaseRecording`, a `dict` of recordings, or a `list`; dict/list produce multi-layer overlays. Multi-segment recordings require `segment_index`. `events` may be a 1-D float array of times or a structured array with `"time"` and optional `"duration"`, `"label"` fields. The sortingview/figpack backends require `mode="map"` and `pyvips`. `return_scaled` is deprecated in favour of `return_in_uV`.

### plot_spikes_on_traces

Class `SpikesOnTracesWidget` (from `widgets/spikes_on_traces.py`). Backends: `matplotlib`, `ipywidgets`.

```python
SpikesOnTracesWidget(
    sorting_analyzer: SortingAnalyzer,
    segment_index=None,
    channel_ids=None,
    unit_ids=None,
    order_channel_by_depth=False,
    time_range=None,
    unit_colors=None,
    sparsity=None,
    mode="auto",
    return_scaled=None,
    return_in_uV=False,
    cmap="RdBu",
    show_channel_ids=False,
    color_groups=False,
    color=None,
    clim=None,
    tile_size=512,
    seconds_per_row=0.2,
    scale=1,
    spike_width_ms=4,
    spike_height_um=20,
    with_colorbar=True,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `mode : "line" | "map" | "auto"` (default `"auto"`).
- `backend : "matplotlib" | "ipywidgets" | None`.

Requires the `"unit_locations"` extension on the analyzer.

### plot_probe_map

Class `ProbeMapWidget` (from `widgets/probe_map.py`). Backends: `matplotlib`.

```python
ProbeMapWidget(
    recording,
    color_channels=None,
    with_channel_ids=False,
    backend=None,
    **backend_or_plot_probe_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | None`.

Unknown keyword arguments are forwarded to `probeinterface.plotting.plot_probe_group()`.

### plot_peak_activity

Class `PeakActivityMapWidget` (from `widgets/peak_activity.py`). Backends: `matplotlib`.

```python
PeakActivityMapWidget(
    recording,
    peaks,
    bin_duration_s=None,
    with_contact_color=True,
    with_interpolated_map=True,
    with_channel_ids=False,
    with_color_bar=True,
    color_range=None,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | None`.

`peaks` is the array returned by `detect_peaks()`. Set `bin_duration_s` (float, seconds) to animate spike rate over time; leave `None` for a static image. `color_range` is a tuple/list of length 2 or `None`. Note: `with_color_bar` is undocumented in the source docstring.

### plot_peaks_on_probe

Class `PeaksOnProbeWidget` (from `widgets/peaks_on_probe.py`). Backends: `matplotlib`.

```python
PeaksOnProbeWidget(
    recording,
    peaks,
    peak_locations,
    segment_index=None,
    time_range=None,
    ylim=None,
    decimate=5,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | None`.

Pass `list` of `np.ndarray` to `peaks` and `peak_locations` for side-by-side subplots.

### plot_timeseries (deprecated)

Module-level function in `widget_list.py`:

```python
def plot_timeseries(*args, **kwargs):
    warnings.warn("plot_timeseries() is now plot_traces()")
    return plot_traces(*args, **kwargs)
```

Not exported through `__init__.py` explicitly but is in the module namespace.

---
