# correlograms — ComputeCorrelograms / ComputeAutoCorrelograms / ComputeACG3D
Source in repo: `spikeinterface/src/spikeinterface/postprocessing/correlograms.py`
Parent index: [INDEX.md](INDEX.md)
---

## correlograms — ComputeCorrelograms

- extension name: `"correlograms"`
- Compute class: `ComputeCorrelograms(AnalyzerExtension)`
- depends on: `[]`, `need_recording=False`, `use_nodepipeline=False`, `need_job_kwargs=True`
- Source: `src/spikeinterface/postprocessing/correlograms.py`

Parameters (from `_set_params`):

```python
def _set_params(self, window_ms: float = 50.0, bin_ms: float = 1.0, method: str = "auto", fast_mode: str = "auto"):
```

- `window_ms`: `float`, default `50.0`. Full window around each spike (in ms); lags computed from `-window_ms/2` to `+window_ms/2`.
- `bin_ms`: `float`, default `1.0`. Bin size in ms.
- `method`: `"auto" | "numpy" | "numba"`, default `"auto"` (numba if available, else numpy).
- `fast_mode`: `"auto" | "on" | "off"`, default `"auto"`. When `"auto"`, enables multithreaded numba if `num_units > 300`; uses `job_kwargs` for thread count.

Return / data layout:
- `correlograms.shape == (num_units, num_units, num_bins)` (int64 counts).
- `bins.shape == (num_bins + 1,)` — bin edges in ms.
- The diagonal (`correlogram[A, A, :]`) is the ACG; `correlogram[A, B, :] == correlogram[B, A, ::-1]`.

Public standalone function:
```python
def compute_correlograms(
    sorting_analyzer_or_sorting,
    window_ms: float = 50.0,
    bin_ms: float = 1.0,
    method: str = "auto",
    fast_mode: str = "auto",
    **job_kwargs,
):
```

- `method`: `"auto" | "numpy" | "numba"`, default `"auto"`.
- `fast_mode`: `"auto" | "on" | "off"`, default `"auto"`.

Low-level helpers (accept raw spike arrays, one segment at a time):

```python
def correlogram_for_one_segment(spike_times, spike_unit_indices, window_size, bin_size)
def auto_correlogram_for_one_segment(spike_times, spike_unit_indices, window_size, bin_size)
```

`window_size` and `bin_size` are in **samples**; return shapes are `(num_units, num_units, num_bins)` and `(num_units, num_bins)` respectively.

Recommended usage:

```python
from spikeinterface.postprocessing import compute_correlograms

analyzer.compute("correlograms", window_ms=100.0, bin_ms=1.0, method="auto")
ccgs, bins = analyzer.get_extension("correlograms").get_data()
# ccgs.shape == (num_units, num_units, num_bins); bins.shape == (num_bins + 1,)

# Or standalone against a Sorting:
ccgs, bins = compute_correlograms(sorting, window_ms=100.0, bin_ms=1.0, method="numba")
```

---

## auto_correlograms — ComputeAutoCorrelograms

- extension name: `"auto_correlograms"`
- Compute class: `ComputeAutoCorrelograms(AnalyzerExtension)`
- depends on: `[]`, `need_recording=False`, `use_nodepipeline=False`, `need_job_kwargs=True`
- Source: `src/spikeinterface/postprocessing/correlograms.py`

Parameters (identical signature to `ComputeCorrelograms._set_params`):

```python
def _set_params(self, window_ms: float = 50.0, bin_ms: float = 1.0, method: str = "auto", fast_mode: str = "auto"):
```

- `window_ms`: `float`, default `50.0`.
- `bin_ms`: `float`, default `1.0`.
- `method`: `"auto" | "numpy" | "numba"`, default `"auto"`.
- `fast_mode`: `"auto" | "on" | "off"`, default `"auto"` (the docstring on this class lists the enum in the order `"auto" | "off" | "on"`; the accepted values are identical to `ComputeCorrelograms`).

Return shape: `acgs.shape == (num_units, num_bins)`, `bins.shape == (num_bins + 1,)`.

Public standalone function:

```python
def compute_auto_correlograms(
    sorting_analyzer_or_sorting,
    window_ms: float = 50.0,
    bin_ms: float = 1.0,
    method: str = "auto",
    fast_mode="auto",
    **job_kwargs,
):
```

- `method`: `"auto" | "numpy" | "numba"`, default `"auto"`.
- `fast_mode`: `"auto" | "on" | "off"`, default `"auto"`.

---

## acgs_3d — ComputeACG3D

- extension name: `"acgs_3d"`
- Compute class: `ComputeACG3D(AnalyzerExtension)`
- depends on: `[]`, `need_recording=False`, `use_nodepipeline=False`, `need_job_kwargs=True`
- Source: `src/spikeinterface/postprocessing/correlograms.py`

Parameters (from `_set_params`):

```python
def _set_params(
    self,
    window_ms: float = 50.0,
    bin_ms: float = 1.0,
    num_firing_rate_quantiles: int = 10,
    smoothing_factor: int = 250,
):
```

- `window_ms`: `float`, default `50.0`.
- `bin_ms`: `float`, default `1.0`.
- `num_firing_rate_quantiles`: `int`, default `10` (deciles).
- `smoothing_factor`: `int`, default `250` (boxcar width in ms; `None` or non-positive disables smoothing).

Returns via `_get_data()`: `(acgs_3d, firing_quantiles, bins)`, with `acgs_3d.shape == (num_units, num_firing_rate_quantiles, num_time_bins)`.

Public standalone function:

```python
def compute_acgs_3d(
    sorting_analyzer_or_sorting: SortingAnalyzer | BaseSorting,
    window_ms: float = 50.0,
    bin_ms: float = 1.0,
    num_firing_rate_quantiles: int = 10,
    smoothing_factor: int = 250,
    **job_kwargs,
):
```

Based on Beau et al., 2025.
