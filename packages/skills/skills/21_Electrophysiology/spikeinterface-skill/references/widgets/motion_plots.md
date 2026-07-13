# Motion plots

Source in repo: `spikeinterface/src/spikeinterface/widgets/motion.py`
Parent index: [INDEX.md](INDEX.md)
---

## Motion plots

### plot_motion

Class `MotionWidget` (from `widgets/motion.py`). Backends: `matplotlib`.

```python
MotionWidget(
    motion: Motion,
    segment_index: int | None = None,
    mode: str = "line",
    motion_lim: float | None = None,
    backend: str | None = None,
    **backend_kwargs,
)
```

Literal values:

- `mode : "auto" | "line" | "map"` (default `"line"`).
  - `"line"`: estimated motion at different depths drawn as lines.
  - `"map"`: heatmap of motion vs depth.
  - `"auto"`: chosen automatically based on number of motion depths.
- `backend : "matplotlib" | None`.

`motion_lim` is undocumented in the source docstring.

### plot_motion_info

Class `MotionInfoWidget` (from `widgets/motion.py`). Backends: `matplotlib`.

```python
MotionInfoWidget(
    motion_info: dict,
    recording: BaseRecording,
    segment_index: int | None = None,
    depth_lim: tuple[float, float] | None = None,
    motion_lim: tuple[float, float] | None = None,
    color_amplitude: bool = False,
    scatter_decimate: int | None = None,
    amplitude_cmap: str = "inferno",
    amplitude_color: str = "Gray",
    amplitude_clim: tuple[float, float] | None = None,
    amplitude_alpha: float = 1,
    backend: str | None = None,
    **backend_kwargs,
)
```

Literal values:

- `amplitude_cmap : str, default "inferno"` (matplotlib colormap name).
- `amplitude_color : str, default "Gray"` (any matplotlib color spec; used when `color_amplitude=False`).
- `backend : "matplotlib" | None`.

`motion_info` is the dict returned by `correct_motion()` (or `load_motion_info()`).

### plot_drift_raster_map

Class `DriftRasterMapWidget` (from `widgets/motion.py`, subclass of `BaseRasterWidget`). Backends inherited: `matplotlib`, `ipywidgets`.

```python
DriftRasterMapWidget(
    peaks: np.ndarray | None = None,
    peak_locations: np.ndarray | None = None,
    sorting_analyzer: SortingAnalyzer | None = None,
    direction: str = "y",
    recording: BaseRecording | None = None,
    sampling_frequency: float | None = None,
    segment_indices: list[int] | None = None,
    depth_lim: tuple[float, float] | None = None,
    color_amplitude: bool = True,
    scatter_decimate: int | None = None,
    cmap: str = "inferno",
    color: str = "Gray",
    clim: tuple[float, float] | None = None,
    alpha: float = 1,
    segment_index: int | list[int] | None = None,
    backend: str | None = None,
    **backend_kwargs,
)
```

Literal values:

- `direction : "x" | "y"` (default `"y"`). `"y"` is the depth direction.
- `cmap : str, default "inferno"` (matplotlib colormap; used when `color_amplitude=True`).
- `color : str, default "Gray"` (matplotlib color; used when `color_amplitude=False`).
- `backend : "matplotlib" | "ipywidgets" | None`.

Supply either (`peaks` + `peak_locations`) or a `SortingAnalyzer` with the `"spike_locations"` extension.

---
