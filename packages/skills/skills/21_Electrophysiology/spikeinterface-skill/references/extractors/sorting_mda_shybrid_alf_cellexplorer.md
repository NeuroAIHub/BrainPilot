# Sorting extractors (MDA/SHYBRID/ALF/CellExplorer)
Source in repo: `spikeinterface/src/spikeinterface/extractors/` (mdaextractors.py, shybridextractors.py, alfsortingextractor.py, cellexplorersortingextractor.py)
Parent index: [INDEX.md](INDEX.md)
---

## `read_mda_sorting(file_path, sampling_frequency)`

Class: `MdaSortingExtractor` in `mdaextractors.py`. Reads MountainSort `.mda` firings file: row 0 = max channel (1-indexed), row 1 = spike times (samples), row 2 = unit labels.

Full signature (verbatim):

```python
class MdaSortingExtractor(BaseSorting):
    def __init__(self, file_path, sampling_frequency):
```

Unit property set: `max_channel` (int per unit; channels are 1-indexed as in MDA convention).

Also provides:

```python
@staticmethod
def write_sorting(sorting, save_path, write_primary_channels=False):
```

## `read_shybrid_sorting(file_path, sampling_frequency, delimiter=",")`

Class: `SHYBRIDSortingExtractor` in `shybridextractors.py`. Reads a SHYBRID CSV of `(unit_id, spike_frame)` rows via `hybridizer.io.SpikeClusters.fromCSV`.

Full signature (verbatim):

```python
class SHYBRIDSortingExtractor(BaseSorting):
    installation_mesg = "To use the SHYBRID extractors, install SHYBRID: \n\n pip install shybrid\n\n"

    def __init__(self, file_path, sampling_frequency, delimiter=","):
```

- `file_path` must have `.csv` suffix.

Also provides:

```python
@staticmethod
def write_sorting(sorting, save_path):
    # writes save_path / "initial_sorting.csv"
```

## `read_alf_sorting(folder_path, sampling_frequency=30000)`

Class: `ALFSortingExtractor` in `alfsortingextractor.py`. Uses `one.alf.io.load_object` to read the ALF (`spikes`, `clusters`) objects from a folder.

Full signature (verbatim):

```python
class ALFSortingExtractor(BaseSorting):
    installation_mesg = "To use the ALF extractors, install ONE-api: \n\n pip install ONE-api\n\n"

    def __init__(self, folder_path, sampling_frequency=30000):
```

Note: only `read_alf_sorting` is exposed (no `read_alfsorting` alias).

## `read_cellexplorer(file_path, sampling_frequency=None, session_info_file_path=None)`

Class: `CellExplorerSortingExtractor` in `cellexplorersortingextractor.py`. Reads CellExplorer `.spikes.cellinfo.mat` files. Requires `pymatreader`.

Full signature (verbatim):

```python
class CellExplorerSortingExtractor(BaseSorting):
    installation_mesg = "To use the CellExplorerSortingExtractor install pymatreader"

    def __init__(
        self,
        file_path: str | Path,
        sampling_frequency: float | None = None,
        session_info_file_path: str | Path | None = None,
    ):
```

Sampling frequency resolution order:
1. `spikes.sr` from the `.spikes.cellinfo.mat` file.
2. `session.extracellular.sr` from `<session_id>.session.mat` (if present).
3. `sessionInfo.rates.wideband` from `<session_id>.sessionInfo.mat` (used only if `session_info_file_path` is passed or auto-inferred).

Session id is derived from the filename stem via `stem.split(".")[0]`. Unit ids are the `UID` values converted to strings.

Waveform-related fields are added to `read_mat`'s `ignore_fields=` argument for speed:
`maxWaveformCh`, `maxWaveformCh1`, `peakVoltage`, `peakVoltage_expFitLengthConstant`, `peakVoltage_sorted`, `amplitudes`, `filtWaveform`, `filtWaveform_std`, `rawWaveform`, `rawWaveform_std`, `timeWaveform`, `maxWaveform_all`, `rawWaveform_all`, `filtWaveform_all`, `timeWaveform_all`, `channels_all`.
