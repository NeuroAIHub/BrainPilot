# metrics module reference

## Table of Contents

- [Degree and Distance](#degree-and-distance): degrees_und, degrees_dir, distance_wei_floyd, retrieve_shortest_path
- [Navigation](#navigation): navigation_wu, get_navigation_path_length
- [Communication Metrics](#communication-metrics): communicability_bin, communicability_wei, path_transitivity, search_information
- [Diffusion and Flow](#diffusion-and-flow): mean_first_passage_time, diffusion_efficiency, resource_efficiency_bin, flow_graph
- [Network Properties](#network-properties): assortativity_und, assortativity_dir, matching_ind_und, rich_feeder_peripheral
- [Statistical Network Metrics](#statistical-network-metrics): network_pearsonr, network_pearsonr_pairwise, effective_resistance, network_polarisation, network_variance, network_covariance
- [Spreading Dynamics](#spreading-dynamics): simulate_atrophy
- [Utilities](#utilities): _fast_binarize, _graph_laplacian

## Degree and Distance

### `degrees_und(W)`
Compute the degree of each node in an undirected network. Weighted arrays are binarized first. Directedness is ignored (row sum taken).
- `W`: (N, N) array_like -- unweighted, undirected connection weight array
- Returns `deg`: (N,) numpy.ndarray -- degree of each node
- Implementation: `np.sum(_fast_binarize(W), axis=0)`

### `degrees_dir(W)`
Compute in-degree, out-degree, and total degree for a directed network. Weighted arrays are binarized first.
- `W`: (N, N) array_like -- unweighted, directed connection weight array
- Returns tuple of three (N,) numpy.ndarray:
  - `deg_in`: in-degree (column sum)
  - `deg_out`: out-degree (row sum)
  - `deg`: total degree (in-degree + out-degree)

### `distance_wei_floyd(D)`
Compute all-pairs shortest path length using Floyd-Warshall (via `scipy.sparse.csgraph.shortest_path`). Weight-to-distance transform must be applied beforehand.
- `D`: (N, N) array_like -- connection length/distance matrix
- Returns tuple:
  - `spl_mat`: (N, N) array_like -- shortest path length matrix
  - `p_mat`: (N, N) array_like -- predecessor matrix (for use with `retrieve_shortest_path`)

### `retrieve_shortest_path(s, t, p_mat)`
Return the shortest path between two nodes using the predecessor matrix from `distance_wei_floyd`. JIT-compiled with numba when available.
- `s`: int -- source node index
- `t`: int -- target node index
- `p_mat`: (N, N) array_like -- predecessor matrix from `distance_wei_floyd`
- Returns `path`: list of int -- ordered node indices from s to t. Returns `[-1]` if no path exists.
- Key logic: walks backwards through `p_mat` using `p_mat[s, t]`; returns `[-1]` when `p_mat[s, t] == -9999`.

## Navigation

### `navigation_wu(nav_dist_mat, sc_mat)`
Compute greedy network navigation. At each step, the walker moves to the neighbor closest to the target in `nav_dist_mat`. Fails (infinite distance) if a loop is detected.
- `nav_dist_mat`: (N, N) array_like -- connection length/distance matrix (typically Euclidean distance)
- `sc_mat`: (N, N) array_like -- structural connectivity matrix (used for determining neighbors)
- Returns tuple of five values:
  - `nav_sr`: float -- overall navigation success rate (fraction of pairs with finite path)
  - `nav_sr_node`: list of float -- per-node navigation success rate
  - `nav_path_len`: (N, N) array_like -- navigation path length (inf if failed)
  - `nav_path_hop`: (N, N) array_like -- navigation path hops (inf if failed)
  - `nav_paths`: list of tuples -- each tuple is (source, target, distance, hops, path)

### `get_navigation_path_length(nav_paths, alt_dist_mat)`
Recompute navigation path lengths using an alternative distance metric. The paths themselves come from `navigation_wu`.
- `nav_paths`: list -- the `nav_paths` output from `navigation_wu`
- `alt_dist_mat`: (N, N) array_like -- alternative distance matrix (e.g., geodesic distance or strength-to-length remapping)
- Returns `nav_path_len`: (N, N) array_like -- path lengths in the alternative metric (inf where navigation failed)

## Communication Metrics

### `communicability_bin(adjacency, normalize=False)`
Compute communicability for a binary (unweighted) network as the matrix exponential of the adjacency matrix. Raises ValueError if the matrix is not binary.
- `adjacency`: (N, N) array_like -- unweighted connection matrix (values must be 0 or 1)
- `normalize`: bool, optional, default=False -- if True, divides adjacency by its largest eigenvalue before exponentiation
- Returns `comm`: (N, N) numpy.ndarray -- communicability matrix (via `scipy.sparse.linalg.expm`)

### `communicability_wei(adjacency)`
Compute communicability for a weighted network using degree-normalized matrix exponential (Crofts & Higham, 2009). Diagonal is zeroed.
- `adjacency`: (N, N) array_like -- weighted connection matrix
- Returns `cmc`: (N, N) numpy.ndarray -- communicability matrix with zeroed diagonal
- Key logic: `D^{-1/2} @ W @ D^{-1/2}` then matrix exponential, where D is the diagonal degree matrix.

### `path_transitivity(D)`
Calculate path transitivity -- the density of local detours (triangles) along shortest paths between all node pairs. Adapted from the Brain Connectivity Toolbox.
- `D`: (N, N) ndarray -- weight or connection length matrix (length transform should be applied beforehand)
- Returns `T_mat`: (N, N) ndarray -- symmetric path transitivity matrix
- Internally calls `distance_wei_floyd` and `retrieve_shortest_path`.

### `search_information(W, D, has_memory=False)`
Calculate search information -- the bits of information a random walker needs to follow shortest paths. Adapted from the Brain Connectivity Toolbox. Not guaranteed symmetric even for symmetric input.
- `W`: (N, N) ndarray -- connection weight matrix (used to build transition matrix T = W / rowsum(W))
- `D`: (N, N) ndarray -- connection length/distance matrix (weight-to-distance transform applied beforehand)
- `has_memory`: bool, optional, default=False -- whether the random walker has memory (adjusts transition probabilities by removing backtracking)
- Returns `SI`: (N, N) ndarray -- search information matrix. Diagonal set to NaN; unreachable pairs set to inf.

## Diffusion and Flow

### `mean_first_passage_time(W, tol=1e-3)`
Calculate mean first passage time -- the expected steps for a random walker from node i to first reach node j. Result is asymmetric.
- `W`: (N, N) ndarray -- connection weight matrix
- `tol`: float, optional, default=1e-3 -- tolerance for finding eigenvalue of 1 in the transition matrix
- Returns `mfpt`: (N, N) ndarray -- pairwise mean first passage time matrix
- Raises ValueError if no eigenvalue within `tol` of 1 is found.

### `diffusion_efficiency(W)`
Calculate global and pairwise diffusion efficiency as the inverse of mean first passage time.
- `W`: (N, N) ndarray -- connection weight matrix
- Returns tuple:
  - `GE_diff`: float -- global diffusion efficiency = sum(1/mfpt) / (n*(n-1))
  - `E_diff`: (N, N) ndarray -- pairwise diffusion efficiency (diagonal zeroed)

### `resource_efficiency_bin(W_bin, lambda_prob=0.5)`
Calculate resource efficiency and shortest-path probability for a binary undirected network. Resource efficiency is inversely proportional to resources needed to ensure probability `lambda_prob` of arriving in exactly SPL steps.
- `W_bin`: (N, N) array_like -- binary (unweighted) undirected connection matrix (will be binarized internally)
- `lambda_prob`: float, optional, default=0.5 -- target probability of reaching the target node. Must satisfy 0 < lambda_prob < 1.
- Returns tuple:
  - `E_res`: (N, N) ndarray -- resource efficiency matrix (diagonal zeroed)
  - `prob_spl`: (N, N) ndarray -- shortest-path probability matrix (diagonal zeroed)
- Raises ValueError if `lambda_prob` is not in (0, 1).

### `flow_graph(W, r=None, t=1)`
Calculate flow graph for a continuous-time random walk. Waiting times at each node are Poisson-distributed with rate parameter r.
- `W`: (N, N) ndarray -- symmetric adjacency matrix
- `r`: (N,) or (N, 1) ndarray, optional, default=None -- rate parameter per node. If None, uses `np.ones((N, 1))`. 1D input is reshaped to column vector.
- `t`: int, optional, default=1 -- Markov time
- Returns `dyn`: (N, N) ndarray -- flow graph at time t, symmetrized as `(dyn + dyn.T) / 2`

## Network Properties

### `assortativity_und(x, W, use_numba=False)`
Calculate Bazinet's assortativity for annotated undirected networks. Measures tendency for connected nodes to have similar annotation values.
- `x`: (N,) array_like -- annotation values for each node
- `W`: (N, N) array_like -- weighted, undirected connection weight matrix
- `use_numba`: bool, optional, default=False -- use numba-accelerated version. Raises ValueError if numba unavailable.
- Returns `assortativity`: float -- weighted Pearson correlation of annotations across connected node pairs

### `assortativity_dir(x, W, use_numba=False)`
Calculate Bazinet's assortativity for annotated directed networks. Uses separate in-degree and out-degree weighted means and standard deviations.
- `x`: (N,) array_like -- annotation values for each node
- `W`: (N, N) array_like -- weighted, directed connection weight matrix
- `use_numba`: bool, optional, default=False -- use numba-accelerated version. Raises ValueError if numba unavailable.
- Returns `assortativity`: float

### `matching_ind_und(W)`
Calculate undirected matching index -- a measure of similarity between two nodes' connectivity profiles (excluding their mutual connection). Adapted from the Brain Connectivity Toolbox.
- `W`: (N, N) ndarray -- undirected connection matrix
- Returns `M0`: (N, N) ndarray -- matching index matrix. Diagonal is zero; NaN entries are set to 0.

### `rich_feeder_peripheral(x, sc, stat="median")`
Calculate connectivity values for rich, feeder, and peripheral edges across all degree thresholds.
- `x`: (N, N) numpy.ndarray -- symmetric correlation or connectivity matrix
- `sc`: (N, N) numpy.ndarray -- binary structural connectivity matrix
- `stat`: str, optional, default="median" -- statistic over link groups. Must be "mean" or "median".
- Returns tuple:
  - `rfp`: (3, k) numpy.ndarray -- row 0=rich, 1=feeder, 2=peripheral values per degree threshold. k = max degree in `sc`.
  - `pvals`: (3, k) numpy.ndarray -- one-sided Welch's t-test p-values. Rich vs non-rich; feeder vs peripheral; peripheral vs feeder.
- Raises ValueError if `stat` is not "mean" or "median".

## Statistical Network Metrics

### `network_pearsonr(annot1, annot2, weight, use_numba=has_numba)`
Calculate network-aware Pearson correlation between two annotation vectors, weighted by a network structure matrix. Annotations are demeaned internally.
- `annot1`: (N,) array_like -- first annotation vector
- `annot2`: (N,) array_like -- second annotation vector
- `weight`: (N, N) array_like -- weight matrix representing network structure. Diagonal elements should be 1. Typically `W = exp(-k*L)` where L is a length matrix.
- `use_numba`: bool, optional, default=True if numba available -- use numba-accelerated version
- Returns `corr`: float -- network correlation

### `network_pearsonr_pairwise(annot_mat, weight)`
Calculate pairwise network correlation between all rows of an annotation matrix. Faster batch version of `network_pearsonr`.
- `annot_mat`: (N, D) array_like -- input matrix where each row is a sample and columns are features
- `weight`: (D, D) array_like -- weight matrix. Diagonal elements should be 1.
- Returns `corr_mat`: (N, N) numpy.ndarray -- pairwise network correlation matrix
- Uses einsum or numba-accelerated cross outer product internally.

### `effective_resistance(W, directed=True)`
Calculate effective resistance matrix from the pseudoinverse of the graph Laplacian. Effective resistance is a distance measure between node pairs.
- `W`: (N, N) array_like -- weight matrix
- `directed`: bool, optional, default=True -- whether the graph is directed. When False, enables `hermitian=True` in `numpy.linalg.pinv` for better performance on symmetric matrices.
- Returns `R_eff`: (N, N) numpy.ndarray -- effective resistance matrix
- Key formula: `R_eff[i,j] = Q*[i,i] - Q*[j,i] - Q*[i,j] + Q*[j,j]` where Q* is the pseudoinverse of the Laplacian.

### `network_polarisation(vec, W, directed=True)`
Calculate network polarisation -- a measure that accounts for opinion extremity, echo chamber formation, and network organization. Input vector must have both positive and negative values.
- `vec`: (N,) array_like -- polarization vector (must contain both positive and negative values). Normalized internally between -1 and 1.
- `W`: (N, N) array_like -- weight matrix
- `directed`: bool, optional, default=True -- whether the graph is directed. When False, enables hermitian pinv optimization.
- Returns `polariz`: float -- polarisation value = `sqrt((o+ - o-)^T Q* (o+ - o-))` where Q* is the Laplacian pseudoinverse.

### `network_variance(vec, D, use_numba=has_numba)`
Calculate network-aware variance of a distribution on a graph.
- `vec`: (N,) array_like -- input vector. Must be all positive. Normalized internally as a probability distribution (divided by sum).
- `D`: (N, N) array_like -- distance matrix (e.g., effective resistance or its square root)
- `use_numba`: bool, optional, default=True if numba available -- use numba-accelerated version
- Returns `network_variance`: float -- computed as `0.5 * sum_ij p(i) * p(j) * d^2(i,j)`

### `network_covariance(joint_pmat, D, calc_marginal=True, use_numba=has_numba)`
Calculate network-aware covariance from a joint probability matrix on a graph.
- `joint_pmat`: (N, N) array_like -- joint probability matrix (must be a valid joint distribution)
- `D`: (N, N) array_like -- distance matrix
- `calc_marginal`: bool, optional, default=True -- whether to compute marginal variances. Setting False is slightly faster (returns marginal variances as 0).
- `use_numba`: bool, optional, default=True if numba available -- use numba-accelerated version
- Returns tuple of three floats:
  - `network_covariance`: float -- `0.5 * sum_ij [p(i)*q(j) - P(i,j)] * d^2(i,j)`
  - `var_p`: float -- marginal variance of row marginal p (0 if calc_marginal=False)
  - `var_q`: float -- marginal variance of column marginal q (0 if calc_marginal=False)

## Spreading Dynamics

### `simulate_atrophy(SC_den, SC_len, seed, roi_sizes, T_total=1000, dt=0.1, p_stay=0.5, v=1, trans_rate=1, init_number=1, GBA=None, SNCA=None, k1=0.5, k=0, FC=None)`
Simulate atrophy on a brain network using an S.I.R. spreading model. Runs three phases internally: normal protein spread to equilibrium, misfolded protein spread, and atrophy estimation.
- `SC_den`: (n, n) ndarray -- structural connectivity matrix (strength/density)
- `SC_len`: (n, n) ndarray -- structural connectivity matrix (fiber length)
- `seed`: int -- node index used as seed for misfolded protein injection
- `roi_sizes`: (n,) ndarray -- size of each ROI in the parcellation (used as synthesis control and infectivity denominator)
- `T_total`: int, optional, default=1000 -- total number of simulation time steps
- `dt`: float, optional, default=0.1 -- size of each time step
- `p_stay`: float, optional, default=0.5 -- probability of staying in the same region per unit time
- `v`: float, optional, default=1 -- speed of the protein transport process
- `trans_rate`: float, optional, default=1 -- scalar controlling baseline infectivity
- `init_number`: int, optional, default=1 -- number of injected misfolded proteins at the seed
- `GBA`: (n,) ndarray or None, optional, default=None -- GBA gene expression (clearance rate). If None, uniform distribution used.
- `SNCA`: (n,) ndarray or None, optional, default=None -- SNCA gene expression (synthesis rate). If None, uniform distribution used.
- `k1`: float, optional, default=0.5 -- ratio between atrophy from misfolded accumulation vs. deafferentation. Must be between 0 and 1. `k2 = 1 - k1`.
- `k`: float, optional, default=0 -- weight of functional connectivity modulation on structural connectivity
- `FC`: (n, n) ndarray or None, optional, default=None -- functional connectivity matrix. If None, no FC modulation applied.
- Returns `simulated_atrophy`: (n, T_total) ndarray -- trajectory of simulated atrophy per region per time step (cumulative sum of atrophy accrual)

## Utilities

### `_fast_binarize(W)`
Binarize a matrix by thresholding at zero. JIT-compiled with numba when available.
- `W`: (N, N) array_like -- input matrix
- Returns: (N, N) numpy.ndarray -- binary matrix where values > 0 become 1
- Implementation: `(W > 0) * 1`

### `_graph_laplacian(W)`
Compute the graph Laplacian L = D - W, where D is the diagonal degree matrix with `D_ii = sum_j W_ij`. JIT-compiled with numba when available.
- `W`: (N, N) array_like -- weighted connection matrix
- Returns `L`: (N, N) numpy.ndarray -- graph Laplacian
- Implementation: `np.diag(np.sum(W, axis=0)) - W`
