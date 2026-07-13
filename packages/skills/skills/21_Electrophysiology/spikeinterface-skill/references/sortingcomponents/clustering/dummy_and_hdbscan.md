# Clustering — dummy and hdbscan-positions

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/clustering/`
Parent index: [../INDEX.md](../INDEX.md)

---

### `dummy` — `DummyClustering`

- `name = "dummy"`
- `_default_params = {}` (no parameters)
- `main_function(cls, recording, peaks, params, job_kwargs=dict())` returns
  `(labels, peak_labels)` where `peak_labels = peaks["channel_index"]`.

### `hdbscan-positions` — `PositionsClustering`

- `name = "hdbscan_positions"` (class attribute; registry key is
  `"hdbscan-positions"`).
- `need_noise_levels = False`
- `_default_params`:
  ```python
  {
      "peak_locations": None,
      "peak_localization_kwargs": {"method": "center_of_mass"},
      "hdbscan_kwargs": {
          "min_cluster_size": 20,
          "allow_single_cluster": True,
          "core_dist_n_jobs": -1,
      },
  }
  ```
