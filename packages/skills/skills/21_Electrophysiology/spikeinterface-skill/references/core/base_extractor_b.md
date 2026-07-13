# BaseExtractor (base.py) — Part B: serialization, dump/load, save
Source in repo: `spikeinterface/src/spikeinterface/core/base.py`
Parent index: [INDEX.md](INDEX.md)
Related: [base_extractor_a.md](base_extractor_a.md), [base_recording.md](base_recording.md), [loading.md](loading.md)
---

### Dict serialization

```python
def to_dict(
    self,
    include_annotations: bool = False,
    include_properties: bool = False,
    relative_to: str | Path | None = None,
    folder_metadata=None,
    recursive: bool = False,
) -> dict

@staticmethod
def from_dict(dictionary: dict, base_folder: Path | str | None = None) -> "BaseExtractor"
```

Returned dict layout (from the docstring):

```
{
    "class": <the full import path of the class>,
    "module": <module name>,
    "kwargs": <the values that were used to initialize the class>,
    "version": <module version>,
    "relative_paths": <whether paths are relative>,
    "annotations": <annotations dictionary, if include_annotations is True>,
    "properties": <properties dictionary, if include_properties is True>,
    "folder_metadata": <relative path to folder_metadata, if specified>
}
```

Example (from the docstring):

```python
>>> dump_dict = original_extractor.to_dict()
>>> reloaded_extractor = load_extractor_from_dict(dump_dict)
```

### Metadata folder round-trip

```python
def load_metadata_from_folder(self, folder_metadata)
def save_metadata_to_folder(self, folder_metadata)
```

### Serializability checks

```python
def check_serializability(self, type)          # type in {"memory", "json", "pickle"}
def check_if_memory_serializable(self) -> bool
def check_if_json_serializable(self) -> bool
def check_if_pickle_serializable(self) -> bool
```

Note: there is no `is_dumpable` method on `BaseExtractor`. Serializability is exposed via `check_if_json_serializable()` / `check_if_pickle_serializable()` / `check_if_memory_serializable()` (and the underlying `check_serializability("json" | "pickle" | "memory")`).

### Static helpers

```python
@staticmethod
def _get_file_path(file_path: str | Path, extensions: Sequence) -> Path
```

Adds the first extension if missing and validates the file suffix against the allowed extensions list.

### Dump / load JSON and pickle

```python
def dump(self, file_path: str | Path, relative_to=None, folder_metadata=None) -> None
```

`file_path` extension must be `.json`, `.pkl`, or `.pickle` (otherwise `ValueError`).

```python
def dump_to_json(
    self,
    file_path: str | Path | None = None,
    relative_to: str | Path | bool | None = None,
    folder_metadata: str | Path | None = None,
) -> None

def dump_to_pickle(
    self,
    file_path: str | Path | None = None,
    relative_to: str | Path | bool | None = None,
    include_properties: bool = True,
    folder_metadata: str | Path | None = None,
)

@staticmethod
def load(file_or_folder_path: str | Path, base_folder: Path | str | bool | None = None) -> "BaseExtractor"

@staticmethod
def load_from_folder(folder) -> "BaseExtractor"       # backward-compat wrapper for load

def __reduce__(self)
```

`relative_to`: if `True`, the reference folder is `Path(file_path).parent`; if a path is given, it is resolved and used as the relative root. When set, kwargs paths in the dumped dict are stored relative rather than absolute.

Pickle support: `__reduce__` returns `(self.from_dict, (self.to_dict(),))`.

### Extra-metadata hooks (overridable by subclasses)

```python
def _save(self, folder, **save_kwargs)                  # NotImplementedError; overridden by BaseRecording / BaseSorting / BaseSnippets
def _extra_metadata_from_folder(self, folder)
def _extra_metadata_to_folder(self, folder)
def _extra_metadata_from_dict(self, dump_dict)
def _extra_metadata_to_dict(self, dump_dict)
```

### Save (memory / binary folder / zarr)

```python
def save(self, **kwargs) -> "BaseExtractor"
```

Dispatch by `format`:
- `"memory"` -> `save_to_memory(**kwargs)`
- `"zarr"` -> `save_to_zarr(**kwargs)`
- any other value (or None) -> `save_to_folder(**kwargs)`

Recognized `kwargs` keys (from the docstring):
- `format`: `"memory"`, `"zarr"`, or `"binary"` (for recording) / `"memory"` or `"numpy_folder"` or `"npz_folder"` (for sorting).
- `folder`: destination folder path.
- `name`: subfolder name inside the global temporary folder (used if `folder` is not given).
- `dump_ext`: `"json"` or `"pkl"`, default `"json"` (if format is "folder").
- `verbose`: bool.
- Additional `save_kwargs` are format-dependent + job kwargs for recordings.

```python
def save_to_memory(self, sharedmem=True, **save_kwargs) -> "BaseExtractor"

def save_to_folder(
    self,
    name: str | None = None,
    folder: str | Path | None = None,
    overwrite: bool = False,
    verbose: bool = True,
    **save_kwargs,
)

def save_to_zarr(
    self,
    name=None,
    folder=None,
    overwrite=False,
    storage_options=None,
    channel_chunk_size=None,
    verbose=True,
    **save_kwargs,
)
```

`save_to_folder` uses `get_global_tmp_folder()` when neither `folder` nor `name` is given, and generates an 8-character random alphanumeric name. It writes:
- `provenance.json` (or `provenance.pkl` if not json-serializable),
- data via `self._save(folder=folder, verbose=verbose, **save_kwargs)`,
- `si_folder.json` (dump of the cached extractor with `relative_to=folder`).

`save_to_zarr` extra `save_kwargs` recognized in the docstring:
- `compressor`: `numcodecs.Codec | None` (default: Blosc-zstd, level 5, bit shuffle when None).
- `filters`: `list[numcodecs.Codec] | None`.
- `compressor_by_dataset`: `dict | None`, optional per-dataset compressor for `"traces"` and `"times"`.
- `filters_by_dataset`: `dict | None`, optional per-dataset filters for `"traces"` and `"times"`.
- `auto_cast_uint`: `bool`, default `True` (recording only).

### `BaseSegment`

```python
class BaseSegment:
    def __init__(self)

    @property
    def parent_extractor(self) -> BaseExtractor | None

    def set_parent_extractor(self, parent_extractor: BaseExtractor) -> None
```

`parent_extractor` is stored as a `weakref.ref`; the property call dereferences it.
