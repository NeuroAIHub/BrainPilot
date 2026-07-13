# Multi Channel Systems recording extractors
Source in repo: `spikeinterface/src/spikeinterface/extractors/neoextractors/mcsraw.py` and `spikeinterface/src/spikeinterface/extractors/mcsh5extractors.py`
Parent index: [INDEX.md](INDEX.md)
---

## MCS raw (exported binary)

Source: `extractors/neoextractors/mcsraw.py`. Reads MCS `MC_DataTool` binary exports (not the native `.mcd`). Requires `neo`.

```python
class MCSRawRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "RawMCSRawIO"
    def __init__(
        self,
        file_path,
        stream_id=None,
        stream_name=None,
        block_index=None,
        all_annotations=False,
        use_names_as_ids: bool = False,
    ): ...

# NOTE: verbatim from source — the `name=` argument is currently "read_maxwell_event"
# (a bug in the source), but the object is exported under `read_mcsraw` from
# spikeinterface.extractors.neoextractors.mcsraw and re-exported from spikeinterface.extractors.
read_mcsraw = define_function_from_class(source_class=MCSRawRecordingExtractor, name="read_maxwell_event")
```

Return type: `MCSRawRecordingExtractor`. Because of the incorrect `name=` above, `read_mcsraw.__name__ == "read_maxwell_event"` in the current source — do not rely on `__name__` for dispatch.

## MCS HDF5

Source: `extractors/mcsh5extractors.py`. Reads MCS `.h5` files directly through `h5py` (no `neo`). Requires `h5py`.

```python
class MCSH5RecordingExtractor(BaseRecording):
    installation_mesg = "To use the MCSH5RecordingExtractor install h5py: \n\n pip install h5py\n\n"
    def __init__(self, file_path, stream_id=0): ...

read_mcsh5 = define_function_from_class(source_class=MCSH5RecordingExtractor, name="read_mcsh5")
```

Return type: `MCSH5RecordingExtractor`.
