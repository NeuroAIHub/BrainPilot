# Channel padding
Source in repo: `spikeinterface/src/spikeinterface/preprocessing/zero_channel_pad.py`
Parent index: [INDEX.md](INDEX.md)
---

## Channel padding

### zero_channel_pad / ZeroChannelPaddedRecording

Adds all-zero channels so the recording has `num_channels` channels total.

```python
ZeroChannelPaddedRecording(
    recording: BaseRecording,
    num_channels: int,
    channel_mapping: list | None = None,
)
```

- `channel_mapping=None`: sort by y-location and place at the start.

Also available in the same module (`pad_traces` / `TracePaddedRecording`) — pads
samples on the time axis:

```python
pad_traces(
    recording: BaseRecording,
    padding_start: int = 0,
    padding_end: int = 0,
    fill_value: float = 0.0,
)
```

Note: there is **no** `remove_channels_by_type` function in
`spikeinterface.preprocessing`. To drop channels, use the recording-level method
`recording.remove_channels(channel_ids)`.
