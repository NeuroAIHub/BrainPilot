# Sorting extractors (Klusta/Combinato/HDSort)
Source in repo: `spikeinterface/src/spikeinterface/extractors/` (klustaextractors.py, combinatoextractors.py, hdsortextractors.py)
Parent index: [INDEX.md](INDEX.md)
---

## `read_klusta(file_or_folder_path, exclude_cluster_groups=None)`

Class: `KlustaSortingExtractor` in `klustaextractors.py`. Loads `.kwik` HDF5 output from Klusta (KwikTeam / phy-doc kwik format).

Full signature (verbatim):

```python
class KlustaSortingExtractor(BaseSorting):
    installation_mesg = "To use the KlustaSortingExtractor install h5py: \n\n pip install h5py\n\n"

    default_cluster_groups = {0: "Noise", 1: "MUA", 2: "Good", 3: "Unsorted"}

    def __init__(self, file_or_folder_path, exclude_cluster_groups=None):
```

- `file_or_folder_path`: a `.kwik` file or a directory containing exactly one.
- `exclude_cluster_groups`: list of group name strings; each must be exactly one of `"noise"`, `"mua"`, `"good"`, `"unsorted"` (lowercase). Must be a list (a bare string is rejected).

Sampling frequency comes from `traces.sample_rate` of the associated `.prm` file. Unit properties set: `group` (channel group id) and `quality` (lowercased cluster group name).

## `read_combinato(folder_path, sampling_frequency=None, user="simple", det_sign="both", keep_good_only=True)`

Class: `CombinatoSortingExtractor` in `combinatoextractors.py`. Reads Combinato H5 output (`data_<folder>.h5` in the folder plus `sort_<sign>_<user>/sort_cat.h5` subfolders).

Full signature (verbatim):

```python
class CombinatoSortingExtractor(BaseSorting):
    installation_mesg = "To use the CombinatoSortingExtractor install h5py: \n\n pip install h5py\n\n"

    def __init__(self, folder_path, sampling_frequency=None, user="simple", det_sign="both", keep_good_only=True):
```

- `sampling_frequency`: read from adjacent `<folder>.h5` (`sr` dataset) if `None`.
- `user`: username string used in `sort_<sign>_<user>` subfolder names.
- `det_sign`: one of `"both"`, `"pos"`, `"neg"` — which detection polarity subfolders to load.
- `keep_good_only`: skip units whose group `type < 1` (artifact = -1, unsorted = 0).

Unit properties set: `unsorted` (bool, group type 0), `artifact` (bool, group type -1).

## `read_hdsort(file_path, keep_good_only=True)`

Class: `HDSortSortingExtractor` in `hdsortextractors.py` — combines `MatlabHelper` + `BaseSorting`. Handles both old-style `.mat` files and 7.3 HDF5-based `.mat` transparently.

Full signature (verbatim):

```python
class HDSortSortingExtractor(MatlabHelper, BaseSorting):
    def __init__(self, file_path, keep_good_only=True):
```

- `keep_good_only`: drop units with `int(ID) % 1000 == 0` (noise units).

Unit properties set: `template` (numpy array), `template_frames_cut_before` (int per unit). Reads a `sortingInfo.startTimes` field if present and subtracts it from spike times (`self.start_frame`).
