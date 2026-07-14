# BaseEvent / BaseEventSegment (baseevent.py)
Source in repo: `spikeinterface/src/spikeinterface/core/baseevent.py`
Parent index: [INDEX.md](INDEX.md)
Related: [base_extractor_a.md](base_extractor_a.md), [numpy_extractors.md](numpy_extractors.md)
---

## 4. BaseEvent / BaseEventSegment (baseevent.py)

```python
class BaseEvent(BaseExtractor):
    def __init__(self, channel_ids, structured_dtype)
```

`structured_dtype` may be a single dtype (applied to all channels) or a `dict` keyed by `channel_id`. Structured dtypes must include a `"time"` or `"timestamp"` field.

Repr:

```python
def __repr__(self)
```

Properties / basic getters:

```python
@property
def channel_ids(self)                 # -> self._main_ids

def get_dtype(self, channel_id)
def get_num_channels(self)
def add_event_segment(self, event_segment)
def get_num_segments(self)            # len(self._event_segments)

def select_segment(self, segment_indices: int | list[int])
```

Event access:

```python
def get_events(
    self,
    channel_id: int | str | None = None,
    segment_index: int | None = None,
    start_time: float | None = None,
    end_time: float | None = None,
)

def get_event_times(
    self,
    channel_id: int | str | None = None,
    segment_index: int | None = None,
    start_time: float | None = None,
    end_time: float | None = None,
)
```

`get_events` returns a structured array of dtype `get_dtype(channel_id)`. `get_event_times` returns a 1D float array of timestamps.

`BaseEventSegment`:

```python
class BaseEventSegment(BaseSegment):
    def __init__(self)

    def get_event_times(
        self, channel_id: int | str, start_time: float, end_time: float
    ) -> np.ndarray

    def get_events(self, channel_id, start_time, end_time)   # NotImplementedError
```

The default `get_event_times` implementation calls `self.get_events(...)`. If the returned array has a structured dtype, it extracts the `"time"` or (fallback) `"timestamp"` field.
