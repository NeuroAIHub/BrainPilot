# Intan recording extractors
Source in repo: `spikeinterface/src/spikeinterface/extractors/neoextractors/intan.py`
Parent index: [INDEX.md](INDEX.md)
---

Source: `extractors/neoextractors/intan.py`. Reads `.rhd` / `.rhs` files (and multi-file variants). Requires `neo`.

```python
class IntanRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "IntanRawIO"
    def __init__(
        self,
        file_path,
        stream_id=None,
        stream_name=None,
        all_annotations=False,
        use_names_as_ids=False,
        ignore_integrity_checks: bool = False,
    ): ...

read_intan = define_function_from_class(source_class=IntanRecordingExtractor, name="read_intan")
```

Return type: `IntanRecordingExtractor`. When the selected stream is an amplifier stream (`"RHS2000 amplifier channel"` or `"RHD2000 amplifier channel"`), the extractor auto-populates channel groups A/B/C/… from the neo channel IDs (`"A-001"`, `"B-002"`, …).

Examples (from the class docstring):

```python
from spikeinterface.extractors import read_intan
# intan amplifier data is stored in stream_id = '0'
recording = read_intan(file_path=r'my_data.rhd', stream_id='0')
# intan multi-file: file_path points to 'info.rhd'
recording = read_intan(file_path=r'info.rhd', stream_id='0')
```

Multi-file split-Intan folders (auto-sort by filename, concatenate or append):

```python
class IntanSplitFilesRecordingExtractor(ConcatenateSegmentRecording, AppendSegmentRecording):
    def __init__(
        self,
        folder_path,
        mode: Literal["append", "concatenate"] = "concatenate",
        stream_id=None,
        stream_name=None,
        all_annotations=False,
        use_names_as_ids=False,
        ignore_integrity_checks: bool = False,
    ): ...

read_split_intan_files = define_function_from_class(
    source_class=IntanSplitFilesRecordingExtractor, name="read_split_intan_files"
)
```

Return type: `IntanSplitFilesRecordingExtractor` (which becomes a `ConcatenateSegmentRecording` or an `AppendSegmentRecording` depending on `mode`).

Example (from the class docstring):

```python
from spikeinterface.extractors import IntanSplitFilesRecordingExtractor
recording = IntanSplitFilesRecordingExtractor("/path/to/intan/folder")
```
