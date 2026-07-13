# Supported sorter classes — registry

Source in repo: `spikeinterface/src/spikeinterface/sorters/sorterlist.py`
Parent index: [INDEX.md](INDEX.md)
---

`sorter_full_list` (order in source):

External:
`CombinatoSorter`, `HDSortSorter`, `HerdingspikesSorter`, `IronClustSorter`, `KilosortSorter`,
`Kilosort2Sorter`, `Kilosort2_5Sorter`, `Kilosort3Sorter`, `Kilosort4Sorter`,
`PyKilosortSorter`, `Mountainsort4Sorter`, `Mountainsort5Sorter`, `RTSortSorter`,
`SpykingcircusSorter`, `TridesclousSorter`, `WaveClusSorter`, `WaveClusSnippetsSorter`,
`YassSorter`.

Internal:
`Spykingcircus2Sorter`, `Tridesclous2Sorter`, `SimpleSorter`, `LupinSorter`.

Optional:
`Kilosort4LikeSorter` (appended if the third-party
`spikeinterface_kilosort_components.kilosort_like_sorter.Kilosort4LikeSorter` is importable).

`archived_sorter_list = [KlustaSorter, YassSorter]`. Note: `YassSorter` is present in both lists
in the source — `sorter_full_list` contains it too.

`BaseSorter` class-attribute defaults inherited by every sorter:
`sorter_name = ""`, `compiled_name = None`, `SortingExtractor_Class = None`,
`requires_locations = False`, `gpu_capability = "not-supported"`, `requires_binary_data = False`,
`compatible_with_parallel = {"loky": True, "multiprocessing": True, "threading": True}`,
`_default_params = {}`, `_params_description = {}`, `sorter_description = ""`,
`installation_mesg = ""`, `handle_multi_segment = False`.
