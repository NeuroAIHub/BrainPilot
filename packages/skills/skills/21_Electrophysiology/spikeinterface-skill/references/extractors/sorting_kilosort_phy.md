# Sorting extractors (Kilosort/Phy)
Source in repo: `spikeinterface/src/spikeinterface/extractors/phykilosortextractors.py`
Parent index: [INDEX.md](INDEX.md)
---

## `read_phy(folder_path, exclude_cluster_groups=None, load_all_cluster_properties=True)`

Class: `PhySortingExtractor` in `phykilosortextractors.py`. Wraps a Phy manual-curation output folder (`spike_times.npy`, `spike_clusters.npy` — or `spike_templates.npy` as fallback — `params.py`, plus `cluster_*.tsv`/`.csv`).

Full signature (verbatim):

```python
class PhySortingExtractor(BasePhyKilosortSortingExtractor):
    def __init__(
        self,
        folder_path: Path | str,
        exclude_cluster_groups: list[str] | str | None = None,
        load_all_cluster_properties: bool = True,
    ):
```

- `folder_path`: path to Phy folder containing `params.py`.
- `exclude_cluster_groups`: cluster group label(s) to drop (e.g. `"noise"` or `["noise", "mua"]`).
- `load_all_cluster_properties`: load every cluster property tsv/csv column as a unit property.

Unit properties set: `group` renamed to `quality`, `cluster_id` renamed to `original_cluster_id`, plus every other detected column. `chan_grp` / `ch_group` / `channel_group` are renamed to `group`. If a `si_unit_id` column exists it is consumed to re-number units.

## `read_kilosort(folder_path, keep_good_only=False, remove_empty_units=True)`

Class: `KiloSortSortingExtractor` in `phykilosortextractors.py`. Handles raw Kilosort output (same on-disk convention as Phy: `spike_times.npy`, `spike_clusters.npy` or `spike_templates.npy`, `params.py`, `cluster_KSLabel.tsv`, `cluster_group.tsv`, …).

Full signature (verbatim):

```python
class KiloSortSortingExtractor(BasePhyKilosortSortingExtractor):
    def __init__(self, folder_path: Path | str, keep_good_only: bool = False, remove_empty_units: bool = True):
```

- `keep_good_only`: keep only units where `KSLabel == 'good'`.
- `remove_empty_units`: drop clusters with no assigned spikes.

## Base signature `BasePhyKilosortSortingExtractor`

Both `PhySortingExtractor` and `KiloSortSortingExtractor` delegate to this base:

```python
class BasePhyKilosortSortingExtractor(BaseSorting):
    installation_mesg = "To use the PhySortingExtractor install pandas: \n\n pip install pandas\n\n"

    def __init__(
        self,
        folder_path: Path | str,
        exclude_cluster_groups: list[str] | str | None = None,
        keep_good_only: bool = False,
        remove_empty_units: bool = False,
        load_all_cluster_properties: bool = True,
    ):
```

Cluster info loading priority: (1) single `cluster_info.csv`/`.tsv` if present; (2) merge of all csv/tsv files containing a `cluster_id` column (typical: `cluster_group.tsv`, `cluster_info.tsv`, `cluster_KSLabel.tsv`); (3) fall back to `{"cluster_id": unit_ids, "group": "unsorted"}`. Files without `cluster_id` are skipped.

## `read_kilosort_as_analyzer(folder_path, unwhiten=True, gain_to_uV=None, offset_to_uV=None) -> SortingAnalyzer`

Not a wrapper — a real function in `phykilosortextractors.py`. Load Kilosort output directly into a `SortingAnalyzer` (targeting Kilosort ≥ 4.1). Reads `templates.npy`, `whitening_mat_inv.npy`, optional `probe.prb` or `channel_positions.npy`, optional `spike_positions.npy`, optional `ops.npy` for `ms_before` / `ms_after`.

```python
def read_kilosort_as_analyzer(folder_path, unwhiten=True, gain_to_uV=None, offset_to_uV=None) -> SortingAnalyzer:
```

- `unwhiten` (bool, default True): un-whiten templates via `wh_inv`.
- `gain_to_uV` (float | None, default None): defaults to `1.0` with a warning (dimensionless output).
- `offset_to_uV` (float | None, default None): defaults to `0.0` with a warning.

Attaches extensions: `random_spikes`, `templates` (`operators=["average"]`), and (if `spike_positions.npy` present) `spike_locations` (structured dtype with columns `["x", "y", "z"][:num_dims]`).
