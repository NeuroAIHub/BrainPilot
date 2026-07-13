# Clustering — overview

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/clustering/`
Parent index: [../INDEX.md](../INDEX.md)

---

## Clustering

Module: `spikeinterface.sortingcomponents.clustering`. The `__init__.py`
only re-exports `find_clusters_from_peaks` (the registry is imported
lazily inside `main.py` to allow external plugins to inject methods).

### `find_clusters_from_peaks`

```python
from spikeinterface.sortingcomponents.clustering import find_clusters_from_peaks

find_clusters_from_peaks(
    recording,
    peaks,
    method=None,
    method_kwargs={},
    extra_outputs=False,
    verbose=False,
    job_kwargs=None,
)
```

- Note: the actual function name is `find_clusters_from_peaks` (plural).
- Returns `(labels_set, peak_labels)` when `extra_outputs=False`; the full
  method output tuple `(labels_set, peak_labels, more_outs)` when `True`.
- Registry: `clustering.method_list.clustering_methods`. Each value is a
  class exposing `name`, `_default_params` (dict), `params_doc` (str), and
  a `@classmethod main_function(cls, recording, peaks, params,
  job_kwargs=dict())`.

### Method registry (verified from `clustering/method_list.py`)

Exact registry keys:

- `"dummy"` → `DummyClustering`
- `"hdbscan-positions"` → `PositionsClustering`
- `"random-projections"` → `RandomProjectionClustering`
- `"iterative-hdbscan"` → `IterativeHDBSCANClustering`
- `"iterative-isosplit"` → `IterativeISOSPLITClustering`
- `"graph-clustering"` → `GraphClustering`
- `"kilosort-clustering"` → `KiloSortClustering` (external, only when
  `spikeinterface_kilosort_components` importable)

Beware: the class attribute `name` on `PositionsClustering` is
`"hdbscan_positions"` (underscore) and on `RandomProjectionClustering` is
`"random_projections"` (underscore), but the registry keys use hyphens
(`"hdbscan-positions"`, `"random-projections"`). Always use the registry
keys.
