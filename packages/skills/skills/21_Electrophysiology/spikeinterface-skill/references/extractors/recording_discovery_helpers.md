# Recording discovery helpers
Source in repo: `spikeinterface/src/spikeinterface/extractors/neoextractors/neo_utils.py` and `extractors/phykilosortextractors.py`
Parent index: [INDEX.md](INDEX.md)
---

## `get_neo_streams` / `get_neo_num_blocks`

Source: `extractors/neoextractors/neo_utils.py`. Both accept the same `*args, **kwargs` you would pass to the corresponding `read_*` (e.g. `folder_path=` for SpikeGLX, `file_path=` for Intan).

```python
def get_neo_streams(extractor_name, *args, **kwargs):
    """
    Returns
    -------
    stream_names : list of str
    stream_ids   : list of str
    """

def get_neo_num_blocks(extractor_name, *args, **kwargs) -> int:
    """Returns the number of NEO blocks (most datasets have 1)."""
```

Valid `extractor_name` values (built as `class.__name__.replace("Recording","").replace("Extractor","").lower()`):

`"alphaomega"`, `"axon"`, `"axona"`, `"biocam"`, `"blackrock"`, `"ced"`, `"edf"`, `"intan"`, `"maxwell"`, `"mearec"`, `"mcsraw"`, `"neuralynx"`, `"neuroscope"`, `"neuronexus"`, `"nix"`, `"openephysbinary"`, `"openephyslegacy"`, `"plexon"`, `"plexon2"`, `"spike2"`, `"spikegadgets"`, `"spikeglx"`, `"tdt"`, `"neuroexplorer"`.

## Per-class static helpers

- `SpikeGLXRecordingExtractor.get_streams(folder_path)` → `(stream_names, stream_ids)`. Same for every other `NeoBaseRecordingExtractor` subclass.
- `OpenEphysBinaryRecordingExtractor.get_available_experiments(folder_path)` → `list[str]` (e.g. `["experiment1", "experiment2"]`).
- `OpenEphysBinaryEventExtractor.get_available_experiments(folder_path)` → `list[str]`.
- `IblRecordingExtractor.get_stream_names(eid, cache_folder=None, one=None)` → `list[str]`.
- `NwbRecordingExtractor.fetch_available_electrical_series_paths(file_path, stream_mode=None, storage_options=None)` → `list[str]`.
- `NwbSortingExtractor.fetch_available_units_tables(file_path, stream_mode=None, storage_options=None)` → `list[str]`.
- `NwbTimeSeriesExtractor.fetch_available_timeseries_paths(file_path, stream_mode=None, storage_options=None)` → `list[str]`.
- `MEArecSortingExtractor.read_sampling_frequency(self, file_path: str | Path) -> float` (instance method).

## `read_kilosort_as_analyzer`

Source: `extractors/phykilosortextractors.py` (re-exported from `spikeinterface.extractors`). Loads a Kilosort/Phy output directly into a `SortingAnalyzer` (analyzer object), not a plain sorting or recording. Mentioned here because it is imported alongside the extractors; see Part B for its full signature.
