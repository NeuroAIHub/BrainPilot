# Biocam recording extractors
Source in repo: `spikeinterface/src/spikeinterface/extractors/neoextractors/biocam.py`
Parent index: [INDEX.md](INDEX.md)
---

Source: `extractors/neoextractors/biocam.py`. Reads 3Brain Biocam `.brw` / `.bxr` files. Requires `neo`. Probe via `probeinterface.read_3brain`.

```python
class BiocamRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "BiocamRawIO"
    def __init__(
        self,
        file_path,
        mea_pitch=None,
        electrode_width=None,
        fill_gaps_strategy=None,     # {"zeros", "synthetic_noise", None}
        stream_id=None,
        stream_name=None,
        all_annotations: bool = False,
        use_names_as_ids: bool = False,
    ): ...

read_biocam = define_function_from_class(source_class=BiocamRecordingExtractor, name="read_biocam")
```

Return type: `BiocamRecordingExtractor`. `fill_gaps_strategy` must be set for event-compressed Biocam files; otherwise neo raises an error listing the two options above.
