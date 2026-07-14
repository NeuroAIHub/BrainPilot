# ChannelSlice extractors (channelslice.py)
Source in repo: `spikeinterface/src/spikeinterface/core/channelslice.py`
Parent index: [INDEX.md](INDEX.md)
Related: [base_recording_b.md](base_recording_b.md), [base_snippets.md](base_snippets.md), [frame_slice.md](frame_slice.md)
---

## 6. ChannelSlice extractors (channelslice.py)

These lazy wrappers back the public `recording.select_channels(...)`, `recording.rename_channels(...)`, and `snippets.select_channels(...)` APIs. Do not instantiate them directly.

### 6.1 ChannelSliceRecording / ChannelSliceRecordingSegment

```python
class ChannelSliceRecording(BaseRecording):
    def __init__(self, parent_recording, channel_ids=None, renamed_channel_ids=None)
```

- If `channel_ids is None`, all parent channels are kept.
- `renamed_channel_ids` (if given) must be the same length as `channel_ids` and contain unique values.
- Asserts every id in `channel_ids` exists in `parent_recording.get_channel_ids()`.
- Attaches a `ChannelSliceRecordingSegment` per parent segment, copies metadata (`copy_metadata(..., only_main=False, ids=self._channel_ids)`), sets `self._parent = parent_recording`, and slices the parent probegroup when present.
- `_kwargs = {"parent_recording": ..., "channel_ids": ..., "renamed_channel_ids": ...}`.

```python
class ChannelSliceRecordingSegment(BaseRecordingSegment):
    def __init__(self, parent_recording_segment, parent_channel_indices)

    def get_num_samples(self) -> int

    def get_traces(
        self,
        start_frame: int | None = None,
        end_frame: int | None = None,
        channel_indices: list | None = None,
    ) -> np.ndarray
```

`get_traces` remaps `channel_indices` through `self._parent_channel_indices` before delegating to the parent segment.

### 6.2 ChannelSliceSnippets / ChannelSliceSnippetsSegment

```python
class ChannelSliceSnippets(BaseSnippets):
    def __init__(self, parent_snippets, channel_ids=None, renamed_channel_ids=None)
```

- Same argument semantics as `ChannelSliceRecording` (defaulting, uniqueness/containment checks).
- Uses `parent_snippets.nbefore` and `parent_snippets.snippet_len` when calling `BaseSnippets.__init__`.
- Copies metadata and slices the probegroup when the parent has one.
- `_kwargs = {"parent_snippets": ..., "channel_ids": ..., "renamed_channel_ids": ...}`.

```python
class ChannelSliceSnippetsSegment(BaseSnippetsSegment):
    def __init__(self, parent_snippets_segment, parent_channel_indices)

    def get_num_snippets(self) -> int

    def frames_to_indices(self, start_frame: int | None = None, end_frame: int | None = None)

    def get_frames(self, indices=None)

    def get_snippets(
        self,
        indices: list[int],
        channel_indices: list | None = None,
    ) -> np.ndarray
```
