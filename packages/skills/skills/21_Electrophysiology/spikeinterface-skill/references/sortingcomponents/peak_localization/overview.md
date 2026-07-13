# Peak localization — overview

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/peak_localization/`
Parent index: [../INDEX.md](../INDEX.md)

---

## Peak localization

Module: `spikeinterface.sortingcomponents.peak_localization`.
The `__init__.py` re-exports:

- `peak_localization_methods` (from `.method_list`)
- `localize_peaks`, `get_localization_pipeline_nodes` (from `.main`)

### `localize_peaks`

```python
from spikeinterface.sortingcomponents.peak_localization import localize_peaks

localize_peaks(
    recording,
    peaks,
    method=None,
    method_kwargs=None,
    ms_before=0.5,
    ms_after=0.5,
    pipeline_kwargs=None,
    verbose=False,
    job_kwargs=None,
    **old_kwargs,
) -> np.ndarray
```

Behaviour:

- `method` must be a key of `peak_localization_methods`. If `None`, the code
  warns and falls back to `"center_of_mass"`. `"method"` can also be embedded
  in `method_kwargs`.
- `ms_before : float`, default `0.5`; `ms_after : float`, default `0.5` —
  fix the waveform window used for localization.
- Internally builds `[PeakRetriever, ExtractDenseWaveforms, method_class]`
  via `get_localization_pipeline_nodes`.
- For `"grid_convolution"`, if `"prototype"` is not provided a prototype is
  silently extracted from the peaks via
  `tools.get_prototype_and_waveforms_from_peaks`.
- Returns a structured numpy array. The dtype depends on the method (see
  `spikeinterface.postprocessing.unit_locations.dtype_localize_by_method`):
  `("x", "y")` for `center_of_mass`, `("x", "y", "z", "alpha")` for
  `monopolar_triangulation`, `("x", "y", "z")` for `grid_convolution`.

### `get_localization_pipeline_nodes`

```python
from spikeinterface.sortingcomponents.peak_localization import (
    get_localization_pipeline_nodes,
)

get_localization_pipeline_nodes(
    recording,
    peak_source,
    method="center_of_mass",
    method_kwargs=None,
    ms_before=0.5,
    ms_after=0.5,
    job_kwargs=None,
)
```

Returns `[peak_source, extract_dense_waveforms, localization_node]`.
`peak_source` must be a `PeakRetriever` or `SpikeRetriever` (asserted when
`method == "grid_convolution"` and no prototype is provided).

### Method registry (`peak_localization.method_list.peak_localization_methods`)

Exactly three methods:

- `"center_of_mass"` → `LocalizeCenterOfMass`
- `"monopolar_triangulation"` → `LocalizeMonopolarTriangulation`
- `"grid_convolution"` → `LocalizeGridConvolution`

There is **no** `"peak_channel"` or other method in this module. Each class
inherits from `LocalizeBase` (which takes `radius_um : float = 75.0`).
