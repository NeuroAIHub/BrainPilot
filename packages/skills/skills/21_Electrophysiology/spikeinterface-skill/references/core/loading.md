# Loading — loading.py and back-compat aliases
Source in repo: `spikeinterface/src/spikeinterface/core/loading.py`
Parent index: [INDEX.md](INDEX.md)
Related: [loading_helpers.md](loading_helpers.md), [io_extractors.md](io_extractors.md), [sorting_analyzer_constructors.md](sorting_analyzer_constructors.md)
---

## 4. Loading — `loading.py` and back-compat aliases

### `load`

```python
def load(
    file_or_folder_or_dict,
    **kwargs,
    # load_extensions=True, backend_options=None
) -> "BaseExtractor | SortingAnalyzer | Motion | Template":
```

Supported `**kwargs`:
- `base_folder: str | Path | bool` — resolve relative paths against this folder. If `True` and input is a file, uses `file_path.parent`.
- `load_extensions: bool, default: True` — for `SortingAnalyzer` folders.
- `storage_options: dict | None, default: None` — for remote zarr Recording/Sorting.
- `backend_options: dict | None, default: None` — for zarr `SortingAnalyzer`. Keys: `storage_options`, `saving_options`.
- `load_compression_ratio: bool` — for zarr recordings.

Object autodetection is based on `object` attribute in dict/zarr attrs, on file extension (`.json`, `.pkl`, `.pickle`, `.zarr`), and on marker files in folders (`spikeinterface_info.json`, `si_folder.json`, `waveforms/`, `sorter_output/` + `spikeinterface_params.json` + `spikeinterface_log.json`, `cached.{json,pkl,pickle}`).

Recognized object types (internal): `"SortingAnalyzer"`, `"Motion"`, `"WaveformExtractor"`, `"SorterFolder"`, `"Recording"`, `"Sorting"`, `"Recording|Sorting"`, `"Templates"`, `"Group[...]"`.

Note: the current `load` signature does NOT expose an explicit `format="auto"|"binary_folder"|"zarr"|"pickle"|"json"` argument. Format is auto-detected. A `format` enum (`"auto"|"binary_folder"|"zarr"`) IS exposed by `load_sorting_analyzer` (see §Loading auxiliaries below).

### Loading auxiliaries (also public from `spikeinterface.core`)

```python
def load_sorting_analyzer(folder, load_extensions=True, format="auto", backend_options=None) -> "SortingAnalyzer":
```
- `format`: `"auto"` | `"binary_folder"` | `"zarr"`
- `backend_options` keys: `storage_options`, `saving_options` (both `dict | None`).

Also available: `get_available_analyzer_extensions()` and `get_default_analyzer_extension_params(extension_name: str)` (defined in `sortinganalyzer.py`, re-exported from `spikeinterface.core`).

```python
def load_waveforms(
    folder,
    with_recording: bool = True,
    sorting: BaseSorting | None = None,
    output="MockWaveformExtractor",
) -> MockWaveformExtractor | SortingAnalyzer:
```
- `output`: `"MockWaveformExtractor"` | `"SortingAnalyzer"`

```python
def load_sorting_analyzer_or_waveforms(folder, sorting=None):
```
Dispatches to `load_sorting_analyzer` when a newer folder is detected, otherwise to `load_waveforms(..., output="SortingAnalyzer")`.

### Old API aliases

There is no `load_extractor` symbol in `spikeinterface.core` (as of current source) — use `load(...)` for extractors, folders, dicts, JSON/pickle files, and zarr folders. The `old_api_utils` module provides adapters (also re-exported from `spikeinterface.core`), not a `load_extractor` function:
- `create_recording_from_old_extractor(oldapi_recording_extractor) -> OldToNewRecording`
- `create_sorting_from_old_extractor(oldapi_sorting_extractor) -> OldToNewSorting`
- `create_extractor_from_new_recording(new_recording)`
- `create_extractor_from_new_sorting(new_sorting)`

Example (from the `load` docstring):

```python
import spikeinterface as si

# JSON / pickle
rec = si.load("/path/to/recording.json")
sorting = si.load("/path/to/sorting.pkl")

# Folder produced by extractor.save(format="binary_folder" or "zarr")
rec = si.load("/path/to/binary_folder")
rec = si.load("/path/to/foo.zarr")

# Remote zarr
rec = si.load("s3://bucket/foo.zarr", storage_options={"anon": True})

# SortingAnalyzer folder / zarr
analyzer = si.load("/path/to/analyzer_folder", load_extensions=True)

# Motion / Templates
motion = si.load("/path/to/motion_folder")
templates = si.load("/path/to/templates.zarr")
```
