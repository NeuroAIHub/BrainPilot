# SortingAnalyzer — High-level constructors
Source in repo: `spikeinterface/src/spikeinterface/core/sortinganalyzer.py`
Parent index: [INDEX.md](INDEX.md)
Related: [sorting_analyzer_class_a.md](sorting_analyzer_class_a.md), [sorting_analyzer_class_b.md](sorting_analyzer_class_b.md), [channel_sparsity.md](channel_sparsity.md), [loading_helpers.md](loading_helpers.md)
---

## 1. High-level constructors

### `create_sorting_analyzer`

Location: `sortinganalyzer.py` (line 46).

```python
def create_sorting_analyzer(
    sorting,
    recording,
    format="memory",
    folder=None,
    main_channel_indices=None,
    peak_sign="both",
    peak_mode="extremum",
    num_spikes_for_main_channel=100,
    sparse=True,
    sparsity=None,
    set_sparsity_by_dict_key=False,
    return_scaled=None,
    return_in_uV=True,
    overwrite=False,
    backend_options=None,
    sparsity_kwargs=None,
    seed=None,
    **job_kwargs,
) -> "SortingAnalyzer":
```

Parameter reference (from source docstring):

- `sorting` (`Sorting | dict`): the sorting object, or a dict of them (dict form triggers `aggregate_units`).
- `recording` (`Recording | dict`): the recording object, or a dict of them (dict form triggers `aggregate_channels`).
- `format` (`"memory" | "binary_folder" | "zarr"`, default `"memory"`): where the analyzer is stored. For `"binary_folder"` and `"zarr"`, `folder` must be given.
- `folder` (`str | Path | None`, default `None`): output folder path (required unless `format="memory"`).
- `main_channel_indices` (`None | np.array`, default `None`): externally-provided per-unit main channel index. If `None`, sorting property `"main_channel_id"` is used; if still absent, `estimate_main_channel_from_recording()` is called.
- `peak_sign` (`"both" | "neg" | "pos"`, default `"both"`): used to find the main channel.
- `peak_mode` (`"extremum" | "at_index" | "peak_to_peak"`, default `"extremum"`): amplitude computation mode.
   - `"extremum"`: max/min depending on `peak_sign`
   - `"at_index"`: value at `nbefore` index
   - `"peak_to_peak"`: peak-to-peak amplitude
- `num_spikes_for_main_channel` (`int`, default `100`): spikes per unit used to estimate main channel.
- `sparse` (`bool`, default `True`): if True, `estimate_sparsity()` is invoked to build a `ChannelSparsity`.
- `sparsity` (`ChannelSparsity | None`, default `None`): if given, `sparse` is ignored.
- `set_sparsity_by_dict_key` (`bool`, default `False`): with `sorting`/`recording` as dicts, forces `sparsity_kwargs = {"method": "by_property", "by_property": "aggregation_key"}`.
- `return_scaled` (`bool | None`, default `None`): DEPRECATED — use `return_in_uV`. Removed in 0.105.0.
- `return_in_uV` (`bool`, default `True`): applies to `"waveforms"`, `"noise_levels"`, `"templates"` extensions.
- `overwrite` (`bool`, default `False`): overwrite `folder` if it already exists.
- `backend_options` (`dict | None`, default `None`): dict with optional keys:
   - `storage_options`: `dict | None` (fsspec)
   - `saving_options`: `dict | None` (e.g. compression/filters for zarr)
- `sparsity_kwargs` (`dict | None`, default `None`): forwarded to `estimate_sparsity()` (see channel_sparsity.md for full parameter list).
- `seed` (`int | None`, default `None`): random seed forwarded when estimating main channel from recording.
- `**job_kwargs`: standard SpikeInterface parallel-job kwargs.

Returns: `SortingAnalyzer`.

#### `sparsity_kwargs` (values passed inside the `sparsity_kwargs` dict — parameters of `estimate_sparsity()`):

`method`: one of
- `"radius"` (default)
- `"best_channels"`
- `"closest_channels"`
- `"snr"`
- `"amplitude"`
- `"by_property"`

Other keys accepted (with defaults as declared on `estimate_sparsity` — see channel_sparsity.md):
- `num_spikes_for_sparsity: int = 100`
- `ms_before: float = 1.0`
- `ms_after: float = 2.5`
- `peak_sign: Literal["neg", "pos", "both"] = "both"`
- `radius_um: float = 100.0`
- `num_channels: int = 5`
- `threshold: float | None = 5`
- `amplitude_mode: Literal["extremum", "peak_to_peak"] = "extremum"`
- `by_property: str | None = None`
- `noise_levels: np.ndarray | list | None = None`
- `main_channel_indices: np.ndarray | list | None = None`

Note: the `"energy"` method is NOT exposed by `estimate_sparsity()` (see the assertion at line 822 of `sparsity.py`). It is only available through `compute_sparsity()` (which requires a `SortingAnalyzer`). Peak-to-peak behaviour is exposed via `amplitude_mode="peak_to_peak"`. There is no `"ptp"`, `"peak_channel"` or plain `"threshold"` method — use `"snr"` or `"amplitude"` with a `threshold` argument.

---

### `load_sorting_analyzer`

Location: `sortinganalyzer.py` (line 287).

```python
def load_sorting_analyzer(folder, load_extensions=True, format="auto", backend_options=None) -> "SortingAnalyzer":
```

Parameters:
- `folder` (`str | Path`): folder / zarr folder / remote path where the analyzer is stored. If remote and no credentials in `backend_options`, tries anonymous mode.
- `load_extensions` (`bool`, default `True`): if True, load all saved extensions.
- `format` (`"auto" | "binary_folder" | "zarr"`, default `"auto"`).
- `backend_options` (`dict | None`, default `None`): as in `create_sorting_analyzer`; keys `storage_options` and `saving_options`.

Returns: `SortingAnalyzer`. Internally forwards to `SortingAnalyzer.load(...)`.

The classmethod signature:

```python
@classmethod
def load(cls, folder, recording=None, load_extensions=True, format="auto", backend_options=None):
```

The `recording` kwarg allows re-attaching if the recording location has changed.
