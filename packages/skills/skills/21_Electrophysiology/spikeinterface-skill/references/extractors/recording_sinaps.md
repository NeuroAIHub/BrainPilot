# SiNAPS recording extractors
Source in repo: `spikeinterface/src/spikeinterface/extractors/sinapsrecordingextractors.py`
Parent index: [INDEX.md](INDEX.md)
---

Source: `extractors/sinapsrecordingextractors.py`. Reads SiNAPS Research Platform binary or HDF5 recordings.

Binary format:

```python
class SinapsResearchPlatformRecordingExtractor(ChannelSliceRecording):
    DEFAULT_DTYPE = "uint16"
    def __init__(self, file_path: str | Path, stream_name: str = "filt"):
        # stream_name must be one of {"filt", "raw", "aux"}
        ...

read_sinaps_research_platform = define_function_from_class(
    source_class=SinapsResearchPlatformRecordingExtractor, name="read_sinaps_research_platform"
)
```

Return type: `SinapsResearchPlatformRecordingExtractor` (subclass of `ChannelSliceRecording` over a `BinaryRecordingExtractor`).

HDF5 format (requires `h5py`):

```python
class SinapsResearchPlatformH5RecordingExtractor(BaseRecording):
    def __init__(self, file_path: str | Path, stream_name: str = "filt"):
        # stream_name must be one of {"filt", "raw", "aux"}
        ...

read_sinaps_research_platform_h5 = define_function_from_class(
    source_class=SinapsResearchPlatformH5RecordingExtractor, name="read_sinaps_research_platform_h5"
)
```

Return type: `SinapsResearchPlatformH5RecordingExtractor`.

For `.dat` / non-`.bin` inputs, `stream_name` is silently forced to `"raw"` and the file is treated as a single-stream binary. Probe metadata is auto-loaded from `probeinterface.get_probe(manufacturer="sinaps-research-platform", probe_name=...)`.
