# BaseExtractor (base.py) — Part A: init, ids, annotations, properties
Source in repo: `spikeinterface/src/spikeinterface/core/base.py`
Parent index: [INDEX.md](INDEX.md)
Related: [base_extractor_b.md](base_extractor_b.md), [base_recording.md](base_recording.md), [base_sorting.md](base_sorting.md)
---

## 1. BaseExtractor (base.py)

`BaseExtractor` is the abstract superclass of `BaseRecording`, `BaseSorting`, `BaseEvent`, `BaseSnippets`. It handles the "main ids" (channel ids or unit ids), annotations, properties, serialization to dict/json/pickle/folder/zarr, and metadata copying.

### Class attributes

- `default_missing_property_values = {"f": np.nan, "O": None, "S": "", "U": ""}`
- `_main_annotations = ["name"]`
- `_main_properties = []`
- `_skip_properties = []` — properties skipped by default in `copy_metadata`.
- `_precomputable_kwarg_names = []` — kwargs precomputable before use by the extractor.

### Constructor

```python
def __init__(self, main_ids: Sequence) -> None
```

`main_ids` must have dtype kind in `"uiSU"` (signed int, unsigned int, bytes, unicode).

Instance attributes initialized:
- `self._kwargs: dict = {}`
- `self._main_ids: np.ndarray`
- `self._segments: list[BaseSegment] = []`
- `self._annotations: dict = {}`
- `self._properties: dict = {}`
- `self._serializability = {"memory": True, "json": True, "pickle": True}`
- `self.extra_requirements: list = []`
- `self._preferred_mp_context = None`

### HTML repr helpers

```python
def _repr_html_(self, display_name=True)
def _get_common_repr_html(self, common_style)
```

### Properties

- `name` — getter returns `_annotations.get("name", None)` or class name; setter calls `self.annotate(name=value)` when value is not None, otherwise pops the annotation.
- `segments -> list[BaseSegment]` — returns `self._segments`.

### Segment methods

```python
def add_segment(self, segment: "BaseSegment") -> None
def get_num_segments(self) -> int
def get_parent(self) -> "BaseExtractor | None"
def _check_segment_index(self, segment_index: int | None = None) -> int
```

### ID / index conversion

```python
def ids_to_indices(
    self, ids: list | np.ndarray | tuple | None = None, prefer_slice: bool = False
) -> np.ndarray | slice
```

Converts a list of IDs (channel or unit) into indices. When `prefer_slice=True` and indices are consecutive, returns a `slice` object. If `ids is None`, returns `np.arange(len(self._main_ids))` (or `slice(None)` when `prefer_slice=True`).

```python
def id_to_index(self, id) -> int
```

### Annotations

```python
def annotate(self, **new_annotations) -> None
def set_annotation(self, annotation_key: str, value: Any, overwrite=False) -> None
def delete_annotation(self, annotation_key: str) -> None
def get_preferred_mp_context(self)
def get_annotation(self, key: str, copy: bool = True) -> Any
def get_annotation_keys(self) -> list
```

Notes:
- `set_annotation` raises `ValueError` if the key already exists and `overwrite=False`.
- `delete_annotation` raises `ValueError` if the annotation key does not exist.
- `get_annotation` returns a `deepcopy` by default.
- The class does not define bulk `set_annotations` / `get_annotations` helpers; use `annotate(**dict)` to set multiple annotations, and access `self._annotations` (or call `get_annotation` per key) to read them.

### Properties (per-channel / per-unit vectors)

```python
def set_property(
    self,
    key,
    values: list | np.ndarray | tuple,
    ids: list | np.ndarray | tuple | None = None,
    missing_value: Any = None,
) -> None
```

- If `values is None` and `key` exists in `_properties`, the property is popped.
- If `ids is None`, `values` must have the same size as `_main_ids`.
- If `ids` is provided and the property does not exist yet, a full vector of `_main_ids.size` is created, filled with `missing_value` (or the natural missing value from `default_missing_property_values` if the dtype kind is one of `"f"`, `"O"`, `"S"`, `"U"`; for int/uint the caller must supply `missing_value`).

```python
def get_property(self, key: str, ids: Iterable | None = None) -> np.ndarray
def get_property_keys(self) -> list
def delete_property(self, key) -> None
```

`delete_property` raises `Exception` if the key is not present.

### Copy / clone / metadata

```python
def copy_metadata(
    self,
    other: "BaseExtractor",
    only_main: bool = False,
    ids: Iterable | slice | None = None,
    skip_properties: Iterable[str] | None = None,
) -> None

def _extra_metadata_copy(self, other: "BaseExtractor") -> None

def clone(self) -> "BaseExtractor"
```

`copy_metadata` copies annotations and properties from `self` to `other`. When `only_main=True`, only `BaseExtractor._main_annotations` and `BaseExtractor._main_properties` are copied. Properties in `other._skip_properties + (skip_properties or [])` are skipped.

`_extra_metadata_copy` is a no-op hook overridden by subclasses (e.g. `BaseRecordingSnippets` copies the probegroup).

## Appendix: base dtypes exported by `base.py`

```python
base_peak_dtype = [
    ("sample_index", "int64"),
    ("channel_index", "int64"),
    ("amplitude", "float64"),
    ("segment_index", "int64"),
]

spike_peak_dtype = base_peak_dtype + [("unit_index", "int64")]

minimum_spike_dtype = [
    ("sample_index", "int64"),
    ("unit_index", "int64"),
    ("segment_index", "int64"),
]

base_period_dtype = [
    ("segment_index", "int64"),
    ("start_sample_index", "int64"),
    ("end_sample_index", "int64"),
]

unit_period_dtype = base_period_dtype + [("unit_index", "int64")]
```
