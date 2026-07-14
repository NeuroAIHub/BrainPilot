# SortingAnalyzer class — Part B: geometry, copy/select/merge/split, state, examples
Source in repo: `spikeinterface/src/spikeinterface/core/sortinganalyzer.py`
Parent index: [INDEX.md](INDEX.md)
Related: [sorting_analyzer_class_a.md](sorting_analyzer_class_a.md), [sorting_analyzer_constructors.md](sorting_analyzer_constructors.md)
---

### 2.3 Introspection / geometry methods

```python
def get_num_units(self) -> int:
def get_num_channels(self) -> int:
def get_num_segments(self) -> int:
def get_num_samples(self, segment_index: Optional[int] = None) -> int:
def get_total_samples(self) -> int:
def get_total_duration(self) -> float:
def get_dtype(self):
def get_probegroup(self):
def get_probe(self):                                 # asserts exactly one probe
def get_channel_locations(self) -> np.ndarray:
def channel_ids_to_indices(self, channel_ids) -> np.ndarray:
def get_recording_property(self, key) -> np.ndarray:
def get_sorting_property(self, key) -> np.ndarray:   # simple form
```

The full form of `get_sorting_property` (defined earlier in the class; the later definition at 1890 overrides with the simpler form used at runtime):

```python
def get_sorting_property(self, key: str, ids: Optional[Iterable] = None) -> np.ndarray:
```

- `key` (`str`).
- `ids` (`list | np.array | None`, default `None`).

```python
def set_sorting_property(
    self,
    key,
    values: list | np.ndarray | tuple,
    ids: list | np.ndarray | tuple | None = None,
    missing_value: Any = None,
    save: bool = True,
) -> None:
```
- `key`.
- `values` (`list | np.ndarray | tuple`).
- `ids` (`list | np.ndarray | tuple | None`, default `None`).
- `missing_value` (`Any`, default `None`).
- `save` (`bool`, default `True`).

```python
def get_sorting_provenance(self):
```
Returns the original `Sorting` if persisted (from `binary_folder` or `zarr`), otherwise `None`.

```python
def get_main_channels(self, outputs: Literal["index", "id"] = "index", with_dict: bool = False):
```
- `outputs` (`"index" | "id"`, default `"index"`).
- `with_dict` (`bool`, default `False`): if True, returns `dict[unit_id -> channel]`.

```python
def are_units_mergeable(
    self,
    merge_unit_groups: list[str | int],
    merging_mode: str = "soft",
    sparsity_overlap: float = 0.75,
    return_masks: bool = False,
):
```
- `merge_unit_groups` (`list/tuple of lists/tuples`).
- `merging_mode` (`"soft" | "hard"`, default `"soft"`).
- `sparsity_overlap` (`float`, default `0.75`).
- `return_masks` (`bool`, default `False`).

### 2.4 Copy / select / merge / split

```python
def copy(self):
```
Memory copy of the analyzer (extensions propagated).

```python
def save_as(self, format="memory", folder=None, backend_options=None) -> "SortingAnalyzer":
```
- `format` (`"memory" | "binary_folder" | "zarr"`, default `"memory"`).
- `folder` (`str | Path | None`, default `None`).
- `backend_options` (`dict | None`, default `None`): keys `storage_options`, `saving_options`.

```python
def select_units(self, unit_ids, format="memory", folder=None) -> "SortingAnalyzer":
```
- `unit_ids` (`list | array`).
- `format` (`"memory" | "binary_folder" | "zarr"`, default `"memory"`).
- `folder` (`Path | None`, default `None`).

```python
def remove_units(self, remove_unit_ids, format="memory", folder=None) -> "SortingAnalyzer":
```
- `remove_unit_ids` (`list | array`).
- `format` (`"memory" | "binary_folder" | "zarr"`, default `"memory"`).
- `folder` (`Path | None`, default `None`).

```python
def merge_units(
    self,
    merge_unit_groups: list[list[str | int]] | list[tuple[str | int]],
    new_unit_ids: list[int | str] | None = None,
    censor_ms: float | None = None,
    merging_mode: str = "soft",
    sparsity_overlap: float = 0.75,
    raise_error_if_overlap_fails: bool = True,
    new_id_strategy: str = "append",
    return_new_unit_ids: bool = False,
    format: str = "memory",
    folder: Path | str | None = None,
    verbose: bool = False,
    **job_kwargs,
) -> "SortingAnalyzer | tuple[SortingAnalyzer, list[int | str]]":
```
- `merge_unit_groups` (`list/tuple of lists/tuples`).
- `new_unit_ids` (`None | list`, default `None`).
- `censor_ms` (`None | float`, default `None`).
- `merging_mode` (`"soft" | "hard"`, default `"soft"`).
- `sparsity_overlap` (`float`, default `0.75`).
- `raise_error_if_overlap_fails` (`bool`, default `True`).
- `new_id_strategy` (`"append" | "take_first"`, default `"append"`).
- `return_new_unit_ids` (`bool`, default `False`).
- `format` (`"memory" | "binary_folder" | "zarr"`, default `"memory"`).
- `folder` (`Path | str | None`, default `None`).
- `verbose` (`bool`, default `False`).
- `**job_kwargs`.

```python
def split_units(
    self,
    split_units: dict[list[str | int], list[int] | list[list[int]]],
    new_unit_ids: list[list[int | str]] | None = None,
    new_id_strategy: str = "append",
    return_new_unit_ids: bool = False,
    format: str = "memory",
    folder: Path | str | None = None,
    verbose: bool = False,
    **job_kwargs,
) -> "SortingAnalyzer | tuple[SortingAnalyzer, list[int | str]]":
```
- `split_units` (`dict`): keys are unit ids to split, values are lists of index lists.
- `new_unit_ids` (`None | list`, default `None`).
- `new_id_strategy` (`"append" | "split"`, default `"append"`).
- `return_new_unit_ids` (`bool`, default `False`).
- `format` (`"memory" | "binary_folder" | "zarr"`, default `"memory"`).
- `folder` (`Path | str | None`, default `None`).
- `verbose` (`bool`, default `False`).
- `**job_kwargs`.

### 2.5 Temporary recording, state predicates

```python
def set_temporary_recording(self, recording: BaseRecording, check_dtype: bool = True):
```
- `recording` (`BaseRecording`).
- `check_dtype` (`bool`, default `True`).

```python
def has_recording(self) -> bool:
def has_temporary_recording(self) -> bool:
def is_sparse(self) -> bool:
def is_filtered(self) -> bool:
def is_read_only(self) -> bool:
```

### 2.6 Usage example (from docstring)

The `create_sorting_analyzer` docstring provides these representative usages:

```python
import spikeinterface as si

# Create dense analyzer and save to disk with binary_folder format.
sorting_analyzer = si.create_sorting_analyzer(sorting, recording, format="binary_folder", folder="/path/to_my/result")

# Can be reloaded
sorting_analyzer = si.load_sorting_analyzer(folder="/path/to_my/result")

# Can run extensions
sorting_analyzer = si.compute("unit_locations", ...)

# Can be copied to another format (extensions are propagated)
sorting_analyzer2 = sorting_analyzer.save_as(format="memory")
sorting_analyzer3 = sorting_analyzer.save_as(format="zarr", folder="/path/to_my/result.zarr")

# Can make a copy with a subset of units (extensions are propagated)
sorting_analyzer4 = sorting_analyzer.select_units(unit_ids=sorting.unit_ids[:5], format="memory")
sorting_analyzer5 = sorting_analyzer.select_units(unit_ids=sorting.unit_ids[:5], format="binary_folder", folder="/result_5units")
```

And from `SortingAnalyzer.compute` docstring:

```python
# Single extension with parameters
analyzer.compute("waveforms", ms_before=1.5, ms_after=2.5)

# Several extensions with a list (default parameters)
analyzer.compute(["random_spikes", "waveforms"])

# Several extensions with a dict of params
analyzer.compute({"random_spikes": {}, "waveforms": {"ms_before": 1.5, "ms_after": 2.5}})

# Several extensions via list + extension_params
analyzer.compute(["random_spikes", "waveforms"],
                 extension_params={"waveforms": {"ms_before": 1.5, "ms_after": 2.5}})
```
