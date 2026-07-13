# Plot helpers (part B)

Source in repo: `spikeinterface/src/spikeinterface/benchmark/benchmark_plot_tools.py`
Parent index: [INDEX.md](INDEX.md)
---

### `plot_performances_ordered`

```python
def plot_performances_ordered(
    study,
    case_keys=None,
    performance_names=("accuracy", "recall", "precision"),
    levels_to_group_by=None,
    orientation="vertical",
    show_legend=True,
    figsize=None,
    axs=None,
):
    """
    Plot performances ordered by decreasing performance.
    """
```

`orientation` accepts exactly `"vertical"` or `"horizontal"` (raises `ValueError` otherwise).

### `plot_performances_swarm`

```python
def plot_performances_swarm(
    study,
    case_keys=None,
    performance_names=("accuracy", "recall", "precision"),
    figsize=None,
    levels_to_group_by=None,
    performance_colors={"accuracy": "g", "recall": "b", "precision": "r"},
    ax=None,
):
    """
    Uses `seaborn.swarmplot` to draw performances by case, colored by metric.
    """
```

### `plot_performances_comparison`

```python
def plot_performances_comparison(
    study,
    case_keys=None,
    figsize=None,
    performance_names=("accuracy", "recall", "precision"),
    performance_colors={"accuracy": "g", "recall": "b", "precision": "r"},
    levels_to_group_by=None,
    ylim=(-0.1, 1.1),
    axs=None,
):
    """
    Pairwise scatter of one case's performance vs another's.  Requires at least
    2 cases.
    """
```

### `plot_performances_vs_depth_and_snr`

```python
def plot_performances_vs_depth_and_snr(
    study,
    performance_name="accuracy",
    case_keys=None,
    figsize=None,
    levels_to_group_by=None,
    map_name="viridis",
    axs=None,
):
    """
    2-D scatter (depth, snr) coloured by performance value.
    """
```

`performance_name` is any string key of `GroundTruthComparison.get_performance()` — commonly `"accuracy"`, `"recall"`, `"precision"`, `"false_discovery_rate"`, `"miss_rate"`.

### `plot_performance_losses`

```python
def plot_performance_losses(
    study, case0, case1, performance_names=["accuracy"],
    map_name="coolwarm", figsize=None, axs=None,
):
    """
    Plot performance losses between two cases.
    """
```

`case0`, `case1` — either two case keys (str/tuple) or the output of `study.get_pairs_by_level(level)`.

### `plot_some_over_merged` / `plot_some_over_splited`

```python
def plot_some_over_merged(study, case_keys=None, overmerged_score=0.05, max_units=5, figsize=None):
    """Plot template waveforms of overmerged units."""

def plot_some_over_splited(study, case_keys=None, oversplit_score=0.05, max_units=5, figsize=None):
    """Plot template waveforms of over-splitted units."""
```

`plot_some_over_splited` picks templates from either `results["clustering_templates"]` (when the study is `ClusteringStudy`) or `results["sorter_analyzer"]` (`SorterStudy` with `with_analyzer=True`). If neither is available it raises `ValueError("This benchmark do not have templates computed")`.
