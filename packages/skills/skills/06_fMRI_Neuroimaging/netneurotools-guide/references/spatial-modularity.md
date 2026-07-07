# Spatial Statistics and Modularity Analysis Reference

## Table of Contents
- [Spatial Statistics](#spatial-statistics): [morans_i](#morans_i) | [local_morans_i](#local_morans_i) | [gearys_c](#gearys_c) | [local_gearys_c](#local_gearys_c) | [lees_l](#lees_l) | [local_lees_l](#local_lees_l)
- [Modularity Analysis](#modularity-analysis): [match_cluster_labels](#match_cluster_labels) | [match_assignments](#match_assignments) | [reorder_assignments](#reorder_assignments) | [agreement_matrix](#agreement_matrix) | [consensus_clustering](#consensus_clustering) | [find_consensus](#find_consensus) | [consensus_modularity](#consensus_modularity) | [zrand](#zrand) | [_zrand_partitions](#_zrand_partitions) | [get_modularity](#get_modularity) | [get_modularity_z](#get_modularity_z) | [get_modularity_sig](#get_modularity_sig)

---

## Spatial Statistics

Module: `netneurotools.spatial.spatial_stats`. All functions raise `ValueError` when `use_numba=True` but numba is not installed.

### morans_i
```python
morans_i(annot, weight, use_numba=has_numba)
```
Calculate Moran's I for spatial autocorrelation.

**Formula:** `I = (n / sum(w_ij)) * (sum(w_ij * (x_i - x_bar)(x_j - x_bar)) / sum((x_i - x_bar)^2))`

**Parameters:**
- `annot` (array-like, shape `(n,)`): Annotation values.
- `weight` (array-like, shape `(n, n)`): Spatial weight matrix. No check for symmetry or zero-diagonal.
- `use_numba` (bool, optional): Use numba acceleration. Default: `True` if numba installed.

**Returns:** `float` -- Moran's I value.

### local_morans_i
```python
local_morans_i(annot, weight, use_sampvar=True)
```
Calculate local Moran's I for spatial autocorrelation.

**Formula:** `I_i = ((x_i - x_bar) / (sum((x_k - x_bar)^2) / (n-1))) * sum(w_ij * (x_j - x_bar))`. When `use_sampvar=False`, denominator divisor is `n` instead of `n-1`.

**Parameters:**
- `annot` (array-like, shape `(n,)`): Annotation values.
- `weight` (array-like, shape `(n, n)`): Spatial weight matrix. No check for symmetry or zero-diagonal.
- `use_sampvar` (bool, optional): Use sample variance `(n-1)`. Default: `True`.

**Returns:** `ndarray`, shape `(n,)` -- Local Moran's I values.

### gearys_c
```python
gearys_c(annot, weight, use_numba=has_numba)
```
Calculate Geary's C for spatial autocorrelation.

**Formula:** `C = ((n-1) / (2 * sum(w_ij))) * (sum(w_ij * (x_i - x_j)^2) / sum((x_i - x_bar)^2))`

**Parameters:**
- `annot` (array-like, shape `(n,)`): Annotation values.
- `weight` (array-like, shape `(n, n)`): Spatial weight matrix. No check for symmetry or zero-diagonal.
- `use_numba` (bool, optional): Use numba acceleration. Default: `True` if numba installed.

**Returns:** `float` -- Geary's C value.

### local_gearys_c
```python
local_gearys_c(annot, weight, use_sampvar=True)
```
Calculate local Geary's C for spatial autocorrelation.

**Formula:** `C_i = sum(w_ij * (x_i - x_j)^2) / m_2` where `m_2 = sum((x_k - x_bar)^2) / (n-1)` (or `/n` when `use_sampvar=False`).

**Parameters:**
- `annot` (array-like, shape `(n,)`): Annotation values.
- `weight` (array-like, shape `(n, n)`): Spatial weight matrix. No check for symmetry or zero-diagonal.
- `use_sampvar` (bool, optional): Use sample variance `(n-1)`. Default: `True`.

**Returns:** `ndarray`, shape `(n,)` -- Local Geary's C values.

### lees_l
```python
lees_l(annot_1, annot_2, weight, use_numba=has_numba)
```
Calculate Lee's L for bivariate spatial autocorrelation.

**Formula:** `L(x,y) = (n / S2) * sum((W @ x_demean) * (W @ y_demean)) / (sqrt(sum(x_demean^2)) * sqrt(sum(y_demean^2)))` where `S2 = sum(row_sums(w)^2)`.

**Parameters:**
- `annot_1` (array-like, shape `(n,)`): First annotation array.
- `annot_2` (array-like, shape `(n,)`): Second annotation array.
- `weight` (array-like, shape `(n, n)`): Spatial weight matrix. No check for symmetry or zero-diagonal.
- `use_numba` (bool, optional): Use numba acceleration. Default: `True` if numba installed.

**Returns:** `float` -- Lee's L value.

### local_lees_l
```python
local_lees_l(annot_1, annot_2, weight)
```
Calculate local Lee's L for bivariate spatial autocorrelation.

**Formula:** `L_i(x,y) = n * (sum_j(w_ij * x_demean_j) * sum_j(w_ij * y_demean_j)) / (sqrt(sum(x_demean^2)) * sqrt(sum(y_demean^2)))`

**Parameters:**
- `annot_1` (array-like, shape `(n,)`): First annotation array.
- `annot_2` (array-like, shape `(n,)`): Second annotation array.
- `weight` (array-like, shape `(n, n)`): Spatial weight matrix. No check for symmetry or zero-diagonal.

**Returns:** `ndarray`, shape `(n,)` -- Local Lee's L values.

---

## Modularity Analysis

Module: `netneurotools.modularity.modules`. Depends on `bct`, `numpy`, `scipy.optimize`, `scipy.cluster.hierarchy`, `sklearn.utils.validation.check_random_state`.

### match_cluster_labels
```python
match_cluster_labels(source, target)
```
Align cluster labels in `source` to `target` using `scipy.optimize.linear_sum_assignment`. If `source` has fewer clusters than `target`, returned assignments may be discontinuous.

**Parameters:**
- `source` ((N,) array_like): Cluster labels to be re-labelled.
- `target` ((N,) array_like): Cluster labels to which `source` is mapped.

**Returns:** `(N,) array_like` -- Re-labelled `source` matched to `target`.

### match_assignments
```python
match_assignments(assignments, target=None, seed=None)
```
Re-label clusters in all columns of `assignments` to best match `target` by applying `match_cluster_labels` to each column.

**Parameters:**
- `assignments` ((N, M) array_like): `M` clustering assignments for `N` subjects.
- `target` ((N,) array_like, int, or None, optional): Target assignments. `int` selects that column. `None` picks a random column with the lowest cluster count. Default: `None`.
- `seed` (int, np.random.RandomState, or None, optional): RNG seed; only used if `target=None`. Default: `None`.

**Returns:** `(N, M) numpy.ndarray` -- Re-labeled cluster solutions.

**Raises:** `ValueError` if `target` array length does not match `assignments`.

### reorder_assignments
```python
reorder_assignments(assignments, consensus=None, col_sort=True,
                    row_sort=True, return_index=True, seed=None)
```
Relabel and reorder rows/columns for visualization. Uses hierarchical clustering (average linkage, Hamming distance) to group similar solutions (columns) and similar subjects (rows).

**Parameters:**
- `assignments` ((N, M) array_like): `M` clustering assignments for `N` subjects.
- `consensus` ((N,) array_like or None, optional): If provided, row reordering is constrained by this clustering. Default: `None`.
- `col_sort` (bool, optional): Sort columns. Default: `True`.
- `row_sort` (bool, optional): Sort rows. Default: `True`.
- `return_index` (bool, optional): Return reordering indices. Default: `True`.
- `seed` (int, np.random.RandomState, or None, optional): RNG seed. Default: `None`.

**Returns:**
- `reordered` ((N, M) numpy.ndarray): Re-ordered matrix.
- `index` (tuple): `np.ix_(row_idx, col_idx)` indices (only when `return_index=True`).

### agreement_matrix
```python
agreement_matrix(assignments)
```
Compute co-assignment counts across all `M` clustering solutions. Diagonal is set to zero.

**Parameters:**
- `assignments` ((N, M) array_like): Integer cluster assignment labels.

**Returns:** `(N, N) numpy.ndarray` (dtype `int32`) -- Agreement matrix with zero diagonal.

### consensus_clustering
```python
consensus_clustering(agreement, threshold, n_it=10)
```
Iteratively threshold the agreement matrix and apply `bct.community_louvain` until a single unique partition is found or no supra-threshold agreement remains. Based on Lancichinetti & Fortunato (2012).

**Parameters:**
- `agreement` ((N, N) array_like): Agreement matrix of co-assignment frequencies.
- `threshold` (float): Entries below this value are zeroed out.
- `n_it` (int, optional): Louvain iterations per consensus step. Default: `10`.

**Returns:** `(N,) numpy.ndarray` -- Consensus cluster labels (1-indexed).

### find_consensus
```python
find_consensus(assignments, null_func=np.mean, return_agreement=False, seed=None)
```
Build agreement matrix from `assignments`, generate null model by permuting columns, threshold with `null_func`, then run `consensus_clustering`.

**Parameters:**
- `assignments` ((N, M) array_like): Integer cluster assignment labels.
- `null_func` (callable, optional): Accepts 2D array, returns scalar threshold. Default: `numpy.mean`.
- `return_agreement` (bool, optional): Also return thresholded agreement matrix. Default: `False`.
- `seed` (int, np.random.RandomState, or None, optional): RNG seed for null model permutations. Default: `None`.

**Returns:**
- `consensus` ((N,) numpy.ndarray): Consensus cluster labels (int).
- `agreement` ((N, N) numpy.ndarray): Thresholded agreement (only when `return_agreement=True`).

### consensus_modularity
```python
consensus_modularity(adjacency, gamma=1, B='modularity', repeats=250, null_func=np.mean, seed=None)
```
Run `bct.community_louvain` `repeats` times, then apply `find_consensus`.

**Parameters:**
- `adjacency` ((N, N) array_like): Adjacency matrix (weighted or unweighted).
- `gamma` (float, optional): Resolution parameter. Default: `1`.
- `B` (str or (N, N) array_like, optional): Null model. String values: `'modularity'`, `'potts'`, `'negative_sym'`, `'negative_asym'`. Default: `'modularity'`.
- `repeats` (int, optional): Number of Louvain iterations. Default: `250`.
- `null_func` (callable, optional): Accepts 2D array, returns scalar. Default: `numpy.mean`.
- `seed` (int, np.random.RandomState, or None, optional): RNG seed. Default: `None`.

**Returns:**
- `consensus` ((N,) numpy.ndarray): Community assignments.
- `Q_all` (array_like): Modularity values from all `repeats` runs.
- `zrand_all` (array_like): z-Rand scores for all pairs of partitions.

### zrand
```python
zrand(X, Y)
```
Calculate the z-Rand index comparing two community assignments. Communities are relabeled to consecutive integers. Returns `0` if computed variance is negative. Ref: Traud, Kelsic, Mucha & Porter (2011), SIAM Review, 53, 526-543.

**Parameters:**
- `X` ((n, 1) array_like): First community assignment vector.
- `Y` ((n, 1) array_like): Second community assignment vector.

**Returns:** `float` -- z-Rand index.

**Raises:** `ValueError` if inputs are multi-dimensional, have different lengths, or contain fewer than 2 distinct communities.

**Core logic:**
```python
nij = np.bincount(X * ky + Y, minlength=kx * ky).reshape(kx, ky)
M = n * (n - 1) // 2
M1, M2 = np.sum(ni * (ni - 1)) / 2, np.sum(nj * (nj - 1)) / 2
wab = np.sum(nij * (nij - 1)) / 2
z_rand = (wab - ((M1 * M2) / M)) / np.sqrt(sigw2)
```

### _zrand_partitions
```python
_zrand_partitions(communities)
```
Calculate z-Rand for all pairs of community assignment vectors in `communities`. Iterates through every unique pair of columns and calls `zrand`.

**Parameters:**
- `communities` ((S, R) array_like): Community assignments for `S` samples over `R` partitions.

**Returns:** `array_like` -- z-Rand scores for all pairs of `R` partitions. Length is `R*(R-1)/2`.

### get_modularity
```python
get_modularity(adjacency, comm, gamma=1)
```
Calculate per-community modularity contributions: `B = adjacency - gamma * outer(k_out, k_in) / s`, then `comm_q[i] = B[community_i, community_i].sum() / s`.

**Parameters:**
- `adjacency` ((N, N) array_like): Adjacency (e.g., correlation) matrix.
- `comm` ((N,) array_like): Community assignments splitting `N` subjects into `G` groups.
- `gamma` (float, optional): Resolution parameter. Default: `1`.

**Returns:** `(G,) ndarray` -- Relative modularity per community.

### get_modularity_z
```python
get_modularity_z(adjacency, comm, gamma=1, n_perm=10000, seed=None)
```
Average z-score of community modularity by permutation. If any community's null std is zero, returns mean difference instead of z-scores.

**Parameters:**
- `adjacency` ((N, N) array_like): Adjacency matrix.
- `comm` ((N,) array_like): Community assignments for `G` groups.
- `gamma` (float, optional): Resolution parameter. Default: `1`.
- `n_perm` (int, optional): Number of permutations. Default: `10000`.
- `seed` (int, np.random.RandomState, or None, optional): RNG seed. Default: `None`.

**Returns:** `float` -- Average z-score of modularity across communities.

### get_modularity_sig
```python
get_modularity_sig(adjacency, comm, gamma=1, n_perm=10000, alpha=0.01, seed=None)
```
Test significance of community modularity by permutation. `True` if real modularity exceeds `100*(1-alpha)` percentile of the null.

**Parameters:**
- `adjacency` ((N, N) array_like): Adjacency matrix.
- `comm` ((N,) array_like): Community assignment vector.
- `gamma` (float, optional): Resolution parameter. Default: `1`.
- `n_perm` (int, optional): Number of permutations. Default: `10000`.
- `alpha` (float, optional): Significance level, range `(0, 1)`. Default: `0.01`.
- `seed` (int, np.random.RandomState, or None, optional): RNG seed. Default: `None`.

**Returns:** `ndarray` (boolean) -- Per-community significance.
