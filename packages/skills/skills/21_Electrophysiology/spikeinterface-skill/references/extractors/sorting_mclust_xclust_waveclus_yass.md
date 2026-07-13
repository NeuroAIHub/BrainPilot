# Sorting extractors (MClust/XClust/WaveClus/Yass)
Source in repo: `spikeinterface/src/spikeinterface/extractors/` (mclustextractors.py, xclustextractors.py, waveclustextractors.py, yassextractors.py)
Parent index: [INDEX.md](INDEX.md)
---

## `read_mclust(folder_path, sampling_frequency, sampling_frequency_raw=None)`

Class: `MClustSortingExtractor` in `mclustextractors.py`. Reads MClust `.t64`, `.t32`, `.t`, `.raw64`, `.raw32` files (searched in that order).

Full signature (verbatim):

```python
class MClustSortingExtractor(BaseSorting):
    def __init__(self, folder_path, sampling_frequency, sampling_frequency_raw=None):
```

- `sampling_frequency`: Hz, mandatory (target sampling rate for the returned frames).
- `sampling_frequency_raw`: required if the on-disk files are `raw32` / `raw64`. E.g. use `10000` if raw times are in tenths of ms, or `sampling_frequency` if they are in samples.

File extension conventions:
- `.t` / `.t32`: read as big-endian `uint32` (`">u4"`); zero words are dropped (this transparently handles the case where the file is actually MClust 3.x big-endian `uint64` with zero high-words). Timestamps then divided by `10000`.
- `.t64`: read as big-endian `uint64` (`">u8"`); timestamps divided by `10000`.
- `.raw32` / `.raw64`: timestamps divided by `sampling_frequency_raw`.

Header sentinel: `%%ENDHEADER`. Unit ID parsed from a trailing `_<int>` in the filename stem (regex `_([0-9]+?)$`).

## `read_xclust(folder_path=None, *, file_path_list=None, sampling_frequency)`

Class: `XClustSortingExtractor` in `xclustextractors.py`. Reads legacy XClust ASCII `.CEL` files (McNaughton lab). Each file has a header (`%%BEGINHEADER`…`%%ENDHEADER`) with `% Cluster:` and `% Fields:` lines, followed by whitespace-separated data; a `time` field (in seconds) is required.

Full signature (verbatim):

```python
class XClustSortingExtractor(BaseSorting):
    def __init__(
        self,
        folder_path: str | Path | None = None,
        *,
        file_path_list: list[str | Path] | None = None,
        sampling_frequency: float,
    ):
```

- Provide exactly one of `folder_path` or `file_path_list` (kw-only after the star).
- `sampling_frequency`: required kw-only argument.

XClust filenames follow `<session_type>~<cluster_number>.CEL`. Unit IDs are formatted as `f"{session_type}_{cluster_number}"`. Unit properties set: `unit_name` (`f"{session_type}_cluster_{cluster_number}"`), `cluster_id` (the cluster number as parsed from the header).

## `read_waveclus(file_path, keep_good_only=True)`

Class: `WaveClusSortingExtractor` in `waveclustextractors.py` — combines `MatlabHelper` + `BaseSorting`. Reads `times_*.mat` files produced by WaveClus (fields `cluster_class`, `par/sr`).

Full signature (verbatim):

```python
class WaveClusSortingExtractor(MatlabHelper, BaseSorting):
    def __init__(self, file_path, keep_good_only=True):
```

- `keep_good_only`: drop unit id 0 (unsorted) — keeps only `unit_ids > 0`.

Unit property set: `unsorted` (bool, True where unit id == 0).

## `read_yass(folder_path)`

Class: `YassSortingExtractor` in `yassextractors.py`. Reads YASS output from `<folder>/tmp/output/spike_train.npy`, `<folder>/tmp/output/templates/templates_0sec.npy`, and `<folder>/config.yaml`.

Full signature (verbatim):

```python
class YassSortingExtractor(BaseSorting):
    installation_mesg = "To use the Yass extractor, install pyyaml: \n\n pip install pyyaml\n\n"

    def __init__(self, folder_path):
```

Sampling rate is taken from `config['recordings']['sampling_rate']`.
