# BIDS recording extractor
Source in repo: `spikeinterface/src/spikeinterface/extractors/bids.py`
Parent index: [INDEX.md](INDEX.md)
---

Source: `extractors/bids.py`. Reads a BIDS-iEEG folder (`_channels.tsv`, `_contacts.tsv`, `_ephys.nwb`, `_probes.tsv`). Requires `pandas` + `probeinterface`. NWB pieces need `pynwb`, NIX pieces need `neo[nixio]`.

```python
def read_bids(folder_path):
    """
    Parameters
    ----------
    folder_path : str or Path
        Path to the BIDS folder.

    Returns
    -------
    extractors : list of extractors
        The loaded data, with attached Probes.
    """
```

Return type: `list[BaseRecording]` (each entry is an `NwbRecordingExtractor` or a `NixRecordingExtractor` depending on the file extension found in the folder).

Caveat from the source: internally `read_bids` calls `read_nwb(..., electrical_series_name=None)` which does not match the current `read_nwb(..., electrical_series_path=...)` signature — this is a known bug in `bids.py` that will raise on `.nwb` files until fixed upstream. Prefer `read_nwb_recording` + manual probe loading for now.
