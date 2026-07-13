# BaseSnippets / BaseSnippetsSegment (basesnippets.py)
Source in repo: `spikeinterface/src/spikeinterface/core/basesnippets.py`
Parent index: [INDEX.md](INDEX.md)
Related: [base_recording_a.md](base_recording_a.md), [channel_slice.md](channel_slice.md), [numpy_extractors.md](numpy_extractors.md)
---

## 5. BaseSnippets / BaseSnippetsSegment (basesnippets.py)

```python
class BaseSnippets(BaseRecordingSnippets):
    _main_properties = ["group", "gain_to_uV", "offset_to_uV"]
    _main_features = []

    def __init__(
        self,
        sampling_frequency: float,
        nbefore: int | None,
        snippet_len: int,
        channel_ids: list,
        dtype,
    )
```

Repr:

```python
def __repr__(self)
```

Properties (Python `@property`):
- `nbefore` -> `self._nbefore`
- `snippet_len` -> `self._snippet_len`
- `nafter` -> `self._snippet_len - self._nbefore` (or `None` if `nbefore is None`)

Segment management:

```python
def get_num_segments(self)
def add_snippets_segment(self, snippets_segment)
```

Snippet counts / helpers:

```python
def get_num_snippets(self, segment_index=None)
def get_total_snippets(self)
def is_aligned(self)                            # True iff nbefore is not None
```

Frames:

```python
def get_frames(self, indices=None, segment_index: int | None = None)
```

Snippet access:

```python
def get_snippets(
    self,
    indices=None,
    segment_index: int | None = None,
    channel_ids: list | None = None,
    return_scaled: bool | None = None,
    return_in_uV: bool = False,
)

def get_snippets_from_frames(
    self,
    segment_index: int | None = None,
    start_frame: int | None = None,
    end_frame: int | None = None,
    channel_ids: list | None = None,
    return_scaled: bool | None = None,
    return_in_uV: bool = False,
)
```

`return_scaled` is deprecated (removal in 0.105.0). When scaling is requested, `wfs = wfs.astype("float32") * gains + offsets`.

Selection helpers (override the `BaseRecordingSnippets` mixin defaults):

```python
def select_channels(self, channel_ids: list | np.ndarray | tuple) -> "BaseSnippets"
def _remove_channels(self, remove_channel_ids)
def _select_segments(self, segment_indices)
```

Save backend:

```python
def _save(self, format="npy", **save_kwargs)
```

Supported formats: `"npy"`, `"memory"`. (Note: an earlier `_save(self, format="binary", **save_kwargs)` stub that raised `NotImplementedError` is present but is shadowed by the second definition.)

Times helper:

```python
def get_times(self)
# returns self.get_frames() / self.sampling_frequency
```

`BaseSnippetsSegment`:

```python
class BaseSnippetsSegment(BaseSegment):
    def __init__(self)

    def get_snippets(
        self,
        indices,
        channel_indices: list | None = None,
    ) -> np.ndarray            # NotImplementedError

    def get_num_snippets(self)                                                # NotImplementedError
    def get_frames(self, indices)                                             # NotImplementedError

    def frames_to_indices(
        self, start_frame: int | None = None, end_frame: int | None = None,
    )                                                                          # NotImplementedError
```

`get_num_snippets_per_segment` is NOT a method — use `get_num_snippets(segment_index=...)` for a specific segment or `get_total_snippets()` for the sum across segments.
