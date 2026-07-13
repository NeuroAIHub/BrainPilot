# Clustering — iterative-hdbscan

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/clustering/iterative_hdbscan.py`
Parent index: [../INDEX.md](../INDEX.md)

---

### `iterative-hdbscan` — `IterativeHDBSCANClustering`

- `name = "iterative-hdbscan"`
- `need_noise_levels = False`
- `_default_params`:
  ```python
  {
      "peaks_svd": {
          "n_components": 5,
          "ms_before": 0.5,
          "ms_after": 1.5,
          "radius_um": 100.0,
      },
      "seed": None,
      "noise_levels": None,
      "split": {
          "split_radius_um": 75.0,
          "recursive": True,
          "recursive_depth": 3,
          "method_kwargs": {
              "clusterer": {
                  "method": "hdbscan",
                  "min_cluster_size": 20,
                  "allow_single_cluster": True,
              },
              "n_pca_features": 3,
          },
      },
      "clean_templates": {
          "sparsify_threshold": 1.0,
          "min_snr": 2.5,
          "remove_empty": True,
          "max_jitter_ms": 0.2,
      },
      "merge_from_templates": dict(
          similarity_thresh=0.8, num_shifts=3, use_lags=True,
      ),
      "merge_from_features": None,
      "clean_low_firing": {
          "min_firing_rate": 0.1,
          "subsampling_factor": None,
      },
      "debug_folder": None,
      "verbose": True,
  }
  ```
