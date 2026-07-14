# Maxwell recording extractors
Source in repo: `spikeinterface/src/spikeinterface/extractors/neoextractors/maxwell.py`
Parent index: [INDEX.md](INDEX.md)
---

Source: `extractors/neoextractors/maxwell.py`. Reads MaxOne (old + new) and MaxTwo `.h5` files. Requires `neo` + `h5py`; the extractor auto-installs the Maxwell HDF5 compression plugin. Probe loaded via `probeinterface.read_maxwell`.

```python
class MaxwellRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "MaxwellRawIO"
    def __init__(
        self,
        file_path,
        stream_id=None,             # for MaxTwo: e.g. 'well000', 'well0001', ...
        stream_name=None,
        block_index=None,
        all_annotations=False,
        rec_name=None,              # e.g. 'rec0000' when multiple recordings per file
        install_maxwell_plugin=True,
        use_names_as_ids: bool = False,
    ): ...

class MaxwellEventExtractor(BaseEvent):  # [Part B]
    """Reads TTL events from Maxwell files (h5py-based, custom event reader, not NEO)."""
    def __init__(self, file_path): ...

read_maxwell = define_function_from_class(source_class=MaxwellRecordingExtractor, name="read_maxwell")
read_maxwell_event = define_function_from_class(source_class=MaxwellEventExtractor, name="read_maxwell_event")
```

Return types: `MaxwellRecordingExtractor`, `MaxwellEventExtractor`.
