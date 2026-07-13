# Numpy extractors (numpyextractors.py)
Source in repo: `spikeinterface/src/spikeinterface/core/numpyextractors.py`
Parent index: [INDEX.md](INDEX.md)
Related: [base_recording_b.md](base_recording_b.md), [base_sorting.md](base_sorting.md), [base_event.md](base_event.md), [base_snippets.md](base_snippets.md), [io_extractors.md](io_extractors.md)
---

## 8. Numpy extractors (numpyextractors.py)

### 8.1 NumpyRecording

```python
class NumpyRecording(BaseRecording):
    def __init__(self, traces_list, sampling_frequency, t_starts=None, channel_ids=None)
```

- `traces_list`: a list of `np.ndarray` (one per segment). A single `np.ndarray` is auto-wrapped into a one-element list. Lists of lists are converted to numpy arrays. All arrays must share the same dtype.
- `channel_ids`: optional; defaults to `np.arange(traces_list[0].shape[1])`.
- `t_starts`: optional list of floats, one per segment.
- Serializability: `json=False`, `pickle=False`.

Class method:

```python
@staticmethod
def from_recording(source_recording, **job_kwargs)
```

Writes the source recording into a (possibly shared-memory) buffer via `write_memory_recording`, then constructs a `NumpyRecording` from the resulting `traces_list` and the source's `t_starts` and `channel_ids`.

Helper segment:

```python
class NumpyRecordingSegment(BaseRecordingSegment):
    def __init__(self, traces, sampling_frequency, t_start)
    def get_num_samples(self) -> int
    def get_traces(self, start_frame, end_frame, channel_indices)
```

### 8.2 SharedMemoryRecording

```python
class SharedMemoryRecording(BaseRecording):
    def __init__(
        self,
        shm_names,
        shape_list,
        dtype,
        sampling_frequency,
        channel_ids=None,
        t_starts=None,
        main_shm_owner=True,
    )

    @staticmethod
    def from_recording(source_recording, **job_kwargs)
```

Serializability: `memory=True`, `json=False`, `pickle=False`. Only the "main" owner unlinks the shared-memory buffer on `__del__`.

### 8.3 NumpySorting

```python
class NumpySorting(BaseSorting):
    def __init__(self, spikes, sampling_frequency, unit_ids)
```

`spikes` must be a structured numpy array with `minimum_spike_dtype = [("sample_index", "int64"), ("unit_index", "int64"), ("segment_index", "int64")]`. The class caches the spike vector directly on the instance (`_cached_spike_vector = spikes`).

Serializability: `memory=True`, `json=False`, `pickle=True`.

Factory class methods:

```python
@staticmethod
def from_sorting(
    source_sorting: BaseSorting,
    with_metadata=False,
    copy_spike_vector=False,
) -> "NumpySorting"

@staticmethod
def from_samples_and_labels(
    samples_list,
    labels_list,
    sampling_frequency,
    unit_ids=None,
) -> "NumpySorting"

@staticmethod
def from_times_and_labels(
    times_list,
    labels_list,
    sampling_frequency,
    unit_ids=None,
) -> "NumpySorting"

@staticmethod
def from_unit_dict(units_dict_list, sampling_frequency) -> "NumpySorting"

@staticmethod
def from_neo_spiketrain_list(
    neo_spiketrains,
    sampling_frequency,
    unit_ids=None,
) -> "NumpySorting"

@staticmethod
def from_peaks(peaks, sampling_frequency, unit_ids) -> "NumpySorting"
```

Notes:
- `from_samples_and_labels`: `samples_list` / `labels_list` may each be a single `np.ndarray` (single-segment) or a `list` of arrays (multi-segment). `unit_ids` defaults to the union of unique labels across segments.
- `from_times_and_labels`: same shape rules; internally converts times (in seconds) to sample indices via `np.round(t * sampling_frequency).astype("int64")` and delegates to `from_samples_and_labels`.
- `from_unit_dict`: `units_dict_list` is a list of dicts (one per segment) mapping `unit_id -> np.ndarray` of spike sample indices. A single dict is auto-wrapped.
- `from_neo_spiketrain_list`: accepts a list of `neo.SpikeTrain` (single-segment) or a list of lists (multi-segment).
- `from_peaks`: consumes a peaks structured array (as returned by `detect_peaks()`) and treats `channel_index` as `unit_index`.

The public API name is `from_samples_and_labels` (and `from_times_and_labels`). There is no `from_times_labels` alias.

### 8.4 SharedMemorySorting

```python
class SharedMemorySorting(BaseSorting):
    def __init__(
        self,
        shm_name,
        shape,
        sampling_frequency,
        unit_ids,
        dtype=minimum_spike_dtype,
        main_shm_owner=True,
    )

    @staticmethod
    def from_sorting(source_sorting, with_metadata=False)
```

Requires a non-empty sorting (`shape[0] > 0`). Serializability: `memory=True`, `json=False`, `pickle=False`.

### 8.5 NumpyEvent

```python
class NumpyEvent(BaseEvent):
    def __init__(self, channel_ids, structured_dtype)

    @staticmethod
    def from_dict(event_dict_list)
```

`from_dict` accepts a list of dicts (one per event segment), keyed by `channel_id`. A single dict is auto-wrapped. If values have a simple dtype, they are treated as timestamps; if structured, they must contain a `"time"` or `"timestamp"` field.

Helper segment:

```python
class NumpyEventSegment(BaseEventSegment):
    def __init__(self, event_dict)
    def get_events(self, channel_id, start_time, end_time)
```

### 8.6 NumpySnippets

```python
class NumpySnippets(BaseSnippets):
    def __init__(
        self,
        snippets_list,
        spikesframes_list,
        sampling_frequency,
        nbefore=None,
        channel_ids=None,
    )
```

- `snippets_list`: list of arrays of shape `(num_snippets, snippet_len, num_channels)`; a single array is auto-wrapped.
- `spikesframes_list`: list of 1D arrays of spike frames per segment; a single array is auto-wrapped.
- `channel_ids`: defaults to `np.arange(snippets_list[0].shape[2])`.
- `snippet_len` is inferred from `snippets_list[0].shape[1]`.
- Serializability: `memory=False`, `json=False`, `pickle=False`.

Helper segment:

```python
class NumpySnippetsSegment(BaseSnippetsSegment):
    def __init__(self, snippets, spikesframes)

    def get_snippets(
        self,
        indices,
        channel_indices: list | None = None,
    ) -> np.ndarray

    def get_num_snippets(self)

    def frames_to_indices(
        self,
        start_frame: int | None = None,
        end_frame: int | None = None,
    )

    def get_frames(self, indices=None)
```
