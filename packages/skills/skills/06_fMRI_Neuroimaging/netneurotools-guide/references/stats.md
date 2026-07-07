# netneurotools.stats Reference

## Table of Contents

- [Correlation Functions](#correlation-functions): `efficient_pearsonr`, `weighted_pearsonr`, `make_correlated_xy`
- [Permutation Tests](#permutation-tests): `permtest_1samp`, `permtest_rel`, `permtest_pearsonr`
- [Regression Functions](#regression-functions): `_add_constant`, `residualize`, `get_dominance_stats`

---

## Correlation Functions

### `efficient_pearsonr`

```python
efficient_pearsonr(a, b, ddof=1, nan_policy="propagate")
```

Compute Pearson correlation of matching columns in `a` and `b`. Supports vectorized computation across multiple column pairs simultaneously.

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `a` | array_like | (required) | Sample observations. Must have same length as `b`; equivalent number of columns or be broadcastable. |
| `b` | array_like | (required) | Sample observations. Must have same length as `a`; equivalent number of columns or be broadcastable. |
| `ddof` | int | `1` | Degrees of freedom correction in standard deviation calculation. |
| `nan_policy` | str | `"propagate"` | Options: `"propagate"` (returns NaN), `"raise"` (throws error), `"omit"` (ignores NaN values). |

**Returns:** `(corr, pval)` -- `corr`: float or ndarray of Pearson coefficients; `pval`: float or ndarray of two-tailed p-values.

```python
>>> np.random.seed(12345678)
>>> x1, y1 = stats.make_correlated_xy(corr=0.1, size=100)
>>> x2, y2 = stats.make_correlated_xy(corr=0.8, size=100)
>>> stats.efficient_pearsonr(np.c_[x1, x2], np.c_[y1, y2])
(array([0.10032565, 0.79961189]), array([3.20636135e-01, 1.97429944e-23]))
```

---

### `weighted_pearsonr`

```python
weighted_pearsonr(x_vec, y_vec, weight_vec, use_numba=has_numba)
```

Calculate weighted Pearson correlation coefficient: `r = sum(w*(x-xbar)*(y-ybar)) / sqrt(sum(w*(x-xbar)^2) * sum(w*(y-ybar)^2))` where xbar, ybar are weighted means.

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `x_vec` | array_like | (required) | First vector of data. |
| `y_vec` | array_like | (required) | Second vector of data. |
| `weight_vec` | array_like | (required) | Vector of weights. |
| `use_numba` | bool | `True` if numba available | Whether to use numba-accelerated calculation. Raises `ValueError` if `True` but numba is not installed. |

**Returns:** `corr` (float) -- Weighted Pearson correlation coefficient.

---

### `make_correlated_xy`

```python
make_correlated_xy(corr=0.85, size=10000, seed=None, tol=0.001)
```

Generate random vectors correlated to approximately `corr`. Accepts a float for two vectors or a symmetrical correlation matrix for N vectors.

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `corr` | float in [-1, 1] or (N, N) ndarray | `0.85` | Desired correlation. Float produces two vectors; a square array produces `len(corr)` vectors. Diagonal must be 1 if array. |
| `size` | int or tuple | `10000` | Size of generated vectors. |
| `seed` | int, RandomState, or None | `None` | Seed for random number generation. |
| `tol` | float in [0, 1] | `0.001` | Tolerance between actual and desired correlation. |

**Returns:** `vectors` (numpy.ndarray) -- Random vectors with specified correlation.

```python
>>> x, y = stats.make_correlated_xy(corr=0.2)
>>> np.corrcoef(x, y)  # ~[[1, 0.2], [0.2, 1]]
>>> corr = [[1, 0.5, 0.3], [0.5, 1, 0], [0.3, 0, 1]]
>>> out = stats.make_correlated_xy(corr=corr)
>>> out.shape  # (3, 10000)
```

---

## Permutation Tests

All permutation tests produce a minimum p-value of `1 / (n_perm + 1)`.

### `permtest_1samp`

```python
permtest_1samp(a, popmean, axis=0, n_perm=1000, seed=0)
```

Non-parametric equivalent of `scipy.stats.ttest_1samp`. Two-tailed test of whether `a` differs from `popmean` using sign-flip permutations.

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `a` | array_like | (required) | Sample observations. |
| `popmean` | float or array_like | (required) | Expected value under the null. If array_like, must match `a`'s shape excluding `axis`. |
| `axis` | int or None | `0` | Axis for computation. `None` computes over the whole array. |
| `n_perm` | int | `1000` | Number of permutations (Monte Carlo simulations). |
| `seed` | int, RandomState, or None | `0` | Seed for reproducibility. `None` for non-deterministic. |

**Returns:** `(stat, pvalue)` -- `stat`: float or ndarray, difference from `popmean`; `pvalue`: float or ndarray, non-parametric p-value.

```python
>>> np.random.seed(7654567)
>>> rvs = np.random.normal(loc=5, scale=10, size=(50, 2))
>>> stats.permtest_1samp(rvs, 5.0)
(array([-0.985602, -0.05204969]), array([0.48551449, 0.95904096]))
>>> stats.permtest_1samp(rvs, 0.0)
(array([4.014398, 4.94795031]), array([0.00699301, 0.000999]))
>>> stats.permtest_1samp(rvs, [5.0, 0.0])  # per-column null means
(array([-0.985602, 4.94795031]), array([0.48551449, 0.000999]))
```

---

### `permtest_rel`

```python
permtest_rel(a, b, axis=0, n_perm=1000, seed=0)
```

Non-parametric equivalent of `scipy.stats.ttest_rel`. Two-tailed test of whether related samples `a` and `b` differ, using group-swap permutations.

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `a` | array_like | (required) | Sample observations. Must have same shape as `b`. |
| `b` | array_like | (required) | Sample observations. Must have same shape as `a`. |
| `axis` | int or None | `0` | Axis for computation. `None` computes over whole arrays. |
| `n_perm` | int | `1000` | Number of permutations (Monte Carlo simulations). |
| `seed` | int, RandomState, or None | `0` | Seed for reproducibility. `None` for non-deterministic. |

**Returns:** `(stat, pvalue)` -- `stat`: float or ndarray, average difference between `a` and `b`; `pvalue`: float or ndarray, non-parametric p-value.

```python
>>> np.random.seed(12345678)
>>> rvs1 = np.random.normal(loc=5, scale=10, size=500)
>>> rvs2 = np.random.normal(loc=5, scale=10, size=500) + np.random.normal(scale=0.2, size=500)
>>> stats.permtest_rel(rvs1, rvs2)   # similar distributions: not significant
(-0.16506275161572695, 0.8021978021978022)
>>> rvs3 = np.random.normal(loc=8, scale=10, size=500) + np.random.normal(scale=0.2, size=500)
>>> stats.permtest_rel(rvs1, rvs3)   # different distributions: significant
(2.40533726097883, 0.000999000999000999)
```

---

### `permtest_pearsonr`

```python
permtest_pearsonr(a, b, axis=0, n_perm=1000, resamples=None, seed=0)
```

Non-parametric equivalent of `scipy.stats.pearsonr`. Two-tailed test of whether `a` and `b` are correlated. Supports externally supplied resampling arrays (e.g., spin-test indices for spatially constrained null models).

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `a` | (N[, M]) array_like | (required) | Sample observations. Same length as `b`; equivalent columns or broadcastable. |
| `b` | (N[, M]) array_like | (required) | Sample observations. Same length as `a`; equivalent columns or broadcastable. |
| `axis` | int or None | `0` | Axis for computation. `None` computes over whole arrays. |
| `n_perm` | int | `1000` | Number of permutations (Monte Carlo simulations). |
| `resamples` | (N, P) array_like or None | `None` | Precomputed resampling indices to shuffle `a`. Must have same length as `a`/`b` and at least `n_perm` columns. `None` uses standard random permutation. |
| `seed` | int, RandomState, or None | `0` | Seed for reproducibility. `None` for non-deterministic. |

**Returns:** `(corr, pvalue)` -- `corr`: float or ndarray, Pearson coefficient(s); `pvalue`: float or ndarray, non-parametric p-value(s).

```python
>>> np.random.seed(12345678)
>>> x, y = stats.make_correlated_xy(corr=0.5, size=100)
>>> stats.permtest_pearsonr(x, y)
(0.500040365781984, 0.000999000999000999)

# Multiple columns via broadcasting
>>> z = x + np.random.normal(loc=1, size=100)
>>> stats.permtest_pearsonr(x, np.column_stack([y, z]))
(array([0.50004037, 0.25843187]), array([0.000999, 0.01098901]))

# Matching column pairs
>>> a, b = stats.make_correlated_xy(corr=0.9, size=100)
>>> stats.permtest_pearsonr(np.column_stack([x, a]), np.column_stack([y, b]))
(array([0.50004037, 0.89927523]), array([0.000999, 0.000999]))

# Using externally supplied resamples (e.g., from spin tests)
>>> rng = np.random.default_rng(2222)
>>> resamples = np.column_stack([rng.permutation(len(x)) for _ in range(250)])
>>> stats.permtest_pearsonr(x, y, n_perm=250, resamples=resamples)
```

---

## Regression Functions

### `_add_constant`

```python
_add_constant(data)
```

Add a constant (i.e., intercept) term to `data`. Appends a column of ones to the input array.

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `data` | (N, M) array_like | (required) | Samples by features data array. |

**Returns:** `data` ((N, F) np.ndarray) -- Where `F` is `M + 1`. The input array with a column of ones appended.

```python
>>> from netneurotools import stats
>>> A = np.zeros((5, 5))
>>> stats._add_constant(A)
array([[0., 0., 0., 0., 0., 1.],
       [0., 0., 0., 0., 0., 1.],
       [0., 0., 0., 0., 0., 1.],
       [0., 0., 0., 0., 0., 1.],
       [0., 0., 0., 0., 0., 1.]])
```

---

### `residualize`

```python
residualize(X, Y, Xc=None, Yc=None, normalize=True, add_intercept=True)
```

Return residuals of the regression `Y ~ X`. Optionally uses a comparative group (`Xc`, `Yc`) to estimate betas and normalization parameters, then applies those to `X` and `Y`.

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `X` | (N[, R]) array_like | (required) | Coefficient matrix of `R` variables for `N` subjects. |
| `Y` | (N[, F]) array_like | (required) | Dependent variable matrix of `F` variables for `N` subjects. |
| `Xc` | (M[, R]) array_like or None | `None` | Comparative group coefficient matrix for beta estimation. Must be provided together with `Yc`; if omitted, `X` is used. |
| `Yc` | (M[, F]) array_like or None | `None` | Comparative group dependent variable matrix. Must be provided together with `Xc`; if omitted, `Y` is used. |
| `normalize` | bool | `True` | Whether to z-score residuals using `Yc ~ Xc` residuals for mean/variance. |
| `add_intercept` | bool | `True` | Whether to add an intercept to `X` (and `Xc`). Used in beta estimation but not removed from residuals. |

**Returns:** `Yr` ((N, F) numpy.ndarray) -- Residuals of `Y ~ X`.

---

### `get_dominance_stats`

```python
get_dominance_stats(X, y, use_adjusted_r_sq=True, verbose=False, n_jobs=1)
```

Return dominance analysis statistics for multilinear regression. Computes individual, partial, and total dominance for each predictor by fitting all possible predictor-subset models. Simplified rewrite of the `dominance-analysis` package. Warning: work-in-progress, parameters may change.

**Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `X` | (N, M) array_like | (required) | Input data with `N` samples and `M` predictors. |
| `y` | (N,) array_like | (required) | Target values. |
| `use_adjusted_r_sq` | bool | `True` | Use adjusted R-squared. `False` for raw R-squared (matches original `dominance-analysis` package). |
| `verbose` | bool | `False` | Print debug messages and show `tqdm` progress bars. |
| `n_jobs` | int | `1` | Parallel jobs (passed to `joblib.Parallel`). |

**Returns:**

- `model_metrics` (dict) -- Keys: `"individual_dominance"` ((1, M) array, each predictor's standalone R-squared), `"partial_dominance"` ((M-1, M) array, incremental R-squared at each subset size), `"total_dominance"` ((M,) array, average of individual and partial), `"full_r_sq"` (float, full-model R-squared). Total dominance sums to `full_r_sq`.
- `model_r_sq` (dict) -- Maps predictor-index tuples to R-squared values, e.g., `(0,)`, `(0, 2)`, `(0, 1, 2)`.

```python
from netneurotools.stats import get_dominance_stats
from sklearn.datasets import load_boston
X, y = load_boston(return_X_y=True)
model_metrics, model_r_sq = get_dominance_stats(X, y)
# model_metrics["total_dominance"] sums to model_metrics["full_r_sq"]
```
