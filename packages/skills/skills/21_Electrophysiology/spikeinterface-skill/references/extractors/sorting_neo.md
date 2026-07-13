# Sorting extractors (Neo: MEArec, Blackrock, Neuralynx, Plexon, Plexon2, NeuroScope)
Source in repo: `spikeinterface/src/spikeinterface/extractors/neoextractors/`
Parent index: [INDEX.md](INDEX.md)
---

Neo-based sorting extractors are thin wrappers over `NeoBaseSortingExtractor` (which itself wraps a Neo RawIO reader). Class-level flag `neo_returns_frames` indicates whether spikes returned by the Neo reader are already in samples (`True`) or in seconds (`False`, converted using `sampling_frequency`). Class-level flag `need_t_start_from_signal_stream` (Neuralynx) forces `t_start` inference from an analog signal stream.

## `read_mearec_sorting` (via `read_mearec`)

Class: `MEArecSortingExtractor` in `neoextractors/mearec.py`.

Full signature (verbatim):

```python
class MEArecSortingExtractor(NeoBaseSortingExtractor):
    NeoRawIOClass = "MEArecRawIO"
    neo_returns_frames = False

    def __init__(self, file_path: str | Path):
```

Sampling frequency is read directly from the h5 file (`info/recordings/fs`). `read_mearec(file_path)` returns `(recording, sorting)` as a tuple (see convenience section).

## `read_blackrock_sorting(file_path, stream_id=None, stream_name=None, sampling_frequency=None, nsx_to_load=None, gap_tolerance_ms=None)`

Class: `BlackrockSortingExtractor` in `neoextractors/blackrock.py`. Reads Blackrock `.nev` spikes; associated `.nsX` files supply the sampling frequency automatically when available.

Full signature (verbatim):

```python
class BlackrockSortingExtractor(NeoBaseSortingExtractor):
    NeoRawIOClass = "BlackrockRawIO"
    neo_returns_frames = False

    def __init__(
        self,
        file_path,
        stream_id: str | None = None,
        stream_name: str | None = None,
        sampling_frequency: float | None = None,
        nsx_to_load: int | list | str | None = None,
        gap_tolerance_ms: float | None = None,
    ):
```

- `nsx_to_load`: an int (single `.ns<n>` file), a list, `'all'` (load every nsX), `None` (load all), or an empty list (skip nsX files).
- `gap_tolerance_ms`: if `None`, timestamp gaps raise; otherwise gaps below the threshold are ignored and larger gaps create new segments.

## `read_neuralynx_sorting(folder_path, sampling_frequency=None, stream_id=None, stream_name=None)`

Class: `NeuralynxSortingExtractor` in `neoextractors/neuralynx.py`. Reads Neuralynx `.nse` / `.ntt` spike files.

Full signature (verbatim):

```python
class NeuralynxSortingExtractor(NeoBaseSortingExtractor):
    NeoRawIOClass = "NeuralynxRawIO"
    neo_returns_frames = True
    need_t_start_from_signal_stream = True

    def __init__(
        self,
        folder_path: str,
        sampling_frequency: float | None = None,
        stream_id: str | None = None,
        stream_name: str | None = None,
    ):
```

## `read_plexon_sorting(file_path)`

Class: `PlexonSortingExtractor` in `neoextractors/plexon.py`. Reads `.plx` files.

Full signature (verbatim):

```python
class PlexonSortingExtractor(NeoBaseSortingExtractor):
    NeoRawIOClass = "PlexonRawIO"
    neo_returns_frames = True

    def __init__(self, file_path):
```

Sampling frequency taken from `neo_reader._global_ssampling_rate`.

## `read_plexon2_sorting(file_path, sampling_frequency=None)`

Class: `Plexon2SortingExtractor` in `neoextractors/plexon2.py`. Reads `.pl2` files.

Full signature (verbatim):

```python
class Plexon2SortingExtractor(NeoBaseSortingExtractor):
    NeoRawIOClass = "Plexon2RawIO"
    neo_returns_frames = True

    def __init__(self, file_path, sampling_frequency=None):
```

- `sampling_frequency`: required only when the file contains multiple streams with different sampling rates.

## `read_neuroscope_sorting(folder_path=None, resfile_path=None, clufile_path=None, keep_mua_units=True, exclude_shanks=None, xml_file_path=None)`

Class: `NeuroScopeSortingExtractor` in `neoextractors/neuroscope.py`. Reads `.res.<i>` / `.clu.<i>` file pairs. Unit id 0 in the original data = unsorted noise (dropped); unit id 1 = multi-unit activity (kept when `keep_mua_units=True`). The returned unit ids always start at 1.

Full signature (verbatim):

```python
class NeuroScopeSortingExtractor(BaseSorting):
    def __init__(
        self,
        folder_path: str | Path | None = None,
        resfile_path: str | Path | None = None,
        clufile_path: str | Path | None = None,
        keep_mua_units: bool = True,
        exclude_shanks: list | None = None,
        xml_file_path: str | Path | None = None,
    ):
```

- Provide either `folder_path` (auto-detects all `.res.i/.clu.i` pairs) or a specific `resfile_path` + `clufile_path`.
- `exclude_shanks`: list of shank ids to skip.

Unit property set: `group` (shank id, when more than one shank).
