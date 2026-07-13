# Sorting extractors (Tridesclous/SpykingCircus/HerdingSpikes)
Source in repo: `spikeinterface/src/spikeinterface/extractors/` (tridesclousextractors.py, spykingcircusextractors.py, herdingspikesextractors.py)
Parent index: [INDEX.md](INDEX.md)
---

## `read_tridesclous(folder_path, chan_grp=None)`

Class: `TridesclousSortingExtractor` in `tridesclousextractors.py`. Uses the `tridesclous` package to open a `DataIO` folder and load the `"initial"` catalogue.

Full signature (verbatim):

```python
class TridesclousSortingExtractor(BaseSorting):
    installation_mesg = "To use the TridesclousSortingExtractor install tridesclous: \n\n pip install tridesclous\n\n"

    def __init__(self, folder_path, chan_grp=None):
```

- `chan_grp`: channel group id; if `None`, requires a single group in the folder.

Cluster labels < 0 (noise/unmapped) are dropped. All spikes are loaded into memory per segment to avoid a memmap file lock.

## `read_spykingcircus(folder_path)`

Class: `SpykingCircusSortingExtractor` in `spykingcircusextractors.py`. Discovers a subfolder containing `result.hdf5` (or `result-merged.hdf5`, preferred if present) and reads spike times from `spiketimes` groups keyed as `temp_<unit_id>`. Sampling rate parsed from a `*.params` file in the parent folder.

Full signature (verbatim):

```python
class SpykingCircusSortingExtractor(BaseSorting):
    installation_mesg = "To use the SpykingCircusSortingExtractor install h5py: \n\n pip install h5py\n\n"

    def __init__(self, folder_path):
```

## `read_herdingspikes(file_path)`

Class: `HerdingspikesSortingExtractor` in `herdingspikesextractors.py` (alias `HS2SortingExtractor` preserved for backwards compatibility). Reads HerdingSpikes HDF5: keys `Sampling`, `cluster_id`, `times`, `centres`.

Full signature (verbatim):

```python
class HerdingspikesSortingExtractor(BaseSorting):
    installation_mesg = "To use the HS2SortingExtractor install h5py: \n\n pip install h5py\n\n"

    def __init__(self, file_path):
```

Unit property set: `hs_location` (2-D coordinate per unit, from `centres`).
