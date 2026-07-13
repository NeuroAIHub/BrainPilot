# IO Extractors
Source in repo: `spikeinterface/src/spikeinterface/core/binaryrecordingextractor.py`, `binaryfolder.py`, `zarrextractors.py`, `npzsortingextractor.py`, `numpyextractors.py`, `npysnippetsextractor.py`
Parent index: [INDEX.md](INDEX.md)
Related: [numpy_extractors.md](numpy_extractors.md), [loading.md](loading.md), [loading_helpers.md](loading_helpers.md)
---

## 3. IO Extractors

### `BinaryRecordingExtractor` and `read_binary`

```python
class BinaryRecordingExtractor(BaseRecording):
    def __init__(
        self,
        file_paths,
        sampling_frequency,
        dtype,
        num_channels: int | None = None,
        t_starts=None,
        channel_ids=None,
        time_axis=0,
        file_offset=0,
        gain_to_uV=None,
        offset_to_uV=None,
        is_filtered=None,
        num_chan=None,
    ):
```
`read_binary = define_function_from_class(source_class=BinaryRecordingExtractor, name="read_binary")` — same signature.

Notes:
- `num_chan` is deprecated in favor of `num_channels`.
- `time_axis=0` means `(nb_samples, nb_channels)`, `time_axis=1` means the traces are stored `(nb_channels, nb_samples)`.

### `BinaryFolderRecording` / `read_binary_folder`

```python
class BinaryFolderRecording(BinaryRecordingExtractor):
    def __init__(self, folder_path):
```
`read_binary_folder = define_function_from_class(source_class=BinaryFolderRecording, name="read_binary_folder")`. Reads a folder produced by `recording.save(format="binary", folder=...)`. Methods: `is_binary_compatible()`, `get_binary_description()`.

### `write_binary_recording`

```python
def write_binary_recording(
    recording,
    file_paths,
    file_timestamps_paths=None,
    dtype=None,
    add_file_extension=True,
    byte_offset=0,
    verbose=False,
    **job_kwargs,
):
```
Task-note: the schema in the ticket named `auto_cast_uint`; the source does *not* accept `auto_cast_uint` here (it accepts `file_timestamps_paths` and `verbose` instead). Use the signature above.

### `write_memory_recording`

```python
def write_memory_recording(
    recording,
    dtype=None,
    verbose=False,
    buffer_type="auto",
    job_name="write_memory",
    **job_kwargs,
):
```
- `buffer_type`: `"auto"` | `"numpy"` | `"sharedmem"` (per the current docstring; the older doc mentioned `"shared_memory"` / `"memmap"`, but the source uses `"auto"` / `"numpy"` / `"sharedmem"`).
- Returns `(arrays, shms)`: `arrays` is `list[np.ndarray]` (one per segment); `shms` is a parallel list of `SharedMemory | None` (only populated when `buffer_type` resolves to `"sharedmem"`, i.e. `n_jobs > 1`).

### `write_recording_to_zarr`

```python
def write_recording_to_zarr(
    recording,
    zarr_group,
    dataset_paths,
    dataset_timestamps_paths=None,
    extra_chunks=None,
    dtype=None,
    compressor_data=None,
    filters_data=None,
    compressor_times=None,
    filters_times=None,
    verbose=False,
    **job_kwargs,
):
```

### `ZarrRecordingExtractor` / `read_zarr`

```python
class ZarrRecordingExtractor(BaseRecording):
    def __init__(
        self, folder_path: Path | str, storage_options: dict | None = None, load_compression_ratio: bool = False
    ):
```

```python
class ZarrSortingExtractor(BaseSorting):
    def __init__(self, folder_path: Path | str, storage_options: dict | None = None, zarr_group: str | None = None):
```

```python
def read_zarr(
    folder_path: str | Path, storage_options: dict | None = None
) -> ZarrRecordingExtractor | ZarrSortingExtractor:
```

Also public from `spikeinterface.core`: `get_default_zarr_compressor(clevel: int = 5)`. Note: `read_zarr_recording` and `read_zarr_sorting` are defined in `spikeinterface.core.zarrextractors` (via `define_function_from_class`) but are NOT re-exported from `spikeinterface.core.__init__` — import them from `spikeinterface.core.zarrextractors` if needed.

### `NpzSortingExtractor`

```python
class NpzSortingExtractor(BaseSorting):
    def __init__(self, file_path):
```
`.npz` archive layout: `unit_ids`, `num_segment`, `sampling_frequency`, then `spike_indexes_seg{i}` / `spike_labels_seg{i}` per segment. Static method: `write_sorting(sorting, save_path)`. Companion reader: `read_npz_sorting`.

### `NumpyFolderSorting` and `NpzFolderSorting`

```python
class NumpyFolderSorting(BaseSorting):
    mode = "folder"
    name = "NumpyFolder"
    def __init__(self, folder_path):
```

```python
class NpzFolderSorting(NpzSortingExtractor):
    mode = "folder"
    name = "npzfolder"
    def __init__(self, folder_path):
```
Companion readers: `read_numpy_sorting_folder`, `read_npz_folder`. `spikeinterface.core.npzfolder` re-exports `NpzFolderSorting` for backward compat.

### `NpyFolderSnippets`

```python
class NpyFolderSnippets(NpySnippetsExtractor):
    mode = "folder"
    name = "npyfolder"
    def __init__(self, folder_path):
```
Companion reader: `read_npy_snippets_folder`.

Note: there is no `NumpyFolderSnippets` or `read_python_template` symbol in `spikeinterface.core`. `read_python`/`write_python` live in `core_tools` (see core_tools.md).

### `NumpyRecording`

```python
class NumpyRecording(BaseRecording):
    def __init__(self, traces_list, sampling_frequency, t_starts=None, channel_ids=None):
```
- `traces_list`: list of `np.ndarray` (one per segment) OR a single `np.ndarray` (mono-segment). If passed a list of Python lists, each is coerced via `np.array(...)`.
- All arrays must share the same dtype and same `shape[1]` (channels).
- `channel_ids`: if `None`, defaults to `np.arange(traces_list[0].shape[1])`.
- Static factory: `NumpyRecording.from_recording(source_recording, **job_kwargs) -> NumpyRecording` (uses `write_memory_recording`).
- Not JSON- or pickle-serializable (in-memory only).

### `SharedMemoryRecording`

```python
class SharedMemoryRecording(BaseRecording):
    def __init__(
        self, shm_names, shape_list, dtype, sampling_frequency, channel_ids=None, t_starts=None, main_shm_owner=True
    ):
```
- `shape_list[i]` is `(num_samples_seg_i, num_channels)`; all segments must share `shape[1]`.
- `main_shm_owner=True` means this instance will `unlink` the underlying `SharedMemory` blocks in `__del__`.
- Memory-serializable but not JSON/pickle.

### `NumpySorting`

```python
class NumpySorting(BaseSorting):
    def __init__(self, spikes, sampling_frequency, unit_ids):
```
- `spikes`: structured `numpy.ndarray` of `minimum_spike_dtype` (fields: `sample_index`, `unit_index`, `segment_index`) — typically `sorting.to_spike_vector()`.
- `unit_ids`: list/array of unit ids.

Static factories:
```python
@staticmethod
def from_sorting(source_sorting: BaseSorting, with_metadata=False, copy_spike_vector=False) -> "NumpySorting":
@staticmethod
def from_samples_and_labels(samples_list, labels_list, sampling_frequency, unit_ids=None) -> "NumpySorting":
@staticmethod
def from_times_and_labels(times_list, labels_list, sampling_frequency, unit_ids=None) -> "NumpySorting":
@staticmethod
def from_unit_dict(units_dict_list, sampling_frequency) -> "NumpySorting":
@staticmethod
def from_neo_spiketrain_list(neo_spiketrains, sampling_frequency, unit_ids=None) -> "NumpySorting":
@staticmethod
def from_peaks(peaks, sampling_frequency, unit_ids) -> "NumpySorting":
```

### `SharedMemorySorting`

```python
class SharedMemorySorting(BaseSorting):
    def __init__(self, shm_name, shape, sampling_frequency, unit_ids, dtype=minimum_spike_dtype, main_shm_owner=True):
```
Only supports non-empty sortings (`shape[0] > 0`). `dtype` defaults to the `minimum_spike_dtype` structured dtype used throughout the library.

### `NumpyEvent`

```python
class NumpyEvent(BaseEvent):
    def __init__(self, channel_ids, structured_dtype):

    @staticmethod
    def from_dict(event_dict_list) -> "NumpyEvent":
```
`event_dict_list` is a list of `{channel_id: array}` dicts (one per segment); each array is either a plain time vector or a structured array with a `"time"`/`"timestamp"` field.

### `NumpySnippets`

```python
class NumpySnippets(BaseSnippets):
    def __init__(self, snippets_list, spikesframes_list, sampling_frequency, nbefore=None, channel_ids=None):
```
Snippet arrays have shape `(num_snippets, snippet_len, num_channels)`. Not JSON/pickle/memory-serializable.

### `NpySnippetsExtractor` and `read_npy_snippets`

```python
class NpySnippetsExtractor(BaseSnippets):
    mode = "file"
    name = "npy"
    def __init__(
        self, file_paths, sampling_frequency, channel_ids=None, nbefore=None, gain_to_uV=None, offset_to_uV=None
    ):

    @staticmethod
    def write_snippets(snippets, file_paths, dtype=None):
```
`read_npy_snippets = define_function_from_class(source_class=NpySnippetsExtractor, name="read_npy_snippets")`. Each segment lives in its own `.npy` archive with a structured dtype `("frame", int64), ("snippet", dtype, (snippet_len, num_channels))`.
