# Aggregation / Slicing / Concatenation
Source in repo: `spikeinterface/src/spikeinterface/core/channelsaggregationrecording.py`, `unitsaggregationsorting.py`, `segmentutils.py`, `frameslicerecording.py`, `frameslicesorting.py`, `channelslice.py`
Parent index: [INDEX.md](INDEX.md)
Related: [frame_slice.md](frame_slice.md), [channel_slice.md](channel_slice.md), [base_recording_b.md](base_recording_b.md), [base_sorting.md](base_sorting.md)
---

## 2. Aggregation / Slicing / Concatenation

### `aggregate_channels`

```python
def aggregate_channels(
    recording_list_or_dict=None,
    renamed_channel_ids=None,
    recording_list=None,
):
```
`recording_list` is deprecated in favor of `recording_list_or_dict` (list or dict).

### `ChannelsAggregationRecording`

```python
class ChannelsAggregationRecording(BaseRecording):
    def __init__(self, recording_list_or_dict=None, renamed_channel_ids=None, recording_list=None):
```
Adds a `"aggregation_key"` property per source recording. Public property: `recordings` (backed by `self._recordings`).

### `aggregate_units` and `UnitsAggregationSorting`

```python
class UnitsAggregationSorting(BaseSorting):
    def __init__(self, sorting_list, renamed_unit_ids=None, sampling_frequency_max_diff=0):
```
`aggregate_units = define_function_from_class(UnitsAggregationSorting, "aggregate_units")` — the module-level `aggregate_units(sorting_list, renamed_unit_ids=None, sampling_frequency_max_diff=0)` is the class itself (thin renamer).

### `concatenate_recordings` / `ConcatenateSegmentRecording`

```python
class ConcatenateSegmentRecording(BaseRecording):
    def __init__(self, recording_list, ignore_times=True, sampling_frequency_max_diff=0):
```
`concatenate_recordings = define_function_from_class(source_class=ConcatenateSegmentRecording, name="concatenate_recordings")`. Time information is lost by default (`ignore_times=True`). Attribute: `self.recording_list`.

### `append_recordings` / `AppendSegmentRecording`

```python
class AppendSegmentRecording(BaseRecording):
    def __init__(self, recording_list, sampling_frequency_max_diff=0):
```
`append_recordings = define_function_from_class(source_class=AppendSegmentRecording, name="append_segment_recording")`. Requires same dtype and channel_ids. Attribute: `self.recording_list`.

### `SelectSegmentRecording` / `select_segment_recording`

```python
class SelectSegmentRecording(BaseRecording):
    def __init__(self, recording: BaseRecording, segment_indices: int | list[int]):
```
`select_segment_recording = define_function_from_class(source_class=SelectSegmentRecording, name="select_segment_recording")`.

### `split_recording`

```python
def split_recording(recording: BaseRecording):
```
Returns a list of mono-segment `SelectSegmentRecording` objects, one per segment.

### `FrameSliceRecording`

```python
class FrameSliceRecording(BaseRecording):
    def __init__(self, parent_recording, start_frame=None, end_frame=None):
```
Only works with mono-segment. Preferred entry point: `recording.frame_slice(start_frame, end_frame)`. Attributes on the sub-segment: `start_frame`, `end_frame`.

### `FrameSliceSorting`

```python
class FrameSliceSorting(BaseSorting):
    def __init__(self, parent_sorting, start_frame=None, end_frame=None, check_spike_frames=True):
```
Only works with mono-segment. Preferred entry point: `sorting.frame_slice(start_frame, end_frame, check_spike_frames=True)`. If parent has a recording, a sliced recording is registered automatically.

### `ChannelSliceRecording`

```python
class ChannelSliceRecording(BaseRecording):
    def __init__(self, parent_recording, channel_ids=None, renamed_channel_ids=None):
```
Preferred entry point: `recording.select_channels(channel_ids, renamed_channel_ids=None)`. Attributes: `self._channel_ids`, `self._renamed_channel_ids`, `self._parent_channel_indices`.

### `ChannelSliceSnippets`

```python
class ChannelSliceSnippets(BaseSnippets):
    def __init__(self, parent_snippets, channel_ids=None, renamed_channel_ids=None):
```

Note: there is no module-level `channel_slice(...)`, `frame_slice_recording(...)` or `frame_slice_sorting(...)` function in `spikeinterface.core`. Use the class constructors above or the methods `recording.frame_slice`, `sorting.frame_slice`, `recording.select_channels`.

### Sorting counterparts (also public)

- `append_sortings = define_function_from_class(source_class=AppendSegmentSorting, name="append_sortings")` — `AppendSegmentSorting(sorting_list, sampling_frequency_max_diff=0)`.
- `concatenate_sortings` — `ConcatenateSegmentSorting(sorting_list, total_samples_list=None, ignore_times=True, sampling_frequency_max_diff=0)`.
- `split_sorting = define_function_from_class(source_class=SplitSegmentSorting, name="split_sorting")` — companion to `split_recording`.
- `SplitSegmentSorting(parent_sorting: BaseSorting, recording_or_recording_list=None)` — `recording_or_recording_list` may be a list of recordings, a `ConcatenateSegmentRecording`, or `None` (uses the registered recording).
- `select_segment_sorting` / `SelectSegmentSorting(sorting: BaseSorting, segment_indices: int | list[int])`.
- `UnitsSelectionSorting(parent_sorting, unit_ids=None, renamed_unit_ids=None)` — reduce/rename unit ids.

### Example: aggregation, concatenation, slicing

```python
import spikeinterface.core as sc

rec_a = sc.generate_recording(num_channels=2, durations=[5.0], seed=0)
rec_b = sc.generate_recording(num_channels=3, durations=[5.0], seed=1)

# channel-aggregate (list-form and dict-form both supported)
rec_all = sc.aggregate_channels([rec_a, rec_b])
rec_all_dict = sc.aggregate_channels({"probeA": rec_a, "probeB": rec_b})

# concatenate two recordings' segments into one segment
rec_cat = sc.concatenate_recordings([rec_a, rec_a], ignore_times=True)

# append multi-segment recordings preserving segment structure
rec_app = sc.append_recordings([rec_a, rec_a])

# frame slice / channel slice
sub = rec_a.frame_slice(start_frame=1000, end_frame=5000)
sel = rec_a.select_channels(rec_a.channel_ids[:1])
```
