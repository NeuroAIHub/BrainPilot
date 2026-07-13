# Plot helpers (part A)

Source in repo: `spikeinterface/src/spikeinterface/benchmark/benchmark_plot_tools.py`
Parent index: [INDEX.md](INDEX.md)
---

## Plot helpers

All functions live in `spikeinterface/benchmark/benchmark_plot_tools.py`. Most are wrapped as `Study.plot_xxx()` on the domain-specific study classes, but they also work as free functions when called with `study` as first argument.

### `despine(ax_or_axes)` / `clean_axis(ax)`

```python
def despine(ax_or_axes):
    """Hide top and right spines on one axis or a list/array of axes."""

def clean_axis(ax):
    """Hide all four spines and remove ticks."""
```

### `plot_study_legend`

```python
def plot_study_legend(study, case_keys=None, levels_to_group_by=None, ax=None, figsize=None):
    """Make an ax with only a legend of the study cases."""
```

### `aggregate_dataframe_by_levels`

```python
def aggregate_dataframe_by_levels(df, study, case_keys=None, levels_to_group_by=None):
    """
    Aggregate a DataFrame by dropping levels not to keep.

    Returns
    -------
    df : pd.DataFrame
    new_case_keys : list
    labels : dict
    colors : dict
    """
```

### `plot_run_times`

```python
def plot_run_times(
    study, case_keys=None, mode="bar",
    levels_to_group_by=None, xticks_rotation=45.0,
    figsize=None, ax=None,
):
    """
    Plot run times for a BenchmarkStudy.

    Parameters
    ----------
    mode : {"bar", "box"}
        When `levels_to_group_by` is not None, choose whether to draw a bar
        chart (mean +/- std) or a boxplot across the sub-cases in each group.
    """
```

`mode` is a string literal with exactly two supported values: `"bar"` (default) and `"box"`.

### `plot_unit_counts`

```python
def plot_unit_counts(
    study,
    case_keys=None,
    levels_to_group_by=None,
    colors=None,
    columns=None,
    with_rectangle=True,
    revert_bad=True,
    xticks_rotation=45.0,
    show_legend=True,
    figsize=None,
    ax=None,
):
    """
    Plot unit counts for a study:
        "num_well_detected", "num_false_positive", "num_redundant", "num_overmerged"
    """
```

Default `columns` are all columns of `count_units` except `"num_gt"` and `"num_sorter"`. Any of these string keys may be passed explicitly: `"num_gt"`, `"num_sorter"`, `"num_well_detected"`, `"num_false_positive"`, `"num_redundant"`, `"num_overmerged"`, `"num_bad"`.

### `plot_agreement_matrix`

```python
def plot_agreement_matrix(study, ordered=True, case_keys=None, axs=None):
    """
    Plot agreement matrices for cases in a study.
    """
```

### `plot_performances_vs_snr` / `plot_performances_vs_firing_rate`

Both wrap the private `_plot_performances_vs_metric` (metric name hard-coded to `"snr"` or `"firing_rate"`):

```python
def plot_performances_vs_snr(
    study,
    case_keys=None,
    figsize=None,
    performance_names=("accuracy", "recall", "precision"),
    metric_dataset_reference=None,
    levels_to_group_by=None,
    orientation="vertical",
    show_legend=True,
    show_scatter=True,
    with_sigmoid_fit=False,
    show_average_by_bin=True,
    scatter_size=4,
    scatter_alpha=1.0,
    num_bin_average=20,
    axs=None,
):
    """
    Plots performance metrics against signal-to-noise ratio (SNR).
    """

def plot_performances_vs_firing_rate(...same signature...):
    """
    Plots performance metrics against firing rate.
    """
```

For both:

* `performance_names` — any subset of `"accuracy"`, `"recall"`, `"precision"` (plus any other name understood by `GroundTruthComparison.get_performance()`, e.g. `"false_discovery_rate"`, `"miss_rate"`).
* `orientation` — string literal, exactly `"vertical"` or `"horizontal"`. Any other value raises `ValueError("orientation must be 'vertical' or 'horizontal'")`.
