# BaseRecording / BaseRecordingSnippets — Part A: probe mixin, channel-level helpers
Source in repo: `spikeinterface/src/spikeinterface/core/baserecordingsnippets.py`
Parent index: [INDEX.md](INDEX.md)
Related: [base_recording_b.md](base_recording_b.md), [base_extractor_a.md](base_extractor_a.md), [base_snippets.md](base_snippets.md), [channel_slice.md](channel_slice.md)
---

## 2. BaseRecording / BaseRecordingSnippets

`BaseRecording` inherits from `BaseRecordingSnippets` (the probe/channel mixin) and `TimeSeries` (the time-handling mixin). `BaseRecordingSnippets` inherits from `BaseExtractor`.

### 2.1 BaseRecordingSnippets (baserecordingsnippets.py)

Constructor:

```python
def __init__(self, sampling_frequency: float, channel_ids: list[str, int], dtype: np.dtype)
```

Properties (Python `@property`):
- `channel_ids` -> `self._main_ids`
- `sampling_frequency` -> `self._sampling_frequency`
- `dtype` -> `self._dtype`

Basic getters:

```python
def get_sampling_frequency(self)
def get_channel_ids(self)
def get_num_channels(self)
def get_dtype(self)
def has_scaleable_traces(self) -> bool     # True iff both gain_to_uV and offset_to_uV are set
def has_probe(self) -> bool
def has_3d_probe(self) -> bool
def has_channel_location(self) -> bool     # equivalent to has_probe()
def is_filtered(self)                      # reads self._annotations.get("is_filtered", False)
```

Notes:
- The alias `has_scaled` is NOT defined. Use `has_scaleable_traces()`.
- `has_scaleable_traits` is NOT defined either — the correct name is `has_scaleable_traces`.

Probe handling:

```python
def remove_probe(self)

def set_probe(
    self,
    probe: Probe,
    group_mode: Literal["auto", "by_probe", "by_shank", "by_side"] = "auto",
    in_place: bool | None = None,
) -> None

def set_probegroup(
    self,
    probegroup: ProbeGroup,
    group_mode: Literal["auto", "by_probe", "by_shank", "by_side"] = "auto",
    in_place: bool | None = None,
    check_overlap: bool = True,
) -> None

def select_channels_with_probe(
    self,
    probe: Probe,
    group_mode: Literal["auto", "by_probe", "by_shank", "by_side"] = "auto",
) -> "BaseRecordingSnippets"

def select_channels_with_probegroup(
    self,
    probegroup: ProbeGroup,
    group_mode: Literal["auto", "by_probe", "by_shank", "by_side"] = "auto",
) -> "BaseRecordingSnippets"

def _get_probegroup_based_on_device_channel_indices(self, probegroup: ProbeGroup) -> ProbeGroup

def get_probe(self)
def get_probes(self)
def get_probegroup(self)
```

`set_probes` is NOT a public method — use `set_probegroup(probegroup)` instead (create a `ProbeGroup` and add probes to it).

`in_place` is deprecated (removal in 0.106.0); `set_probe` / `set_probegroup` are always in-place. Use `select_channels_with_probe(...)` / `select_channels_with_probegroup(...)` to obtain a new recording.

Dummy probe from locations:

```python
def create_dummy_probe_from_locations(self, locations, shape="circle", shape_params={"radius": 1}, axes="xy")
def set_dummy_probe_from_locations(self, locations, shape="circle", shape_params={"radius": 1}, axes="xy")
```

Channel locations:

```python
def set_channel_locations(self, locations, channel_ids=None)     # DEPRECATED (removal in 0.106.0)
def get_channel_locations(self, channel_ids=None, axes: str = "xy") -> np.ndarray
def is_probe_3d(self) -> bool
def clear_channel_locations(self, channel_ids=None)              # DEPRECATED (removal in 0.106.0)
```

`set_channel_locations` is deprecated; use `set_dummy_probe_from_locations()`. `clear_channel_locations` is deprecated; use `remove_probe()`.

Channel groups / gains / offsets:

```python
def set_channel_groups(self, groups, channel_ids=None)
def get_channel_groups(self, channel_ids=None)
def clear_channel_groups(self, channel_ids=None)

def set_channel_gains(self, gains, channel_ids=None)      # scalar broadcast to all channels
def get_channel_gains(self, channel_ids=None)

def set_channel_offsets(self, offsets, channel_ids=None)  # scalar broadcast to all channels
def get_channel_offsets(self, channel_ids=None)

def get_channel_property(self, channel_id, key)
```

Slicing / selection helpers defined here but implemented (or overridden) in child classes:

```python
def planarize(self, axes: str = "xy")             # axes in {"xy", "yz", "xz"}

def select_channels(self, channel_ids)            # NotImplementedError; overridden by BaseRecording and BaseSnippets
def remove_channels(self, remove_channel_ids)     # wraps _remove_channels

def frame_slice(self, start_frame, end_frame)     # NotImplementedError in the mixin; overridden by BaseRecording
def select_segments(self, segment_indices)        # wraps _select_segments

def split_by(self, property="group", outputs="dict")   # outputs in {"dict", "list"}
```

Internal (probe / backward-compat) hooks:

```python
def _extra_metadata_copy(self, other)
def _extra_metadata_from_folder(self, folder)
def _extra_metadata_to_folder(self, folder)
def _extra_metadata_from_dict(self, dump_dict)
def _extra_metadata_to_dict(self, dump_dict)
def _handle_extractor_backward_compatibility(self)
```
