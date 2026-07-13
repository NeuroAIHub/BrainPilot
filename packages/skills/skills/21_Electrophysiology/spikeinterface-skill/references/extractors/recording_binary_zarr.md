# Binary / Zarr (core) recording extractors
Source in repo: `spikeinterface/src/spikeinterface/core/` (binaryrecordingextractor.py, binaryfolder.py, zarrextractors.py, numpyextractors.py)
Parent index: [INDEX.md](INDEX.md)
---

Both are re-exported from `spikeinterface.core` through `spikeinterface.extractors`. These are the entries in `_recording_extractor_full_dict` that are exposed as classes rather than `read_*` wrappers (`BinaryFolderRecording`, `BinaryRecordingExtractor`, `ZarrRecordingExtractor`, `NumpyRecording`), plus the two `read_binary` / `read_zarr` convenience wrappers.

## `read_binary` (raw binary files)

Source: `core/binaryrecordingextractor.py`.

```python
class BinaryRecordingExtractor(BaseRecording):
    def __init__(
        self,
        file_paths,                              # str | Path | list[str | Path]
        sampling_frequency,                      # float
        dtype,                                   # str | np.dtype
        num_channels: int | None = None,
        t_starts=None,                           # None | list[float] (one per segment)
        channel_ids=None,                        # list | None
        time_axis=0,
        file_offset=0,
        gain_to_uV=None,                         # float | array-like | None
        offset_to_uV=None,                       # float | array-like | None
        is_filtered=None,                        # bool | None
        num_chan=None,                           # deprecated alias for num_channels
    ):
        """When both num_channels and num_chan are provided, num_channels is used
        and num_chan is ignored."""

    @staticmethod
    def write_recording(recording, file_paths, dtype=None, **job_kwargs): ...

read_binary = define_function_from_class(source_class=BinaryRecordingExtractor, name="read_binary")
```

Return type: `BinaryRecordingExtractor`.

## `BinaryFolderRecording` (spikeinterface-internal binary folder)

Source: `core/binaryfolder.py`. Created by `recording.save(format="binary", folder=...)`.

```python
class BinaryFolderRecording(BinaryRecordingExtractor):
    def __init__(self, folder_path): ...

read_binary_folder = define_function_from_class(source_class=BinaryFolderRecording, name="read_binary_folder")
```

Return type: `BinaryFolderRecording`. Exposed as a class in `spikeinterface.extractors` (there is no top-level `read_binary_folder` in `spikeinterface.extractors`).

## `read_zarr` (recording or sorting)

Source: `core/zarrextractors.py`.

```python
class ZarrRecordingExtractor(BaseRecording):
    def __init__(
        self,
        folder_path: Path | str,
        storage_options: dict | None = None,
        load_compression_ratio: bool = False,
    ): ...

read_zarr_recording = define_function_from_class(source_class=ZarrRecordingExtractor, name="read_zarr_recording")

def read_zarr(
    folder_path: str | Path,
    storage_options: dict | None = None,
) -> ZarrRecordingExtractor | ZarrSortingExtractor:
    """
    Read recording or sorting from a zarr format. Dispatches on the
    'zarr_class_info' attribute (or presence of 'channel_ids' / 'unit_ids' for legacy files).
    """
```

Return type of `read_zarr`: `ZarrRecordingExtractor` or `ZarrSortingExtractor`.

## `NumpyRecording` (in-memory, class-only)

Source: `spikeinterface.core.numpyextractors`. Exposed as a class (no `read_*`).

```python
class NumpyRecording(BaseRecording):
    """Wrap a numpy array or list of arrays as a recording. See core docs for full signature."""
```
