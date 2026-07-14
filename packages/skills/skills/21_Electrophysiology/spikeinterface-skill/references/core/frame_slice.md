# FrameSlice extractors (frameslicerecording.py)
Source in repo: `spikeinterface/src/spikeinterface/core/frameslicerecording.py`
Parent index: [INDEX.md](INDEX.md)
Related: [base_recording_b.md](base_recording_b.md), [channel_slice.md](channel_slice.md), [aggregation_slicing.md](aggregation_slicing.md)
---

## 7. FrameSlice extractors (frameslicerecording.py)

Backing class for `recording.frame_slice(...)`. Do not instantiate directly.

### 7.1 FrameSliceRecording / FrameSliceRecordingSegment

```python
class FrameSliceRecording(BaseRecording):
    def __init__(self, parent_recording, start_frame=None, end_frame=None)
```

- Requires a single-segment parent (asserts `parent_recording.get_num_segments() == 1`).
- `start_frame` defaults to `0`; `end_frame` defaults to the parent's total number of samples in segment 0.
- Asserts `start_frame >= 0`, `start_frame < end_frame`, and `end_frame <= samples_in_recording`.
- Wraps segment 0 in a `FrameSliceRecordingSegment(parent_segment, start_frame=..., end_frame=...)`, copies metadata (`parent_recording.copy_metadata(self)`), sets `self._parent = parent_recording`.
- `_kwargs = {"parent_recording": ..., "start_frame": int(...), "end_frame": int(...)}`.

```python
class FrameSliceRecordingSegment(BaseRecordingSegment):
    def __init__(self, parent_recording_segment, start_frame, end_frame)

    def get_num_samples(self) -> int

    def get_traces(self, start_frame, end_frame, channel_indices)
```

Time bookkeeping in the segment `__init__`:
- If the parent has no `time_vector`, `t_start` is set to `parent_recording_segment.sample_index_to_time(start_frame)`.
- If the parent has a `time_vector`, the segment stores `time_vector[start_frame:end_frame]`.

`get_traces` translates `(start_frame, end_frame)` into parent coordinates by adding `self.start_frame` before delegating.
