# Quality Metrics — PCA registry (mahalanobis .. nn_advanced)
Source in repo: `spikeinterface/src/spikeinterface/metrics/quality/pca_metrics.py`
Parent index: [../INDEX.md](../INDEX.md)
---

## Metric registry — PCA (principal-component based)

The list `pca_metrics_list` in `pca_metrics.py` (verbatim):

```python
pca_metrics_list = [
    Mahalanobis,
    DPrime,
    NearestNeighbor,
    Silhouette,
    NearestNeighborAdvanced,
]
```

All PCA metrics require the `principal_components` extension and use `needs_tmp_data = True` — the `_prepare_data` step in `ComputeQualityMetrics` builds a per-unit dict of flattened PC projections, labels, neighbor unit ids, and neighbor channel indices (using sparsity when available).

### mahalanobis (isolation_distance + l_ratio)

Class `Mahalanobis` — a single metric that produces two columns. Legacy names `isolation_distance` and `l_ratio` are aliased to this metric (see `deprecated_names`). Verbatim class body:

```python
class Mahalanobis(BaseMetric):
    metric_name = "mahalanobis"
    metric_function = _mahalanobis_metrics_function
    metric_params = {}
    metric_columns = {"isolation_distance": float, "l_ratio": float}
    metric_descriptions = {
        "isolation_distance": "Isolation distance metric based on Mahalanobis distance.",
        "l_ratio": "L-ratio metric based on Mahalanobis distance.",
    }
    depend_on = ["principal_components"]
    needs_tmp_data = True
    deprecated_names = ["l_ratio", "isolation_distance"]
```

Registered metric function (verbatim):

```python
def _mahalanobis_metrics_function(sorting_analyzer, unit_ids, tmp_data, **metric_params):
```

Returns `namedtuple("MahalanobisResult", ["isolation_distance", "l_ratio"])`.

Underlying low-level function (in `pca_metrics.py`, verbatim):

```python
def mahalanobis_metrics(all_pcs, all_labels, this_unit_id):
```

Definition (Schmitzer-Torbert et al.):
- `isolation_distance` = squared Mahalanobis distance from the target cluster's PC centroid to the `n`-th nearest spike of another cluster, where `n = min(|this|, |others|)`.
- `l_ratio` = `sum(1 - chi2_cdf(mahalanobis_other^2, dof)) / num_spikes_self`.

Requires `principal_components`.

### d_prime

Class `DPrime`, verbatim class body:

```python
class DPrime(BaseMetric):
    metric_name = "d_prime"
    metric_function = _d_prime_metric_function
    metric_params = {}
    metric_columns = {"d_prime": float}
    metric_descriptions = {"d_prime": "D-prime metric based on Linear Discriminant Analysis in PCA space."}
    depend_on = ["principal_components"]
    needs_tmp_data = True
```

Registered metric function (verbatim):

```python
def _d_prime_metric_function(sorting_analyzer, unit_ids, tmp_data, **metric_params):
```

Underlying low-level function (verbatim):

```python
def d_prime_metric(all_pcs, all_labels, this_unit_id) -> float:
```

Definition (Hill): fit `LinearDiscriminantAnalysis(n_components=1)` on target-vs-rest labels, then `d' = (mean_target - mean_rest) / sqrt((var_target + var_rest) / 2)` on the LDA-projected values.

Requires `principal_components`.

### nearest_neighbor (nn_hit_rate + nn_miss_rate)

Class `NearestNeighbor`, verbatim class body:

```python
class NearestNeighbor(BaseMetric):
    metric_name = "nearest_neighbor"
    metric_function = _nearest_neighbor_metric_function
    metric_params = {"max_spikes": 10000, "n_neighbors": 5}
    metric_columns = {"nn_hit_rate": float, "nn_miss_rate": float}
    metric_descriptions = {
        "nn_hit_rate": "Nearest neighbor hit rate metric based on PCA space.",
        "nn_miss_rate": "Nearest neighbor miss rate metric based on PCA space.",
    }
    depend_on = ["principal_components"]
    needs_tmp_data = True
```

Registered metric function (verbatim):

```python
def _nearest_neighbor_metric_function(sorting_analyzer, unit_ids, tmp_data, **metric_params):
```

Underlying low-level function (verbatim):

```python
def nearest_neighbors_metrics(all_pcs, all_labels, this_unit_id, max_spikes, n_neighbors):
```

Definition (Chung): among the `n_neighbors` nearest neighbors (in flattened PC space) of each spike in the target cluster, `hit_rate` is the fraction that also belong to the target; `miss_rate` is the fraction of neighbors of non-target spikes that end up in the target.

Requires `principal_components`.

### silhouette

Class `Silhouette`, verbatim class body:

```python
class Silhouette(BaseMetric):
    metric_name = "silhouette"
    metric_function = _silhouette_metric_function
    metric_params = {"method": "simplified"}
    metric_columns = {"silhouette": float}
    metric_descriptions = {"silhouette": "Silhouette score metric based on PCA space."}
    depend_on = ["principal_components"]
    needs_tmp_data = True
```

Registered metric function (verbatim):

```python
def _silhouette_metric_function(sorting_analyzer, unit_ids, tmp_data, **metric_params):
```

Parameter `method : "simplified" | "full"` (dispatched inside `_silhouette_metric_function`):
- `"simplified"` — uses cluster centroids only (fast, from Hruschka). Underlying function `simplified_silhouette_score(all_pcs, all_labels, this_unit_id)`.
- `"full"` (any value other than `"simplified"`, per the `else` branch) — full pairwise Silhouette (Rousseeuw). Underlying function `silhouette_score(all_pcs, all_labels, this_unit_id)`.

Range: `[-1, 1]`, higher = better clustering.

Requires `principal_components`.

### nn_advanced (nn_isolation + nn_noise_overlap)

Class `NearestNeighborAdvanced` — a single grouped metric producing two columns. Legacy metric names `nn_isolation` and `nn_noise_overlap` are aliased to this. This metric is **not** included when `metric_names=None` (dropped by `_set_params` because it is slow). Verbatim class body:

```python
class NearestNeighborAdvanced(BaseMetric):
    metric_name = "nn_advanced"
    metric_function = _nn_advanced_metric_function
    metric_params = {
        "max_spikes": 1000,
        "min_spikes": 10,
        "min_fr": 0.0,
        "n_neighbors": 4,
        "n_components": 10,
        "radius_um": 100,
        "min_spatial_overlap": 0.5,
        "seed": None,
    }
    metric_columns = {"nn_isolation": float, "nn_noise_overlap": float}
    metric_descriptions = {
        "nn_isolation": "Nearest neighbor isolation metric based on PCA space.",
        "nn_noise_overlap": "Nearest neighbor noise overlap metric based on PCA space.",
    }
    depend_on = ["principal_components", "waveforms", "templates"]
    needs_tmp_data = True
    needs_job_kwargs = True
    deprecated_names = ["nn_isolation", "nn_noise_overlap"]
```

Registered metric function (verbatim):

```python
def _nn_advanced_metric_function(sorting_analyzer, unit_ids, tmp_data, job_kwargs, **metric_params):
```

Uses `n_jobs`/`mp_context` from job_kwargs for parallelism (but falls back to `n_jobs=1` for in-memory analyzers). Legacy `peak_sign` param is stripped on load.

Underlying low-level functions (signatures verbatim):

```python
def nearest_neighbors_isolation(
    sorting_analyzer,
    this_unit_id: int | str,
    n_spikes_all_units: dict = None,
    fr_all_units: dict = None,
    max_spikes: int = 1000,
    min_spikes: int = 10,
    min_fr: float = 0.0,
    n_neighbors: int = 5,
    n_components: int = 10,
    radius_um: float = 100,
    min_spatial_overlap: float = 0.5,
    seed=None,
):
```

```python
def nearest_neighbors_noise_overlap(
    sorting_analyzer,
    this_unit_id: int | str,
    n_spikes_all_units: dict = None,
    fr_all_units: dict = None,
    max_spikes: int = 1000,
    min_spikes: int = 10,
    min_fr: float = 0.0,
    n_neighbors: int = 5,
    n_components: int = 10,
    radius_um: float = 100,
    seed=None,
):
```

Notes:
- `nn_isolation` (Chung): min over other units of the pairwise "isolation score" between the target unit and each other unit in a common PC subspace. `1 = perfectly isolated`.
- `nn_noise_overlap` (Chung): builds a noise cluster from random voltage snippets, subtracts each snippet's projection onto a weighted noise waveform, and returns `1 - isolation(target, noise)`.
- The templates extension must be computed with `operator="median"` for `nn_noise_overlap`; a warning is emitted otherwise.
- The parameter split inside `_nn_advanced_one_unit`:
  - `nn_isolation_params` = keys in `{"max_spikes", "min_spikes", "min_fr", "n_neighbors", "n_components", "radius_um", "min_spatial_overlap"}`.
  - `nn_noise_params` = keys in `{"max_spikes", "min_spikes", "min_fr", "n_neighbors", "n_components", "radius_um"}` (note: `min_spatial_overlap` is *not* passed to noise overlap).

Requires `principal_components`, `waveforms`, and `templates` extensions.

---

