# Clustering — graph-clustering

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/clustering/graph_clustering.py`
Parent index: [../INDEX.md](../INDEX.md)

---

### `graph-clustering` — `GraphClustering`

- `name = "graph-clustering"`
- `need_noise_levels = False`
- `_default_params`:
  ```python
  {
      "peaks_svd": {
          "n_components": 5,
          "ms_before": 0.5,
          "ms_after": 1.5,
          "radius_um": 100.0,
          "motion": None,
      },
      "seed": None,
      "graph_kwargs": dict(
          bin_mode="channels",
          neighbors_radius_um=50.0,
          normed_distances=True,
          n_neighbors=5,
          n_components=10,
          sparse_mode="knn",
          apply_local_svd=True,
          enforce_diagonal_to_zero=True,
      ),
      "clusterer": dict(method="sknetwork-louvain"),
      "debug_folder": None,
      "verbose": True,
  }
  ```

`graph_kwargs.bin_mode` accepts `"channels"` or `"vertical_bins"`
(asserted in `main_function`). `clusterer.method` must be one of
(hard-asserted list in the source):

- `"networkx-louvain"`
- `"sknetwork-louvain"`
- `"sknetwork-leiden"`
- `"leidenalg"`
- `"hdbscan"`
