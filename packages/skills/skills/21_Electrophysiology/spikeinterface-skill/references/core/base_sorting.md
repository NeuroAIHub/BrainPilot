# BaseSorting / BaseSortingSegment (basesorting.py)
Source in repo: `spikeinterface/src/spikeinterface/core/basesorting.py`
Parent index: [INDEX.md](INDEX.md)
Related: [base_extractor_a.md](base_extractor_a.md), [base_recording_b.md](base_recording_b.md), [numpy_extractors.md](numpy_extractors.md)
---

## 3. BaseSorting / BaseSortingSegment (basesorting.py)

Class attributes:
- `_main_properties = ["main_channel_id"]`

Constructor:

```python
def __init__(self, sampling_frequency: float, unit_ids: list)
```

Initializes caching attributes:
- `self._recording = None`
- `self._sorting_info = None`
- `self._cached_spike_vector = None`
- `self._cached_spike_vector_segment_slices = None`
- `self._cached_spike_vector_to_indices = None`
- `self._cached_lexsorted_spike_vector = {}`

Repr helpers:

```python
def __repr__(self)
def _repr_header(self, display_name=True)
def _repr_html_(self, display_name=True)
```

Properties:
- `segments -> list[BaseSortingSegment]`
- `_sorting_segments -> list[BaseSortingSegment]` (backward compat)
- `unit_ids` -> `self._main_ids`
- `sampling_frequency` -> `self._sampling_frequency`

Basic getters:

```python
def get_unit_ids(self) -> list
def get_num_units(self) -> int
def add_sorting_segment(self, sorting_segment: "BaseSortingSegment") -> None
def get_sampling_frequency(self) -> float
```

(`get_num_segments` and `get_property` / `set_property` are inherited from `BaseExtractor`.)

Recording-linked size:

```python
def get_num_samples(self, segment_index=None) -> int      # requires has_recording()
def get_total_samples(self) -> int                        # sum over segments
def get_total_duration(self) -> float                     # requires has_recording()
```

There is no `get_num_frames` on `BaseSorting`. Use `get_num_samples`.

### Spike train access

```python
def get_unit_spike_train(
    self,
    unit_id: str | int,
    segment_index: int | None = None,
    start_frame: int | None = None,
    end_frame: int | None = None,
    return_times: bool = False,
    use_cache: bool = True,
) -> np.ndarray
```

Behavior:
- If `return_times=True`, delegates to `get_unit_spike_train_in_seconds(...)`.
- Otherwise, if `use_cache=True` (or the lexsorted cache with key `("sample_index", "segment_index", "unit_index")` is already computed), uses `to_reordered_spike_vector(...)` to retrieve a compact per-unit-per-segment slice.
- Filters with `np.searchsorted` at `start_frame` and `end_frame`.

```python
def get_unit_spike_train_in_seconds(
    self,
    unit_id: str | int,
    segment_index: int | None = None,
    start_time: float | None = None,
    end_time: float | None = None,
) -> np.ndarray
```

Three-tier strategy (from the docstring): 1) if a recording is registered, use the recording's time conversion; 2) otherwise, if the segment implements `get_unit_spike_train_in_seconds`, use it (with the `_t_start - _native_t_start` shift); 3) otherwise fall back to standard frame-to-time conversion.

### Recording registration

```python
def register_recording(self, recording, check_spike_frames: bool = True)
def has_recording(self) -> bool
```

`register_recording` asserts the same sampling frequency (`atol=0.1`) and same number of segments; optionally warns if any spikes exceed the recording's range. It also copies `recording.get_start_time(segment_index=...)` into each segment's `_t_start` and `_native_t_start`.

### Sorting info

```python
@property
def sorting_info(self)                                  # reads annotation "__sorting_info__"
def set_sorting_info(self, recording_dict, params_dict, log_dict)
```

### Time handling on sorting

```python
def has_time_vector(self, segment_index: int | None = None) -> bool
def get_start_time(self, segment_index: int | None = None) -> float
def shift_times(self, shift: int | float, segment_index: int | None = None) -> None
def get_end_time(self, segment_index: int | None = None) -> float
def get_last_spike_frame(self, segment_index: int | None = None) -> int
def get_times(
    self,
    segment_index: int | None = None,
    start_frame: int | None = None,
    end_frame: int | None = None,
)
def time_to_sample_index(self, time, segment_index=0)
def sample_index_to_time(
    self, sample_index: int | np.ndarray, segment_index: int | None = None
) -> float | np.ndarray
```

`get_times` returns `None` when no recording is registered.

### Save backend

```python
def _save(self, format="numpy_folder", **save_kwargs)
```

Supported formats: `"numpy_folder"`, `"zarr"`, `"npz_folder"`, `"memory"`.

### Unit-level properties

```python
def get_unit_property(self, unit_id, key)
```

(Bulk `get_property` / `set_property` / `get_property_keys` are inherited from `BaseExtractor`.)

### Spike counts

```python
def count_num_spikes_per_unit(self, outputs="dict", unit_ids=None)
def count_total_num_spikes(self) -> int
```

`outputs` must be `"dict"` or `"array"`. When `unit_ids` is provided, `outputs` must be `"dict"`.

### Unit selection / renaming

```python
def select_units(self, unit_ids, renamed_unit_ids=None) -> "BaseSorting"
def rename_units(self, new_unit_ids: np.ndarray | list) -> "BaseSorting"
def remove_units(self, remove_unit_ids) -> "BaseSorting"
def remove_empty_units(self)
def get_non_empty_unit_ids(self) -> np.ndarray
def get_empty_unit_ids(self) -> np.ndarray
```

### Frame / time / period slicing

```python
def frame_slice(self, start_frame, end_frame, check_spike_frames=True)
def time_slice(self, start_time: float | None, end_time: float | None) -> "BaseSorting"
def select_periods(self, periods)
def split_by(self, property="group", outputs="dict")     # outputs in {"dict", "list"}
```

### Spike vector

```python
def precompute_spike_trains(self)
def _compute_and_cache_spike_vector(self) -> None

def to_spike_vector(
    self,
    concatenated=True,
    extremum_channel_inds=None,
    main_channel_indices=None,
    use_cache=True,
    return_slices=False,
) -> np.ndarray | list[np.ndarray]
```

- `concatenated=True` returns one structured `np.array` with fields `("sample_index", "unit_index", "segment_index")`. `concatenated=False` returns one such array per segment.
- `extremum_channel_inds` is deprecated (removal announced as 0.016.0 in the source); use `main_channel_indices` (an array indexed by `unit_index`) to add a `"channel_index"` field.
- `use_cache=True` caches the spike vector on the object (`_cached_spike_vector`). Caching only occurs when `main_channel_indices is None`.
- `return_slices=True` returns `(spikes, segment_slices)`.

```python
def get_spike_vector_to_indices(self)
def _get_spike_vector_segment_slices(self)

def to_reordered_spike_vector(
    self,
    lexsort=("sample_index", "segment_index", "unit_index"),
    return_order=True,
    return_slices=True,
)
```

Allowed `lexsort` tuples (asserted): `("unit_index", "sample_index", "segment_index")`, `("sample_index", "unit_index", "segment_index")`, `("sample_index", "segment_index", "unit_index")`. For the first, `return_order` and `return_slices` must both be `False`.

### Conversions between sorting backends

```python
def to_numpy_sorting(self, propagate_cache=True)
def to_shared_memory_sorting(self)
def to_multiprocessing(self, n_jobs)
```

### BaseSortingSegment

```python
class BaseSortingSegment(BaseSegment):
    def __init__(self, t_start=None)

    def get_unit_spike_train(
        self,
        unit_id,
        start_frame: int | None = None,
        end_frame: int | None = None,
    ) -> np.ndarray
```

Attributes set by `__init__`: `self._t_start = t_start`, `self._native_t_start = t_start`. The `_native_t_start` is used so that `shift_times` computes a delta relative to the extractor's original start time.

Concrete helper subclass `SpikeVectorSortingSegment(BaseSortingSegment)`:

```python
def __init__(self, spikes, segment_index, unit_ids)
def get_unit_spike_train(self, unit_id, start_frame, end_frame)
```

Slices `spikes` by `segment_index` on first access, then filters with `np.searchsorted` on `sample_index`.

Note: there is no public `get_all_spike_trains()` method on `BaseSorting`. The canonical way to obtain all spikes at once is `to_spike_vector(concatenated=True | False)`.
