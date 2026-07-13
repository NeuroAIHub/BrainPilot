# Neuropixels-ready recording formats (SpikeGLX, Open Ephys, SpikeGadgets, IBL)
Source in repo: `spikeinterface/src/spikeinterface/extractors/neoextractors/` (spikeglx.py, openephys.py, spikegadgets.py) and `extractors/iblextractors.py`, `extractors/cbin_ibl.py`
Parent index: [INDEX.md](INDEX.md)
---

## SpikeGLX

Source: `extractors/neoextractors/spikeglx.py`. Reads folder-based SpikeGLX output (multiple streams like `imec0.ap`, `imec0.lf`, `nidq`). Requires `neo`. Neuropixels probe geometry is auto-loaded via `probeinterface.read_spikeglx`.

```python
class SpikeGLXRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "SpikeGLXRawIO"
    def __init__(
        self,
        folder_path,
        stream_id=None,
        stream_name=None,
        all_annotations: bool = False,
        use_names_as_ids: bool = False,
    ): ...

read_spikeglx = define_function_from_class(source_class=SpikeGLXRecordingExtractor, name="read_spikeglx")
```

Return type: `SpikeGLXRecordingExtractor` (subclass of `NeoBaseRecordingExtractor` → `BaseRecording`).

Common `stream_id` values in the wild: `"imec0.ap"`, `"imec0.lf"`, `"nidq"`, `"obx0.obx"`. If the stream is `nidq`, one-box (`obx`), or a `SYNC` sub-stream, probe metadata is not attached.

Companion event reader **[Part B]**:

```python
class SpikeGLXEventExtractor(NeoBaseEventExtractor):
    NeoRawIOClass = "SpikeGLXRawIO"
    def __init__(self, folder_path, block_index=None): ...

def read_spikeglx_event(folder_path, block_index=None): ...  # returns SpikeGLXEventExtractor
```

Example (from the class docstring):

```python
from spikeinterface.extractors import read_spikeglx
recording = read_spikeglx(folder_path=r'path_to_folder_with_data')
```

## Open Ephys

Source: `extractors/neoextractors/openephys.py`. Auto-detects between the legacy `.continuous` format and the newer binary format. Requires `neo`. Probes are loaded via `probeinterface.read_openephys_neuropixels` when a Neuropixels settings file is present.

Binary-format class:

```python
class OpenEphysBinaryRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "OpenEphysBinaryRawIO"

    @classmethod
    def get_available_experiments(cls, folder_path) -> list[str]:
        """e.g. ["experiment1", "experiment2"]"""

    def __init__(
        self,
        folder_path: str | Path,
        experiment_name: str | None = None,
        stream_id: str = None,
        stream_name: str = None,
        block_index: int = None,
        load_sync_timestamps: bool = False,
        experiment_names: str | list | None = None,   # DEPRECATED, removed in 0.105.0
        all_annotations: bool = False,
    ): ...
```

- `experiment_name` and `block_index` are mutually exclusive; if multiple experiments are present and neither is set, a `ValueError` listing options is raised.
- When exactly two streams are found and one contains `"SYNC"`, the non-SYNC stream is auto-selected.
- `experiment_names` (plural) is the deprecated Neo-style list; setting it emits a `FutureWarning`.

Legacy-format class:

```python
class OpenEphysLegacyRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "OpenEphysRawIO"
    def __init__(
        self,
        folder_path,
        stream_id=None,
        stream_name=None,
        block_index=None,
        all_annotations: bool = False,
        use_names_as_ids: bool = False,
    ): ...
```

Note: the legacy class silently drops `ignore_timestamps_errors` from its neo kwargs when neo ≤ 0.12.0 (helper `drop_invalid_neo_arguments_for_version_0_12_0`).

Event reader **[Part B]**:

```python
class OpenEphysBinaryEventExtractor(NeoBaseEventExtractor):
    NeoRawIOClass = "OpenEphysBinaryRawIO"

    @classmethod
    def get_available_experiments(cls, folder_path) -> list[str]: ...

    def __init__(self, folder_path, experiment_name=None, block_index=None): ...
```

Auto-guessing top-level functions:

```python
def read_openephys(folder_path, **kwargs):
    """
    Auto-detects legacy vs. binary based on whether any '.continuous' file exists
    at the top of `folder_path`.

    kwargs (dispatched to OpenEphysBinaryRecordingExtractor or OpenEphysLegacyRecordingExtractor):
      experiment_name : str, default: None            # binary only
      stream_id : str, default: None
      stream_name : str, default: None
      block_index : int, default: None
      all_annotations : bool, default: False
      load_sync_timestamps : bool, default: False     # binary only
      ignore_timestamps_errors : bool, default: False # legacy only

    Returns
    -------
    recording : OpenEphysLegacyRecordingExtractor | OpenEphysBinaryRecordingExtractor
    """

def read_openephys_event(folder_path, experiment_name=None, block_index=None):
    """Binary format only. Returns OpenEphysBinaryEventExtractor. [Part B]"""
```

Return type of `read_openephys`: `OpenEphysBinaryRecordingExtractor` or `OpenEphysLegacyRecordingExtractor`.

## SpikeGadgets

Source: `extractors/neoextractors/spikegadgets.py`. Reads `.rec` files from SpikeGadgets. Requires `neo`. When Neuropixels probes are present, `probeinterface.read_spikegadgets_neuropixels` populates the probe(group).

```python
class SpikeGadgetsRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "SpikeGadgetsRawIO"
    def __init__(
        self,
        file_path,
        stream_id=None,
        stream_name=None,
        all_annotations: bool = False,
        use_names_as_ids: bool = False,
    ): ...

read_spikegadgets = define_function_from_class(source_class=SpikeGadgetsRecordingExtractor, name="read_spikegadgets")
```

Return type: `SpikeGadgetsRecordingExtractor`.

Example (from the class docstring):

```python
from spikeinterface.extractors import read_spikegadgets
recording = read_spikegadgets(file_path=r'my_data.rec')
```

## IBL streaming / cbin

Source: `extractors/iblextractors.py` and `extractors/cbin_ibl.py`. Requires `ONE-api` + `ibllib` + `brainbox` (streaming) or `mtscomp` (local cbin).

Streaming (uses the ONE API and Alyx):

```python
class IblRecordingExtractor(BaseRecording):
    installation_mesg = ("To use the IblRecordingSegment, install ibllib: \n\n "
                         "pip install ONE-api\npip install ibllib\n")

    @staticmethod
    def _get_default_one(cache_folder: Path | str | None = None): ...

    @staticmethod
    def get_stream_names(eid: str, cache_folder: Path | str | None = None, one=None) -> list[str]:
        """
        Retrieve the available stream names for a session. Each stream is
        '<probe>.ap' or '<probe>.lf'.
        """

    def __init__(
        self,
        eid: str | None = None,
        pid: str | None = None,
        stream_name: str | None = None,
        load_sync_channel: bool = False,
        cache_folder: Path | str | None = None,
        remove_cached: bool = True,
        stream: bool = True,
        one: "one.api.OneAlyx" = None,
        stream_type: str | None = None,   # required when `pid` is given, one of {"ap", "lf"}
    ): ...

read_ibl_recording = define_function_from_class(source_class=IblRecordingExtractor, name="read_ibl_recording")
```

Return type: `IblRecordingExtractor`. Either `eid` or `pid` must be provided; when `pid` is given, `stream_type` is required and `stream_name` is derived as `f"{pname}.{stream_type}"`.

Sorting counterpart (Part B): `IblSortingExtractor(pid, good_clusters_only=False, load_unit_properties=True, one=None, **kwargs)`, wrapper `read_ibl_sorting`.

Compressed local IBL binary (mtscomp `.cbin` + `.ch` + SpikeGLX `.meta`):

```python
class CompressedBinaryIblExtractor(BaseRecording):
    installation_mesg = "To use the CompressedBinaryIblExtractor, install mtscomp: \n\n pip install mtscomp\n\n"

    def __init__(
        self,
        folder_path=None,
        load_sync_channel=False,
        stream_name="ap",           # must be one of {"ap", "lp"}
        cbin_file_path=None,        # explicit .cbin path (else auto-found under folder_path)
    ): ...

read_cbin_ibl = define_function_from_class(source_class=CompressedBinaryIblExtractor, name="read_cbin_ibl")
```

Return type: `CompressedBinaryIblExtractor`. Class docstring lists a deprecated `cbin_file` alias which is no longer honoured by the current `__init__`.
