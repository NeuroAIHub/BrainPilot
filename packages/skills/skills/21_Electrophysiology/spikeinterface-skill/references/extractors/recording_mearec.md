# MEArec (simulated) recording extractor
Source in repo: `spikeinterface/src/spikeinterface/extractors/neoextractors/mearec.py`
Parent index: [INDEX.md](INDEX.md)
---

Source: `extractors/neoextractors/mearec.py`. Reads MEArec HDF5 simulation files (recording + ground-truth sorting). Requires `neo` + `mearec`. Probe geometry via `probeinterface.read_mearec`.

```python
class MEArecRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "MEArecRawIO"
    def __init__(
        self,
        file_path: str | Path,
        all_annotations: bool = False,
        use_names_as_ids: bool = False,
    ): ...

def read_mearec(file_path):
    """
    Returns
    -------
    recording : MEArecRecordingExtractor
    sorting   : MEArecSortingExtractor
    """
```

Return type of `read_mearec`: tuple `(MEArecRecordingExtractor, MEArecSortingExtractor)`.

Sorting counterpart (Part B): `MEArecSortingExtractor(file_path)`. The recording extractor annotates the recording as `is_filtered=True` and sets channel gains from the underlying MEArec recgen when available.
