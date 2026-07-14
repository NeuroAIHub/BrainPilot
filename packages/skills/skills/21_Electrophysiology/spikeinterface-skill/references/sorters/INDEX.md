# SpikeInterface `sorters` module — index

Reference for `spikeinterface.sorters`, the module responsible for running spike sorting
algorithms (internal or wrapped external ones), managing default parameters, dispatching to
containers, and launching many jobs at once.

Source in repo: `spikeinterface/src/spikeinterface/sorters/`

This directory splits the original `sorters.md` reference into topical leaf files, each
under 300 lines. Content is preserved verbatim from the source.

## Leaf files

### Top-level API and dispatch

- [overview.md](overview.md) — Quick start and public API surface.
- [helper_signatures.md](helper_signatures.md) — Verbatim signatures of every top-level helper
  (`run_sorter`, `run_sorter_local`, `run_sorter_container`, `read_sorter_folder`,
  `run_sorter_by_property`, `run_sorter_jobs`, `get_default_sorter_params`,
  `get_sorter_params_description`, `get_sorter_description`, `print_sorter_versions`,
  `installed_sorters`, `available_sorters`, `archived_sorters`, module-level attributes).
- [discovery_and_metadata.md](discovery_and_metadata.md) — Behaviour of the discovery /
  metadata helpers exposed from `sorterlist.py`.
- [run_sorter.md](run_sorter.md) — Semantics of `run_sorter`, `run_sorter_local`,
  `run_sorter_container`, `read_sorter_folder`.
- [containers.md](containers.md) — Docker / Singularity dispatch, `SORTER_DOCKER_MAP`, and
  `ContainerClient` helpers.
- [batch_execution.md](batch_execution.md) — `run_sorter_jobs`, `run_sorter_by_property`,
  supported engines, default engine kwargs, Slurm submission.

### Supported sorter classes

- [sorter_registry.md](sorter_registry.md) — `sorter_full_list`, `archived_sorter_list`,
  optional third-party `Kilosort4LikeSorter`, `BaseSorter` class-attribute defaults.
- [internal_sorters.md](internal_sorters.md) — Internal sorters (`simple`, `spykingcircus2`,
  `tridesclous2`, `lupin`, `kilosort4_like`).
- [external_kilosort_family_a.md](external_kilosort_family_a.md) — External Kilosort family
  part A: `kilosort`, `kilosort2`, `kilosort2_5`.
- [external_kilosort_family_b.md](external_kilosort_family_b.md) — External Kilosort family
  part B: `kilosort3`, `kilosort4`, `pykilosort`.
- [external_mountainsort_spykingcircus.md](external_mountainsort_spykingcircus.md) —
  `mountainsort4`, `mountainsort5`, `spykingcircus`, `tridesclous`.
- [external_other_a.md](external_other_a.md) — Other external sorters part A: `combinato`,
  `hdsort`, `herdingspikes`, `ironclust`.
- [external_other_b.md](external_other_b.md) — Other external sorters part B: `rtsort`,
  `waveclus`, `waveclus_snippets`.
- [archived_sorters.md](archived_sorters.md) — Archived sorters (`klusta`, `yass`).

### Utilities

- [utils.md](utils.md) — Utilities in `sorters/utils/` and helpers re-exported from
  `container_tools.py`.

## Quick sorter-name index

| Sorter name | Class | Leaf file |
|---|---|---|
| `simple` | `SimpleSorter` | [internal_sorters.md](internal_sorters.md) |
| `spykingcircus2` | `Spykingcircus2Sorter` | [internal_sorters.md](internal_sorters.md) |
| `tridesclous2` | `Tridesclous2Sorter` | [internal_sorters.md](internal_sorters.md) |
| `lupin` | `LupinSorter` | [internal_sorters.md](internal_sorters.md) |
| `kilosort4_like` | `Kilosort4LikeSorter` (optional) | [internal_sorters.md](internal_sorters.md) |
| `combinato` | `CombinatoSorter` | [external_other_a.md](external_other_a.md) |
| `hdsort` | `HDSortSorter` | [external_other_a.md](external_other_a.md) |
| `herdingspikes` | `HerdingspikesSorter` | [external_other_a.md](external_other_a.md) |
| `ironclust` | `IronClustSorter` | [external_other_a.md](external_other_a.md) |
| `kilosort` | `KilosortSorter` | [external_kilosort_family_a.md](external_kilosort_family_a.md) |
| `kilosort2` | `Kilosort2Sorter` | [external_kilosort_family_a.md](external_kilosort_family_a.md) |
| `kilosort2_5` | `Kilosort2_5Sorter` | [external_kilosort_family_a.md](external_kilosort_family_a.md) |
| `kilosort3` | `Kilosort3Sorter` | [external_kilosort_family_b.md](external_kilosort_family_b.md) |
| `kilosort4` | `Kilosort4Sorter` | [external_kilosort_family_b.md](external_kilosort_family_b.md) |
| `pykilosort` | `PyKilosortSorter` | [external_kilosort_family_b.md](external_kilosort_family_b.md) |
| `mountainsort4` | `Mountainsort4Sorter` | [external_mountainsort_spykingcircus.md](external_mountainsort_spykingcircus.md) |
| `mountainsort5` | `Mountainsort5Sorter` | [external_mountainsort_spykingcircus.md](external_mountainsort_spykingcircus.md) |
| `spykingcircus` | `SpykingcircusSorter` | [external_mountainsort_spykingcircus.md](external_mountainsort_spykingcircus.md) |
| `tridesclous` | `TridesclousSorter` | [external_mountainsort_spykingcircus.md](external_mountainsort_spykingcircus.md) |
| `rtsort` | `RTSortSorter` | [external_other_b.md](external_other_b.md) |
| `waveclus` | `WaveClusSorter` | [external_other_b.md](external_other_b.md) |
| `waveclus_snippets` | `WaveClusSnippetsSorter` | [external_other_b.md](external_other_b.md) |
| `klusta` | `KlustaSorter` (archived) | [archived_sorters.md](archived_sorters.md) |
| `yass` | `YassSorter` (archived, but also in `sorter_full_list`) | [archived_sorters.md](archived_sorters.md) |
