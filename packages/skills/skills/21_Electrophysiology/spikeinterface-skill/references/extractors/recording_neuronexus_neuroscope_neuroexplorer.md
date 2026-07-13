# NeuroNexus / NeuroScope / NeuroExplorer recording extractors
Source in repo: `spikeinterface/src/spikeinterface/extractors/neoextractors/` (neuronexus.py, neuroscope.py, neuroexplorer.py)
Parent index: [INDEX.md](INDEX.md)
---

## NeuroNexus (Allego)

Source: `extractors/neoextractors/neuronexus.py`. Reads Allego `.xdat.json` metadata. Requires `neo`.

```python
class NeuroNexusRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "NeuroNexusRawIO"
    def __init__(
        self,
        file_path: str | Path,
        stream_id: str | None = None,
        stream_name: str | None = None,
        all_annotations: bool = False,
        use_names_as_ids: bool = False,
    ): ...

read_neuronexus = define_function_from_class(source_class=NeuroNexusRecordingExtractor, name="read_neuronexus")
```

Return type: `NeuroNexusRecordingExtractor`. With `use_names_as_ids=False`, ids are the hardware `ntv_chan_name`; with `use_names_as_ids=True`, ids are the user-defined `chan_names`.

## NeuroScope

Source: `extractors/neoextractors/neuroscope.py`. Reads NeuroScope `.dat` / `.lfp` / `.eeg` and companion `.xml`. Requires `neo`; the sorting extractor also requires `lxml`.

```python
class NeuroScopeRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "NeuroScopeRawIO"
    def __init__(
        self,
        file_path,
        xml_file_path=None,
        stream_id=None,
        stream_name: bool = None,       # NOTE: annotation is `bool` in source (likely a typo); treat as str | None
        all_annotations: bool = False,
        use_names_as_ids: bool = False,
    ): ...

read_neuroscope_recording = define_function_from_class(
    source_class=NeuroScopeRecordingExtractor, name="read_neuroscope_recording"
)
```

Return type: `NeuroScopeRecordingExtractor`.

Convenience combined reader (recording + optional sorting):

```python
def read_neuroscope(
    file_path,
    stream_id=None,
    keep_mua_units=False,
    exclude_shanks=None,
    load_recording=True,
    load_sorting=False,
):
    """
    Assumes .res/.clu/.xml files are colocated with the binary file.
    Returns recording, sorting, or (recording, sorting) depending on the flags.
    """
```

Return type of `read_neuroscope`: `NeuroScopeRecordingExtractor`, `NeuroScopeSortingExtractor`, or a tuple.

Sorting counterpart (Part B): `NeuroScopeSortingExtractor(folder_path=None, resfile_path=None, clufile_path=None, keep_mua_units=True, exclude_shanks=None, xml_file_path=None)`.

## NeuroExplorer

Source: `extractors/neoextractors/neuroexplorer.py`. Reads `.nex` files. Requires `neo[edf]`. Note: this reader only exposes one channel/stream at a time (aggregate manually with `spikeinterface.core.aggregate_channels` if you need several).

```python
class NeuroExplorerRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "NeuroExplorerRawIO"
    def __init__(
        self,
        file_path,
        stream_id=None,
        stream_name=None,
        all_annotations: bool = False,
        use_names_as_ids: bool = False,
    ): ...

read_neuroexplorer = define_function_from_class(source_class=NeuroExplorerRecordingExtractor, name="read_neuroexplorer")
```

Return type: `NeuroExplorerRecordingExtractor`.

Example (from the class docstring):

```python
from spikeinterface.extractors.neoextractors.neuroexplorer import NeuroExplorerRecordingExtractor
from spikeinterface.core import aggregate_channels

file_path = "/the/path/to/your/nex/file.nex"
streams = NeuroExplorerRecordingExtractor.get_streams(file_path=file_path)
stream_names = streams[0]
recording_list = [
    NeuroExplorerRecordingExtractor(file_path=file_path, stream_name=stream_name)
    for stream_name in stream_names
]
recording = aggregate_channels(recording_list)
```
