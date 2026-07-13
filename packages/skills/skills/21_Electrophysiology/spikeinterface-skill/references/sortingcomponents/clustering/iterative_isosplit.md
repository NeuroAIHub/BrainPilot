# Clustering — iterative-isosplit

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/clustering/iterative_isosplit.py`
Parent index: [../INDEX.md](../INDEX.md)

---

### `iterative-isosplit` — `IterativeISOSPLITClustering`

- `name = "iterative-isosplit"`
- `need_noise_levels = False`
- `_default_params`:
  ```python
  {
      "motion": None,
      "seed": None,
      "noise_levels": None,
      "peaks_svd": {
          "n_components": 5,
          "ms_before": 0.5,
          "ms_after": 1.5,
          "radius_um": 120.0,
          "motion": None,
      },
      "pre_label": {"mode": "channel"},
      "split": {
          "split_radius_um": 60.0,
          "recursive": True,
          "recursive_depth": 3,
          "method_kwargs": {
              "clusterer": {
                  "method": "isosplit",
                  "min_cluster_size": 10,
                  "max_iterations_per_pass": 500,
                  "isocut_threshold": 2.0,
              },
              "min_size_split": 25,
              "n_pca_features": 6,
              "projection_mode": "tsvd",
          },
      },
      "clean_templates": {
          "max_jitter_ms": 0.2,
          "min_snr": 2.5,
          "sparsify_threshold": 1.0,
          "remove_empty": True,
      },
      "merge_from_templates": {
          "similarity_metric": "l1",
          "num_shifts": 3,
          "similarity_thresh": 0.8,
          "use_lags": True,
      },
      "merge_from_features": None,
      "clean_low_firing": {
          "min_firing_rate": 0.1,
          "subsampling_factor": None,
      },
      "debug_folder": None,
      "verbose": True,
  }
  ```

`pre_label.mode` accepts `"channel"` or `"vertical_bin"` (source-supported
literals). Inner `clusterer.method` accepts `"isosplit"` or `"isosplit6"`
(the latter is commented out in defaults but supported by the splitter).
