# Metrics Utils (`metrics/utils.py`)
Source in repo: `spikeinterface/src/spikeinterface/metrics/utils.py`
Parent index: [INDEX.md](INDEX.md)
---

## 3. Utils (`metrics/utils.py`)

The module has no `__init__` re-exports; the five functions defined at module level are public but must be imported from `spikeinterface.metrics.utils` directly (they are **not** star-exported by `spikeinterface.metrics`).

### `compute_bin_edges_per_unit`

```python
def compute_bin_edges_per_unit(sorting, segment_samples, bin_duration_s=1.0, periods=None, concatenated=True):
    """
    Compute bin edges for units, optionally taking into account periods.

    Parameters
    ----------
    sorting : Sorting
        Sorting object containing unit information.
    segment_samples : list or array-like
        Number of samples in each segment.
    bin_duration_s : float, default: 1
        Duration of each bin in seconds
    periods : array of unit_period_dtype, default: None
        Periods to consider for each unit
    concatenated : bool, default: True
        Wheter the bins are concatenated across segments or not.
        If False, the bin edges are computed per segment and the first index of each segment is 0.
        If True, the bin edges are computed on the concatenated segments, with the correct offsets.

    Returns
    -------
    dict
        Bin edges for each unit. If concatenated is True, the bin edges are a 1D array.
        If False, the bin edges are a list of arrays, one per segment.
    """
```

### `compute_total_samples_per_unit`

```python
def compute_total_samples_per_unit(sorting_analyzer, periods=None):
    """
    Get total number of samples for each unit, optionally taking into account periods.

    Parameters
    ----------
    sorting_analyzer : SortingAnalyzer
        The sorting analyzer object.
    periods : array of unit_period_dtype, default: None
        Periods to consider for each unit.

    Returns
    -------
    dict
        Total number of samples for each unit.
    """
```

When `periods is None`, all units get `sorting_analyzer.get_total_samples()`; otherwise per-unit sample counts are accumulated from `end_sample_index - start_sample_index` on entries matching `period["unit_index"]`.

### `compute_total_durations_per_unit`

```python
def compute_total_durations_per_unit(sorting_analyzer, periods=None):
    """
    Compute total duration for each unit, optionally taking into account periods.

    Parameters
    ----------
    sorting_analyzer : SortingAnalyzer
        The sorting analyzer object.
    periods : array of unit_period_dtype, default: None
        Periods to consider for each unit.

    Returns
    -------
    dict
        Total duration for each unit.
    """
```

Implementation: `compute_total_samples_per_unit(sorting_analyzer, periods=periods)` divided by `sorting_analyzer.sampling_frequency`.

### `create_regular_periods`

```python
def create_regular_periods(sorting_analyzer, num_periods, bin_size_s=None):
    """
    Computes and sets periods for each unit in the sorting analyzer.
    The periods span the total duration of the recording, but divide it into
    smaller periods either by specifying the number of periods or the size of each bin.

    Parameters
    ----------
    sorting_analyzer : SortingAnalyzer
        The sorting analyzer containing the units and recording information.
    num_periods : int
        The number of periods to divide the total duration into (used if bin_size_s is None).
    bin_size_s : float, defaut: None
        If given, periods will be multiple of this size in seconds.

    Returns
    -------
    periods
        np.ndarray of dtype unit_period_dtype containing the segment, start, end samples and unit index.
    """
```

Each entry has fields `("segment_index", "start_sample_index", "end_sample_index", "unit_index")` from `spikeinterface.core.base.unit_period_dtype`.

### `create_ground_truth_pc_distributions`

```python
def create_ground_truth_pc_distributions(center_locations, total_points):
    """
    Simulate PCs as multivariate Gaussians, for testing PC-based quality metrics
    Values are created for only one channel and vary along one dimension.

    Parameters
    ----------
    center_locations : array-like (units, ) or (channels, units)
        Mean of the multivariate gaussian at each channel for each unit.
    total_points : array-like
        Number of points in each unit distribution.

    Returns
    -------
    all_pcs : numpy.ndarray
        PC scores for each point.
    all_labels : numpy.array
        Labels for each point.
    """
```

Output shape: `(sum(total_points), 3)` when `center_locations` is 1D, `(sum(total_points), 3, n_channels)` when 2D. Calls `np.random.seed(0)` inside for reproducibility. Requires `scipy.stats.multivariate_normal`.
