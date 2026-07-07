# networks module reference

Module path: `netneurotools.networks`

## Table of Contents

- [Consensus Functions](#consensus-functions)
  - [func_consensus](#func_consensus)
  - [struct_consensus](#struct_consensus)
- [Randomization Functions](#randomization-functions)
  - [randmio_und](#randmio_und)
  - [match_length_degree_distribution](#match_length_degree_distribution)
  - [strength_preserving_rand_sa](#strength_preserving_rand_sa)
  - [strength_preserving_rand_sa_mse_opt](#strength_preserving_rand_sa_mse_opt)
  - [strength_preserving_rand_sa_dir](#strength_preserving_rand_sa_dir)
- [Network Utilities](#network-utilities)
  - [get_triu](#get_triu)
  - [binarize_network](#binarize_network)
  - [threshold_network](#threshold_network)

---

## Consensus Functions

### func_consensus

```python
func_consensus(data, n_boot=1000, ci=95, seed=None)
```

Calculate thresholded group consensus functional connectivity graph. Concatenates all time series, computes a group correlation matrix, generates bootstrapped samples, and retains only correlations whose sign is consistent across bootstrap confidence intervals. Inconsistent correlations are set to zero.

If `n_boot` is set to 0 or None, a simple group-averaged (mean) functional connectivity matrix is returned instead of performing bootstrapping.

**Parameters:**
- `data` : (N, T, S) array_like, or a list of S arrays each shaped (N, T) -- Pre-processed functional time series. N = number of nodes, T = number of volumes, S = number of subjects.
- `n_boot` : int, optional -- Number of bootstraps for generating correlation. Default: 1000. Set to 0 or None to skip bootstrapping and return a simple group average.
- `ci` : float, optional -- Confidence interval for assessing reliability of correlations. Must be in the range (0, 100). Default: 95.
- `seed` : int, optional -- Random seed. Default: None.

**Returns:**
- `consensus` : (N, N) numpy.ndarray -- Thresholded, group-level correlation matrix.

**Key logic:** Bootstrap CIs are computed via `np.percentile`. If the signs of the lower and upper CI bounds differ (i.e., the CI crosses zero), the correlation is set to zero in the consensus matrix.

---

### struct_consensus

```python
struct_consensus(data, distance, hemiid, conn_num_inter=None, conn_num_intra=None, weighted=False)
```

Calculate distance-dependent group consensus structural connectivity graph. Estimates the average edge length distribution and builds a group-averaged connectivity matrix that approximates this distribution with density equal to the mean density across subjects. The algorithm works separately on inter- and intra-hemispheric connections.

Algorithm:
1. Estimate the cumulative edge length distribution.
2. Divide the distribution into M length bins (one per edge to be added).
3. Within each bin, select the edge most consistently expressed across subjects, breaking ties by average edge weight.

**Parameters:**
- `data` : (N, N, S) array_like -- Weighted connectivity matrices (e.g., fractional anisotropy). N = nodes, S = subjects. Must be weighted with continuous weights.
- `distance` : (N, N) array_like -- Pairwise Euclidean distance matrix where distance[i, j] is the distance between nodes i and j.
- `hemiid` : (N, 1) array_like -- Hemisphere designation for N nodes. 0 = right hemisphere, 1 = left hemisphere. Must be a 2D array (reshape with `array.reshape(-1, 1)` if needed).
- `conn_num_inter` : int, optional -- Number of inter-hemispheric connections to include. If None, estimated from the data. Default: None.
- `conn_num_intra` : int, optional -- Number of intra-hemispheric connections to include. If None, estimated from the data. Default: None.
- `weighted` : bool, optional -- If True, return a mean-weighted consensus matrix (binary consensus multiplied by `np.mean(data, axis=2)`). If False, return a binary matrix. Default: False.

**Returns:**
- `consensus` : (N, N) numpy.ndarray -- Binary (default) or mean-weighted group-level connectivity matrix.

---

## Randomization Functions

### randmio_und

```python
randmio_und(W, itr)
```

Randomize an undirected network while preserving the degree distribution. Does not preserve the strength distribution in weighted networks. Significantly faster when numba is available (compiled with `@njit`).

**Parameters:**
- `W` : (N, N) array-like -- Undirected binary/weighted connection matrix.
- `itr` : int -- Rewiring parameter. Each edge is rewired approximately `itr` times.

**Returns:**
- `W` : (N, N) array-like -- Randomized network.
- `eff` : int -- Number of actual rewirings carried out.

**Note:** This is an optimized reimplementation. If numba is installed, the function is JIT-compiled. Uses `np.random.randint` internally (not seeded via a `seed` parameter -- uses global numpy random state).

---

### match_length_degree_distribution

```python
match_length_degree_distribution(W, D, nbins=10, nswap=1000, replacement=False, weighted=True, seed=None)
```

Generate degree- and edge length-preserving surrogate connectomes. Takes a weighted symmetric connectivity matrix and a distance matrix, and produces a randomized network with: (1) exactly the same degree sequence, (2) approximately the same edge length distribution, (3) exactly the same edge weight distribution, (4) approximately the same weight-length relationship.

**Parameters:**
- `W` : (N, N) array-like -- Weighted or binary symmetric connectivity matrix.
- `D` : (N, N) array-like -- Symmetric distance matrix.
- `nbins` : int, optional -- Number of distance bins. Edge swapping is performed within the same bin. Default: 10.
- `nswap` : int, optional -- Total number of edge swaps to perform. Recommended: nnodes * 20. Default: 1000.
- `replacement` : bool, optional -- If True, all edges remain available for swapping after being rewired. If False, rewired edges are removed from the candidate pool. Default: False.
- `weighted` : bool, optional -- If True, return a weighted matrix with weights reassigned by sorted distance. If False, the weighted return matrix is all zeros. Default: True.
- `seed` : float, optional -- Random seed. Default: None.

**Returns:**
- `newB` : (N, N) array-like -- Binary rewired matrix.
- `newW` : (N, N) array-like -- Weighted rewired matrix. Returns matrix of zeros if `weighted=False`.
- `nr` : int -- Number of successful rewires.

**Key logic for weight reassignment:** Original weights are sorted by edge distance (shortest to longest). New edges are also sorted by distance. The sorted original weights are then assigned to the sorted new edges, preserving the weight-length relationship.

---

### strength_preserving_rand_sa

```python
strength_preserving_rand_sa(A, rewiring_iter=10, nstage=100, niter=10000, temp=1000, frac=0.5, energy_type="sse", energy_func=None, R=None, connected=None, verbose=False, seed=None)
```

Randomize an undirected weighted network while preserving degree and strength sequences using simulated annealing. Allows flexible choice of energy function. Uses Maslov & Sneppen rewiring to produce a surrogate with the same size, density, and degree sequence, then permutes weights to optimize the strength sequence match.

**Parameters:**
- `A` : (N, N) array-like -- Undirected weighted connectivity matrix.
- `rewiring_iter` : int, optional -- Each edge is rewired approximately this many times during initial Maslov & Sneppen rewiring. Default: 10.
- `nstage` : int, optional -- Number of annealing stages. Default: 100.
- `niter` : int, optional -- Number of iterations per stage. Default: 10000.
- `temp` : float, optional -- Initial temperature. Default: 1000.
- `frac` : float, optional -- Fractional decrease in temperature per stage. Must be in (0, 1]. Default: 0.5.
- `energy_type` : str, optional -- Energy function to minimize. Options: `"sse"` (sum of squared errors), `"max"` (maximum absolute error), `"mae"` (mean absolute error), `"mse"` (mean squared error), `"rmse"` (root mean squared error). Default: `"sse"`.
- `energy_func` : callable, optional -- Custom callable with two positional arguments (two strength sequence numpy arrays) that returns an energy value. Overwrites `energy_type` when provided. Default: None.
- `R` : (N, N) array-like, optional -- Pre-randomized connectivity matrix. If None, one is generated via Maslov & Sneppen. Default: None.
- `connected` : bool, optional -- Whether to ensure connectedness of the randomized network. If None, inferred from data (True if A has one component, False otherwise). Default: None.
- `verbose` : bool, optional -- Whether to print status at the end of every stage. Default: False.
- `seed` : float, optional -- Random seed. Default: None.

**Returns:**
- `B` : (N, N) array-like -- Randomized connectivity matrix.
- `min_energy` : float -- Minimum energy obtained by annealing.

**Acceptance criterion:** A weight swap is accepted if it lowers the energy, or with probability `exp(-(energy_prime - energy) / temp)`.

---

### strength_preserving_rand_sa_mse_opt

```python
strength_preserving_rand_sa_mse_opt(A, rewiring_iter=10, nstage=100, niter=10000, temp=1000, frac=0.5, R=None, connected=None, verbose=False, seed=None)
```

Speed-optimized version of strength-preserving randomization that only supports the mean squared error (MSE) energy function. Uses an analytical delta-energy formula instead of recomputing the full energy each iteration, making it significantly faster than `strength_preserving_rand_sa` with `energy_type="mse"`.

**Parameters:**
- `A` : (N, N) array-like -- Undirected weighted connectivity matrix.
- `rewiring_iter` : int, optional -- Each edge is rewired approximately this many times during initial Maslov & Sneppen rewiring. Default: 10.
- `nstage` : int, optional -- Number of annealing stages. Default: 100.
- `niter` : int, optional -- Number of iterations per stage. Default: 10000.
- `temp` : float, optional -- Initial temperature. Default: 1000.
- `frac` : float, optional -- Fractional decrease in temperature per stage. Must be in (0, 1]. Default: 0.5.
- `R` : (N, N) array-like, optional -- Pre-randomized connectivity matrix. If None, one is generated via Maslov & Sneppen. Default: None.
- `connected` : bool, optional -- Whether to ensure connectedness of the randomized network. If None, inferred from data. Default: None.
- `verbose` : bool, optional -- Whether to print status at the end of every stage. Default: False.
- `seed` : float, optional -- Random seed. Default: None.

**Returns:**
- `B` : (N, N) array-like -- Randomized connectivity matrix.
- `min_energy` : float -- Minimum energy obtained by annealing.

**Key optimization (delta-energy formula):**
```python
delta_energy = (2 * wts_change * (2 * wts_change + (s[a] - sb[a]) + (s[b] - sb[b]) - (s[c] - sb[c]) - (s[d] - sb[d]))) / n
```
This avoids recomputing `np.mean((s - sb)**2)` at every iteration.

---

### strength_preserving_rand_sa_dir

```python
strength_preserving_rand_sa_dir(A, rewiring_iter=10, nstage=100, niter=10000, temp=1000, frac=0.5, energy_type="sse", energy_func=None, connected=True, verbose=False, seed=None)
```

Randomize a **directed** weighted network while preserving in-degree, out-degree, in-strength, and out-strength sequences using simulated annealing. Energy is computed as the sum of in-strength energy and out-strength energy.

**Parameters:**
- `A` : (N, N) array-like -- Directed weighted connectivity matrix.
- `rewiring_iter` : int, optional -- Each edge is rewired approximately this many times during initial Maslov & Sneppen rewiring. Default: 10.
- `nstage` : int, optional -- Number of annealing stages. Default: 100.
- `niter` : int, optional -- Number of iterations per stage. Default: 10000.
- `temp` : float, optional -- Initial temperature. Default: 1000.
- `frac` : float, optional -- Fractional decrease in temperature per stage. Must be in (0, 1]. Default: 0.5.
- `energy_type` : str, optional -- Energy function to minimize. Options: `"sse"` (sum of squared errors), `"max"` (maximum absolute error), `"mae"` (mean absolute error), `"mse"` (mean squared error), `"rmse"` (root mean squared error). Default: `"sse"`.
- `energy_func` : callable, optional -- Custom callable with two positional arguments (two strength sequence numpy arrays) that returns an energy value. Overwrites `energy_type` when provided. For directed networks, it is called separately for in-strengths and out-strengths and results are summed. Default: None.
- `connected` : bool, optional -- Whether to ensure connectedness of the randomized network. Default: True. (Note: unlike the undirected version, this defaults to True rather than None.)
- `verbose` : bool, optional -- Whether to print status at the end of every stage. Default: False.
- `seed` : float, optional -- Random seed. Default: None.

**Returns:**
- `B` : (N, N) array-like -- Randomized connectivity matrix (not symmetrized, since it is directed).
- `min_energy` : float -- Minimum energy obtained by annealing.

**Key difference from undirected version:** Uses `bct.randmio_dir` / `bct.randmio_dir_connected` for initial rewiring. Does not accept an `R` parameter -- always generates the initial randomization internally. The output matrix B is not symmetrized (`B = B + B.T` is NOT called), preserving directionality.

---

## Network Utilities

### get_triu

```python
get_triu(data, k=1)
```

Return the vectorized upper triangle from a square matrix.

**Parameters:**
- `data` : (N, N) array_like -- Input square matrix.
- `k` : int, optional -- Which diagonal to select from (0 = primary diagonal). Default: 1.

**Returns:**
- `triu` : (N*(N-1)/2,) numpy.ndarray -- Flattened upper triangle of `data`.

**Example:**
```python
X = np.array([[1, 0.5, 0.25], [0.5, 1, 0.33], [0.25, 0.33, 1]])
networks.get_triu(X)  # array([0.5 , 0.25, 0.33])
```

---

### binarize_network

```python
binarize_network(network, retain=10, keep_diag=False)
```

Keep the top `retain`% of connections in the network and binarize. Uses the upper triangle for determining the connection threshold, which may result in disconnected nodes. For connected results, use `threshold_network` instead.

**Parameters:**
- `network` : (N, N) array_like -- Input graph.
- `retain` : float, optional -- Percent of connections to retain. Must be in [0, 100]. Default: 10.
- `keep_diag` : bool, optional -- Whether to keep the diagonal values. If False, diagonal is set to 0. Default: False.

**Returns:**
- `binarized` : (N, N) numpy.ndarray -- Binarized, thresholded graph.

**Key logic:** Computes `thresh = np.percentile(get_triu(network), 100 - retain)`, then sets all entries above that threshold to 1 and others to 0.

---

### threshold_network

```python
threshold_network(network, retain=10)
```

Keep the top `retain`% of connections in the network and binarize, using a minimum spanning tree to ensure no nodes become disconnected.

**Parameters:**
- `network` : (N, N) array_like -- Input graph.
- `retain` : float, optional -- Percent of connections to retain. Must be in [0, 100]. Default: 10.

**Returns:**
- `thresholded` : (N, N) numpy.ndarray -- Binarized, thresholded graph guaranteed to be connected.

**Key logic:** Computes a minimum spanning tree (MST) first via `scipy.sparse.csgraph.minimum_spanning_tree` on inverted weights, then adds the strongest remaining edges until the target density is reached. Raises `ValueError` if the MST alone has more edges than the target density allows.
