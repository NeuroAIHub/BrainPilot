# WhiteMatter recording extractor
Source in repo: `spikeinterface/src/spikeinterface/extractors/whitematterrecordingextractor.py`
Parent index: [INDEX.md](INDEX.md)
---

Source: `extractors/whitematterrecordingextractor.py`. Reads WhiteMatter raw int16 binary with an 8-byte header offset.

```python
class WhiteMatterRecordingExtractor(BinaryRecordingExtractor):
    DTYPE = "int16"
    HEADSTAGE_GAIN_TO_UV = 0.190734863
    OFFSET_TO_UV = 0.0
    FILE_OFFSET = 8
    TIME_AXIS = 0

    def __init__(
        self,
        file_path: str | Path,
        sampling_frequency: float,
        num_channels: int,
        channel_ids: list | None = None,
        is_filtered: bool | None = None,
        gain_to_uV: float | None = None,   # falls back to HEADSTAGE_GAIN_TO_UV = 0.190734863 when None
    ): ...

read_whitematter = define_function_from_class(source_class=WhiteMatterRecordingExtractor, name="read_whitematter")
```

Return type: `WhiteMatterRecordingExtractor` (subclass of `BinaryRecordingExtractor`).

Notes from the class docstring:
- Head-stage files (64 neural channels): `voltsperbit = 1.907348633e-7` → 0.190 734 863 µV/count.
- Analog-panel files (32 aux channels, ±10 V range): `voltsperbit = 3.0517578125e-4` → 305.175 781 µV/count.
