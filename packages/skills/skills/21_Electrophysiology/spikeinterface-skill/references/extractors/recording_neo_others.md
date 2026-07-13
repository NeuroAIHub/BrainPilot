# Other neo-based recording extractors (Blackrock, Neuralynx, Plexon, TDT, AlphaOmega, Axon, Axona, CED, Spike2, EDF, NIX)
Source in repo: `spikeinterface/src/spikeinterface/extractors/neoextractors/`
Parent index: [INDEX.md](INDEX.md)
---

## Blackrock

Source: `extractors/neoextractors/blackrock.py`. Reads `.ns1`–`.ns6` NSx files (`.nev` is used only for sorting). Requires `neo`.

```python
class BlackrockRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "BlackrockRawIO"
    def __init__(
        self,
        file_path,
        stream_id=None,
        stream_name=None,
        all_annotations: bool = False,
        use_names_as_ids: bool = False,
        gap_tolerance_ms: float | None = None,
    ): ...

read_blackrock = define_function_from_class(source_class=BlackrockRecordingExtractor, name="read_blackrock")
```

Return type: `BlackrockRecordingExtractor`. Under the hood the reader passes `load_nev=False` to neo (to avoid loading spikes) and infers `nsx_to_load` from the file suffix (e.g. `.ns5` → `nsx_to_load=5`).

Sorting counterpart (Part B): `BlackrockSortingExtractor(file_path, stream_id=None, stream_name=None, sampling_frequency=None, nsx_to_load=None, gap_tolerance_ms=None)`.

## Neuralynx

Source: `extractors/neoextractors/neuralynx.py`. Reads a folder of `.ncs`/`.nev`/`.nse`/`.ntt` files. Requires `neo` (≥ 0.13.1 needed for `strict_gap_mode`).

```python
class NeuralynxRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "NeuralynxRawIO"
    def __init__(
        self,
        folder_path: str | Path,
        stream_id=None,
        stream_name=None,
        all_annotations=False,
        exclude_filename=None,          # list[str] | None, e.g. ["events.nev"] to skip
        strict_gap_mode=False,          # NOTE: default False here, opposite of neo's default
        use_names_as_ids: bool = False,
    ): ...

read_neuralynx = define_function_from_class(source_class=NeuralynxRecordingExtractor, name="read_neuralynx")
```

Return type: `NeuralynxRecordingExtractor`. `strict_gap_mode` is only forwarded to neo when `neo >= 0.13.1`.

Sorting counterpart (Part B): `NeuralynxSortingExtractor(folder_path, sampling_frequency=None, stream_id=None, stream_name=None)`.

## Plexon

Source: `extractors/neoextractors/plexon.py` and `extractors/neoextractors/plexon2.py`. Requires `neo`. Plexon2 requires the PL2 SDK (via `zugbruecke`/`wine` on non-Windows).

Plexon `.plx`:

```python
class PlexonRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "PlexonRawIO"
    def __init__(
        self,
        file_path: str | Path,
        stream_id=None,
        stream_name=None,
        all_annotations: bool = False,
        use_names_as_ids: bool = True,   # default True for Plexon (opposite of most neo readers)
    ): ...

read_plexon = define_function_from_class(source_class=PlexonRecordingExtractor, name="read_plexon")
```

Return type: `PlexonRecordingExtractor`.

Plexon2 `.pl2`:

```python
class Plexon2RecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "Plexon2RawIO"
    def __init__(
        self,
        file_path,
        stream_id=None,
        stream_name=None,
        use_names_as_ids=True,
        all_annotations=False,
        reading_attempts: int = 25,      # only forwarded when neo > 0.13.3
    ): ...

class Plexon2EventExtractor(NeoBaseEventExtractor):  # [Part B]
    NeoRawIOClass = "Plexon2RawIO"
    def __init__(self, folder_path, block_index=None, use_names_as_ids=False): ...

read_plexon2 = define_function_from_class(source_class=Plexon2RecordingExtractor, name="read_plexon2")
read_plexon2_event = define_function_from_class(source_class=Plexon2EventExtractor, name="read_plexon2_event")
```

Return types: `Plexon2RecordingExtractor`, `Plexon2EventExtractor`.

Sorting counterparts (Part B): `PlexonSortingExtractor(file_path)`, `Plexon2SortingExtractor(file_path, sampling_frequency=None)`.

## TDT

Source: `extractors/neoextractors/tdt.py`. Reads a Tucker-Davis Technologies session folder. Requires `neo`.

```python
class TdtRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "TdtRawIO"
    def __init__(
        self,
        folder_path,
        stream_id=None,
        stream_name=None,
        block_index=None,
        all_annotations: bool = False,
        use_names_as_ids: bool = False,
    ): ...

read_tdt = define_function_from_class(source_class=TdtRecordingExtractor, name="read_tdt")
```

Return type: `TdtRecordingExtractor`.

## AlphaOmega

Source: `extractors/neoextractors/alphaomega.py`. Reads AlphaRS / AlphaLab SnR `.mpx` folders. Requires `neo`.

```python
class AlphaOmegaRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "AlphaOmegaRawIO"
    def __init__(
        self,
        folder_path,
        lsx_files=None,                       # list[str] | None
        stream_id="RAW",                      # {"RAW", "LFP", "SPK", "ACC", "AI", "UD"}
        stream_name=None,
        all_annotations: bool = False,
        use_names_as_ids: bool = False,
    ): ...

class AlphaOmegaEventExtractor(NeoBaseEventExtractor):  # [Part B]
    NeoRawIOClass = "AlphaOmegaRawIO"
    handle_event_frame_directly = True
    def __init__(self, folder_path): ...

read_alphaomega = define_function_from_class(source_class=AlphaOmegaRecordingExtractor, name="read_alphaomega")
read_alphaomega_event = define_function_from_class(source_class=AlphaOmegaEventExtractor, name="read_alphaomega_event")
```

Return types: `AlphaOmegaRecordingExtractor`, `AlphaOmegaEventExtractor`.

Example (from the class docstring):

```python
from spikeinterface.extractors import read_alphaomega
recording = read_alphaomega(folder_path="alphaomega_folder")
```

## Axon (ABF)

Source: `extractors/neoextractors/axon.py`. Reads `.abf` (ABF1 / ABF2). Requires `neo`.

```python
class AxonRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "AxonRawIO"
    def __init__(
        self,
        file_path,
        stream_id=None,
        stream_name=None,
        all_annotations: bool = False,
        use_names_as_ids: bool = False,
    ): ...

read_axon = define_function_from_class(source_class=AxonRecordingExtractor, name="read_axon")
```

Return type: `AxonRecordingExtractor`.

Example (from the class docstring):

```python
from spikeinterface.extractors import read_axon
recording = read_axon(file_path='path/to/file.abf')
```

## Axona

Source: `extractors/neoextractors/axona.py`. Reads Axona `.set` sessions. Requires `neo`.

```python
class AxonaRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "AxonaRawIO"
    def __init__(
        self,
        file_path: str | Path,
        all_annotations: bool = False,
        use_names_as_ids: bool = False,
    ): ...

read_axona = define_function_from_class(source_class=AxonaRecordingExtractor, name="read_axona")
```

Return type: `AxonaRecordingExtractor`. Note this extractor has **no** `stream_id` / `stream_name` parameters (Axona has a single stream).

## CED

Source: `extractors/neoextractors/ced.py`. Reads `.smr` / `.smrx` via `sonpy`. Requires `neo[ced]`.

```python
class CedRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "CedRawIO"
    def __init__(
        self,
        file_path,
        stream_id=None,
        stream_name=None,
        all_annotations: bool = False,
        use_names_as_ids: bool = False,
    ): ...

read_ced = define_function_from_class(source_class=CedRecordingExtractor, name="read_ced")
```

Return type: `CedRecordingExtractor`.

## Spike2

Source: `extractors/neoextractors/spike2.py`. Reads `.smr` (for `.smrx` prefer CED). Requires `neo` + `sonpy`.

```python
class Spike2RecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "Spike2RawIO"
    def __init__(
        self,
        file_path,
        stream_id=None,
        stream_name=None,
        all_annotations=False,
        use_names_as_ids: bool = False,
    ): ...

read_spike2 = define_function_from_class(source_class=Spike2RecordingExtractor, name="read_spike2")
```

Return type: `Spike2RecordingExtractor`.

## EDF

Source: `extractors/neoextractors/edf.py`. Reads the European Data Format (`.edf`). Requires `neo[edf]`.

```python
class EDFRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "EDFRawIO"
    def __init__(
        self,
        file_path,
        stream_id=None,        # streams are grouped by sampling frequency in EDF
        stream_name=None,
        all_annotations: bool = False,
        use_names_as_ids: bool = False,
    ): ...

read_edf = define_function_from_class(source_class=EDFRecordingExtractor, name="read_edf")
```

Return type: `EDFRecordingExtractor`.

## NIX

Source: `extractors/neoextractors/nix.py`. Reads `.nix` HDF5-based files. Requires `neo[nixio]`.

```python
class NixRecordingExtractor(NeoBaseRecordingExtractor):
    NeoRawIOClass = "NIXRawIO"
    def __init__(
        self,
        file_path,
        stream_id=None,
        stream_name=None,
        block_index=None,
        all_annotations: bool = False,
        use_names_as_ids: bool = False,
    ): ...

read_nix = define_function_from_class(source_class=NixRecordingExtractor, name="read_nix")
```

Return type: `NixRecordingExtractor`.
