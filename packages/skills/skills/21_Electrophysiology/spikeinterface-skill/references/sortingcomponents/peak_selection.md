# Peak selection

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/peak_selection.py`
Parent index: [INDEX.md](INDEX.md)

---

## Peak selection

Module: `spikeinterface.sortingcomponents.peak_selection`.

There is **no** `PeakSelector` class. Peak selection is a free function.

### `select_peaks`

```python
from spikeinterface.sortingcomponents.peak_selection import select_peaks

select_peaks(
    peaks,
    recording=None,
    method="uniform",
    seed=None,
    return_indices=False,
    margin=None,
    **method_kwargs,
)
```

- `peaks` — structured array of peaks (from `detect_peaks`).
- `recording=None` — required only when `margin is not None`.
- `method : str`, default `"uniform"`. See method options below.
- `seed : int | None`, default `None`.
- `return_indices : bool`, default `False`. If `True` returns
  `(selected_peaks, selected_indices)`.
- `margin : tuple[int, int] | None`, default `None` — `(nbefore, nafter)`
  in samples. Peaks in the borders of each segment are dropped.
- `**method_kwargs` — per-method parameters (see below).

Under the hood dispatches to `select_peak_indices(peaks, method, seed,
**method_kwargs)`.

### Method options (source `_possible_methods` tuple)

Exhaustive tuple:

```python
_possible_methods = (
    "uniform",
    "uniform_locations",
    "smart_sampling_amplitudes",
    "smart_sampling_locations",
    "smart_sampling_locations_and_time",
)
```

`"uniform_locations"` is listed in `_possible_methods` but has no
implementation in `select_peak_indices`; passing it raises
`NotImplementedError`.

### `uniform` — random subsampling

`method_kwargs` (defaults from `params = {"select_per_channel": False,
"n_peaks": None}`):

- `n_peaks : int` (required, asserted not-None).
- `select_per_channel : bool`, default `False`. If `True`, `n_peaks` is the
  number per channel; otherwise it is the total number of peaks.

### `smart_sampling_amplitudes`

`method_kwargs` (defaults from `params = {"n_peaks": None,
"noise_levels": None, "select_per_channel": False}`):

- `n_peaks : int` (required, asserted not-None).
- `noise_levels : array` (required, asserted not-None).
- `select_per_channel : bool`, default `False`.

### `smart_sampling_locations`

`method_kwargs` (defaults from `params = {"peaks_locations": None,
"n_peaks": None}`):

- `n_peaks : int` (required, asserted not-None).
- `peaks_locations : array` (required, asserted not-None) — must expose
  `"x"` and `"y"` fields (output of `localize_peaks`).

### `smart_sampling_locations_and_time`

Same required `method_kwargs` as `smart_sampling_locations`:

- `n_peaks : int` (required).
- `peaks_locations : array` (required, with `"x"` / `"y"` fields).

Uses `peaks["sample_index"]` as the temporal axis for rejection sampling.
