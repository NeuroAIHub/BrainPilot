# BaseRecording — Part B: traces, time, segments
Source in repo: `spikeinterface/src/spikeinterface/core/baserecording.py`, `time_series.py`
Parent index: [INDEX.md](INDEX.md)
Related: [base_recording_a.md](base_recording_a.md), [frame_slice.md](frame_slice.md), [channel_slice.md](channel_slice.md)
---

### 2.2 BaseRecording (baserecording.py)

Class attributes:
- `_main_annotations = BaseRecordingSnippets._main_annotations + ["is_filtered"]`
- `_main_properties = ["group", "gain_to_uV", "offset_to_uV", "gain_to_physical_unit", "offset_to_physical_unit", "physical_unit"]`
- `_main_features = []`
- `_skip_properties = ["noise_level_std_raw", "noise_level_std_scaled", "noise_level_mad_raw", "noise_level_mad_scaled", "noise_level_rms_raw", "noise_level_rms_scaled"]`

Constructor:

```python
def __init__(self, sampling_frequency: float, channel_ids: list, dtype)
```

Annotates `is_filtered=False` at init.

Repr helpers:

```python
def __repr__(self)
def _repr_header(self, display_name=True)
def _repr_html_(self, display_name=True)
```

Operators: `__add__` returns `AddRecordings(self, other)`; `__sub__` returns `SubtractRecordings(self, other)`.

```python
def __add__(self, other)
def __sub__(self, other)
```

Properties:
- `segments -> list[BaseRecordingSegment]`
- `_recording_segments -> list[BaseRecordingSegment]` (backward-compat alias for `segments`)

Segment management and sizes:

```python
def add_recording_segment(self, recording_segment: "BaseRecordingSegment") -> None

def get_sample_size_in_bytes(self, dtype=None)

def get_num_samples(self, segment_index: int | None = None) -> int
get_num_frames = get_num_samples                       # class-level alias
```

There is no `get_num_samples_in_segment` method on `BaseRecording` — the equivalent is `get_num_samples(segment_index=...)`. On `BaseRecordingSegment`, use `segment.get_num_samples()`.

Traces:

```python
def get_traces(
    self,
    segment_index: int | None = None,
    start_frame: int | None = None,
    end_frame: int | None = None,
    channel_ids: list | np.ndarray | tuple | None = None,
    order: Literal["C", "F"] | None = None,
    return_scaled: bool | None = None,
    return_in_uV: bool = False,
) -> np.ndarray
```

Behavior:
- `segment_index` is required for multi-segment recordings.
- `start_frame` defaults to `0`; `end_frame` defaults to `rs.get_num_samples()` (and is clipped to `num_samples`).
- `channel_ids=None` means all channels; internally converted with `ids_to_indices(..., prefer_slice=True)`.
- `order` must be one of `"C"` or `"F"` (or `None`); when set, `np.asanyarray(traces, order=order)` is used.
- `return_scaled` is deprecated (removal in 0.105.0); use `return_in_uV`.
- `return_in_uV=True` requires `gain_to_uV` and `offset_to_uV` properties, unless the recording dtype is float (`kind == "f"`), in which case data is assumed already scaled. When scaling is applied, `traces = traces.astype("float32") * gains + offsets`.
- No `cast_unsigned` parameter is defined on `get_traces`; unsigned-to-signed casting is a `save_to_zarr` concern (`auto_cast_uint`).

```python
def get_data(self, start_frame: int, end_frame: int, segment_index: int | None = None, **kwargs) -> np.ndarray
def get_shape(self, segment_index: int | None = None) -> tuple[int, ...]
```

Save backend:

```python
def _save(self, format="binary", verbose: bool = False, **save_kwargs)
```

Supported `format` values: `"binary"`, `"memory"`, `"zarr"`, `"nwb"` (raises `NotImplementedError`).

Recording-specific metadata folder hooks:

```python
def _extra_metadata_from_folder(self, folder)
def _extra_metadata_to_folder(self, folder)
```

Load / save any per-segment time vectors alongside probe metadata (delegates to `BaseRecordingSnippets` for the probe part).

Channel selection / renaming:

```python
def select_channels(self, channel_ids: list | np.ndarray | tuple) -> "BaseRecording"
def rename_channels(self, new_channel_ids: list | np.ndarray | tuple) -> "BaseRecording"
def _remove_channels(self, remove_channel_ids)
```

Frame / time slicing / segment selection:

```python
def frame_slice(self, start_frame: int | None, end_frame: int | None) -> "BaseRecording"
def time_slice(self, start_time: float | None, end_time: float | None) -> "BaseRecording"
def _select_segments(self, segment_indices)
```

Note: `time_slice` requires a single-segment recording. It uses `time_to_sample_index` for the interval endpoints and raises `ValueError` if the interval is outside `[get_start_time(), get_end_time()]`.

Channel locations (override of the mixin version):

```python
def get_channel_locations(
    self,
    channel_ids: list | np.ndarray | tuple | None = None,
    axes: Literal["xy", "yz", "xz", "xyz"] = "xy",
) -> np.ndarray
```

Binary compatibility:

```python
def is_binary_compatible(self) -> bool                    # False by default; overridden by subclasses
def get_binary_description(self)                          # NotImplementedError if not binary-compatible

def binary_compatible_with(
    self,
    dtype=None,
    time_axis=None,
    file_paths_length=None,
    file_offset=None,
    file_suffix=None,
)
```

Astype:

```python
def astype(self, dtype, round: bool | None = None)
```

### 2.3 TimeSeries mixin methods inherited by BaseRecording (time_series.py)

`BaseRecording` inherits these directly from the `TimeSeries` abstract mixin.

Multiprocessing hint:

```python
def get_preferred_mp_context(self)
```

Memory:

```python
def get_memory_size(self, segment_index=None) -> int
def get_total_memory_size(self) -> int
```

Time info / times / start / end:

```python
def get_time_info(self, segment_index=None) -> dict
# returns {"sampling_frequency": ..., "t_start": ..., "time_vector": ...}

def get_times(self, segment_index=None, start_frame=None, end_frame=None) -> np.ndarray
def get_start_time(self, segment_index=None) -> float
def get_end_time(self, segment_index=None) -> float
def has_time_vector(self, segment_index: Optional[int] = None)
```

Set / reset / shift times:

```python
def set_times(self, times, segment_index=None, with_warning=True)
def reset_times(self)
def shift_times(self, shift: int | float, segment_index: int | None = None) -> None
```

`set_times` casts `times` to `float64` and asserts `times.ndim == 1` and `rs.get_num_samples() == times.shape[0]`.

Sample / time conversion:

```python
def sample_index_to_time(self, sample_ind, segment_index=None)
def time_to_sample_index(self, time_s, segment_index=None)
```

Totals:

```python
def get_total_samples(self) -> int
def get_duration(self, segment_index=None) -> float
def get_total_duration(self) -> float
```

`get_duration` returns `get_end_time(segment_index) - get_start_time(segment_index) + (1 / get_sampling_frequency())`.

### 2.4 BaseRecordingSegment (baserecording.py)

Inherits from `TimeSeriesSegment` (which stores `sampling_frequency`, `t_start`, `time_vector`).

```python
def get_traces(
    self,
    start_frame: int | None = None,
    end_frame: int | None = None,
    channel_indices: list | np.ndarray | tuple | None = None,
) -> np.ndarray
# must be implemented in subclass

def get_data(
    self,
    start_frame: int,
    end_frame: int,
    indices: list | np.ndarray | tuple | None = None,
) -> np.ndarray
```

From `TimeSeriesSegment`, the segment exposes:

```python
def __init__(
    self,
    sampling_frequency: float | None = None,
    t_start: float | None = None,
    time_vector: "TimeVector | None" = None,
) -> None

def get_times(self, start_frame: int | None = None, end_frame: int | None = None) -> np.ndarray
def get_start_time(self) -> float
def get_end_time(self) -> float
def get_times_kwargs(self) -> dict
def sample_index_to_time(self, sample_ind)
def time_to_sample_index(self, time_s)
def get_num_samples(self) -> int      # must be implemented in subclasses
```
