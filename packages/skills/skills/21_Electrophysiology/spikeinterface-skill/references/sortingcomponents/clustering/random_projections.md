# Clustering — random-projections

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/clustering/random_projections.py`
Parent index: [../INDEX.md](../INDEX.md)

---

### `random-projections` — `RandomProjectionClustering`

- `name = "random_projections"` (class attribute; registry key is
  `"random-projections"`).
- `_default_params`:
  ```python
  {
      "clusterer": {
          "min_cluster_size": 10,
          "allow_single_cluster": True,
          "core_dist_n_jobs": -1,
          "cluster_selection_method": "eom",
      },
      "waveforms": {"ms_before": 0.5, "ms_after": 1.5},
      "sparsity": {
          "method": "snr",
          "amplitude_mode": "peak_to_peak",
          "threshold": 0.25,
      },
      "radius_um": 50,
      "nb_projections": 10,
      "feature": "ptp",
      "seed": 42,
      "smoothing": {"window_length_ms": 0.25},
      "merge_from_templates": dict(),
      "debug_folder": None,
      "verbose": True,
  }
  ```
