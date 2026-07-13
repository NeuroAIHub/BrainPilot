# Core Tools — core_tools.py
Source in repo: `spikeinterface/src/spikeinterface/core/core_tools.py`
Parent index: [INDEX.md](INDEX.md)
Related: [recording_tools.md](recording_tools.md), [job_tools.md](job_tools.md), [loading.md](loading.md)
---

## 9. Core Tools — `core_tools.py`

### `check_json`

```python
def check_json(dictionary: dict) -> dict:
```
Serializes then re-loads a dict via `SIJsonEncoder` to normalize objects to JSON-safe primitives.

### `add_suffix`

```python
def add_suffix(file_path, possible_suffix):
```
Appends `possible_suffix[0]` (a str or list of strs; each leading `.` is normalized) unless the path already ends in one of the allowed suffixes.

### `read_python` / `write_python`

```python
def read_python(path):
```
Parses a Python-syntax file into a dict (case-lowered keys).

```python
def write_python(path, dict):
```
Writes a dict as `key = value` lines.

### `make_paths_relative` / `make_paths_absolute`

```python
def make_paths_relative(input_dict: dict, relative_folder: str | Path) -> dict:
def make_paths_absolute(input_dict, base_folder) -> dict:
```
Return a deep-copy of an extractor dict with all path-like values transformed. `make_paths_relative` only transforms existing paths.

### Other helpers in `core_tools.py`

Only `read_python`, `write_python`, `normal_pdf`, and `ms_to_samples` are re-exported from `spikeinterface.core.__init__`. The rest must be imported from `spikeinterface.core.core_tools`.

- `define_function_from_class(source_class, name)` — thin identity renamer (returns `source_class`).
- `define_function_handling_dict_from_class(source_class, name)` — accepts either a single recording or a dict of recordings.
- `check_paths_relative(input_dict, relative_folder) -> bool`
- `clean_zarr_folder_name(folder)` — ensures a `.zarr` suffix.
- `make_shared_array(shape, dtype)` — returns `(arr, SharedMemory)`.
- `is_dict_extractor(d: dict) -> bool`
- `extractor_dict_iterator(extractor_dict: dict) -> Generator[extractor_dict_element, None, None]`
- `set_value_in_extractor_dict(extractor_dict: dict, access_path: tuple, new_value)`
- `recursive_path_modifier(d, func, target="path", copy=True) -> dict`
- `recursive_key_finder(d, key)`
- `convert_seconds_to_str(seconds: float, long_notation: bool = True) -> str`
- `convert_bytes_to_str(byte_value: int) -> str`
- `convert_string_to_bytes(memory_string: str) -> int`
- `is_editable_mode() -> bool`
- `normal_pdf(x, mu: float = 0.0, sigma: float = 1.0)`
- `retrieve_importing_provenance(a_class) -> dict`
- `measure_memory_allocation(measure_in_process: bool = True) -> float`
- `is_path_remote(path: str | Path) -> bool`
- `ms_to_samples(ms: float, sampling_frequency: float) -> int`
- `SIJsonEncoder(json.JSONEncoder)`
