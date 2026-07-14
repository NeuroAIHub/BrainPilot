# Localization tools (module-level functions)
Source in repo: `spikeinterface/src/spikeinterface/postprocessing/localization_tools.py`
Parent index: [INDEX.md](INDEX.md)
---

## Localization tools (module-level functions)

Source: `src/spikeinterface/postprocessing/localization_tools.py`. These are the pure-function implementations that back the `unit_locations` extension methods (via the `_unit_location_methods` dict) and, indirectly, `spike_locations`. They are **not** re-exported by `postprocessing/__init__.py` — import from `spikeinterface.postprocessing.localization_tools` directly.

Dispatch dict:
```python
_unit_location_methods = {
    "center_of_mass": compute_center_of_mass,
    "grid_convolution": compute_grid_convolution,
    "monopolar_triangulation": compute_monopolar_triangulation,
    "max_channel": compute_location_max_channel,
}
```

### compute_center_of_mass

```python
def compute_center_of_mass(
    sorting_analyzer_or_templates: SortingAnalyzer | Templates,
    unit_ids=None,
    peak_sign: str = "neg",
    radius_um: float = 75,
    feature: str = "ptp",
) -> np.ndarray:
```

- `unit_ids`: `str | int | None`, default `None`.
- `peak_sign`: `"neg" | "pos" | "both"`, default `"neg"` (used only if analyzer has no sparsity; drives sparsity computation).
- `radius_um`: `float`, default `75`.
- `feature`: `"ptp" | "mean" | "energy" | "peak_voltage"`, default `"ptp"`.
- Returns: `(num_units, 2)` array of `(x, y)` locations.

### compute_monopolar_triangulation

```python
def compute_monopolar_triangulation(
    sorting_analyzer_or_templates: SortingAnalyzer | Templates,
    unit_ids=None,
    optimizer: str = "least_square",
    radius_um: float = 75,
    max_distance_um: float = 1000,
    return_alpha: bool = False,
    enforce_decrease: bool = False,
    feature: str = "ptp",
    peak_sign=None,
    peak_mode=None,
) -> np.ndarray:
```

- `unit_ids`: `str | int | None`, default `None`.
- `optimizer`: `"least_square" | "minimize_with_log_penality"`, default `"least_square"`.
- `radius_um`: `float`, default `75` (for sparsity when none is set on the analyzer).
- `max_distance_um`: `float`, default `1000`.
- `return_alpha`: `bool`, default `False` — if `True` returns `(num_units, 4)` with `alpha`, else `(num_units, 3)`.
- `enforce_decrease`: `bool`, default `False`.
- `feature`: `"ptp" | "energy" | "peak_voltage"`, default `"ptp"`.
- `peak_sign`: `None | "neg" | "pos" | "both"`, default `None` (used when computing sparsity).
- `peak_mode`: passed to `compute_sparsity` as `amplitude_mode`; valid values `"extremum" | "at_index" | "peak_to_peak"`, default `None`.

### compute_grid_convolution

```python
def compute_grid_convolution(
    sorting_analyzer_or_templates: SortingAnalyzer | Templates,
    unit_ids=None,
    invert_prototype_waveform: bool = True,
    radius_um: float = 40.0,
    upsampling_um: float = 5,
    sigma_ms: float = 0.25,
    margin_um: float = 50,
    prototype: np.ndarray | None = None,
    percentile: float = 5,
    weight_method: dict = {},
) -> np.ndarray:
```

- `unit_ids`: `str | int | None`, default `None`.
- `invert_prototype_waveform`: `bool`, default `True`.
- `radius_um`: `float`, default `40.0`.
- `upsampling_um`: `float`, default `5`.
- `sigma_ms`: `float`, default `0.25`.
- `margin_um`: `float`, default `50`.
- `prototype`: `np.ndarray | None`, default `None` (Gaussian of width `sigma_ms`).
- `percentile`: `float`, default `5` (top 5% of scalar products kept).
- `weight_method`: `dict`, default `{}` — forwarded to `get_convolution_weights`; the important key is `"mode"`, which is `"exponential_3d"` (default) or `"gaussian_2d"` (KiloSort-like).

Returns `(num_units, 3)` `(x, y, z)`.

### compute_location_max_channel

```python
def compute_location_max_channel(
    templates_or_sorting_analyzer: SortingAnalyzer | Templates,
    unit_ids=None,
) -> np.ndarray:
```

- `unit_ids`: `list[str] | list[int] | None`, default `None`.

Returns `(num_units, 2)` — each unit's extremum channel `(x, y)` location.

### get_convolution_weights (lower-level helper)

```python
def get_convolution_weights(
    distances,
    z_list_um=np.linspace(0, 120.0, 5),
    sigma_list_um=np.linspace(5, 25, 5),
    sparsity_threshold=None,
    sigma_3d=2.5,
    mode="exponential_3d",
)
```

- `mode`: `"exponential_3d" | "gaussian_2d"`, default `"exponential_3d"`.
- `z_list_um`: array, default `np.linspace(0, 120.0, 5)` — used by `"exponential_3d"`.
- `sigma_list_um`: array, default `np.linspace(5, 25, 5)` — used by `"gaussian_2d"`.
- `sparsity_threshold`: `float | None`, default `None`.
- `sigma_3d`: `float`, default `2.5` — used by `"exponential_3d"`.

Recommended usage:

```python
# These functions are NOT re-exported by spikeinterface.postprocessing;
# import them from the localization_tools module directly.
from spikeinterface.postprocessing.localization_tools import (
    compute_center_of_mass,
    compute_monopolar_triangulation,
    compute_grid_convolution,
    compute_location_max_channel,
)

com = compute_center_of_mass(analyzer, peak_sign="neg", radius_um=75, feature="ptp")
mt  = compute_monopolar_triangulation(analyzer, optimizer="least_square",
                                      radius_um=75, return_alpha=True)
gc  = compute_grid_convolution(analyzer, radius_um=40.0, upsampling_um=5)
mc  = compute_location_max_channel(analyzer)
```
