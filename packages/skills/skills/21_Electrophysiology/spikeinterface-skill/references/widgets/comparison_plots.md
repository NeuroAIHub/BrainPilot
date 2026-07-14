# Comparison plots

Source in repo: `spikeinterface/src/spikeinterface/widgets/comparison.py`
Parent index: [INDEX.md](INDEX.md)
---

## Comparison plots

### plot_confusion_matrix

Class `ConfusionMatrixWidget` (from `widgets/comparison.py`). Backends: `matplotlib`.

```python
ConfusionMatrixWidget(
    gt_comparison,
    count_text=True,
    unit_ticks=True,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | None`.

### plot_agreement_matrix

Class `AgreementMatrixWidget` (from `widgets/comparison.py`). Backends: `matplotlib`.

```python
AgreementMatrixWidget(
    sorting_comparison,
    ordered=True,
    count_text=True,
    unit_ticks=True,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | None`.

Works with `GroundTruthComparison` or `SymmetricSortingComparison`.

### plot_multicomparison_graph

Class `MultiCompGraphWidget` (from `widgets/multicomparison.py`). Backends: `matplotlib`.

```python
MultiCompGraphWidget(
    multi_comparison,
    draw_labels=False,
    node_cmap="viridis",
    edge_cmap="hot",
    alpha_edges=0.5,
    colorbar=False,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `node_cmap : str, default "viridis"` (matplotlib colormap name).
- `edge_cmap : str, default "hot"` (matplotlib colormap name).
- `backend : "matplotlib" | None`.

### plot_multicomparison_agreement

Class `MultiCompGlobalAgreementWidget` (from `widgets/multicomparison.py`). Backends: `matplotlib`.

```python
MultiCompGlobalAgreementWidget(
    multi_comparison,
    plot_type="pie",
    cmap="YlOrRd",
    fontsize=9,
    show_legend=True,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `plot_type : "pie" | "bar"` (default `"pie"`).
- `cmap : str, default "YlOrRd"` (matplotlib colormap name; docstring erroneously says `"Reds"`).
- `backend : "matplotlib" | None`.

### plot_multicomparison_agreement_by_sorter

Class `MultiCompAgreementBySorterWidget` (from `widgets/multicomparison.py`). Backends: `matplotlib`.

```python
MultiCompAgreementBySorterWidget(
    multi_comparison,
    plot_type="pie",
    cmap="YlOrRd",
    fontsize=9,
    show_legend=True,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `plot_type : "pie" | "bar"` (default `"pie"`).
- `cmap : str, default "YlOrRd"` (matplotlib colormap name; docstring erroneously says `"Reds"`).
- `backend : "matplotlib" | None`.

### plot_comparison_collision_by_similarity

Class `ComparisonCollisionBySimilarityWidget` (from `widgets/collision.py`). Backends: `matplotlib`.

```python
ComparisonCollisionBySimilarityWidget(
    comp,
    templates_array,
    unit_ids=None,
    metric="cosine_similarity",
    mode="heatmap",
    similarity_bins=np.linspace(-0.4, 1, 8),
    cmap="winter",
    good_only=False,
    min_accuracy=0.9,
    show_legend=False,
    ylim=(0, 1),
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `metric : "cosine_similarity"` (docstring documents only this value).
- `mode : "heatmap" | "lines"` (default `"heatmap"`).
- `cmap : str, default "winter"` (matplotlib colormap name; used when `mode="lines"`).
- `backend : "matplotlib" | None`.

Plots a `CollisionGTComparison` pair-by-pair, ordered by cosine similarity of templates.

### plot_study_comparison_collision_by_similarity

Class `StudyComparisonCollisionBySimilarityWidget` (from `widgets/collision.py`). Backends: `matplotlib`.

```python
StudyComparisonCollisionBySimilarityWidget(
    study,
    case_keys=None,
    metric="cosine_similarity",
    similarity_bins=np.linspace(-0.4, 1, 8),
    show_legend=False,
    ylim=(0.5, 1),
    good_only=False,
    min_accuracy=0.9,
    cmap="winter",
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `metric : "cosine_similarity"` (docstring documents only this value).
- `cmap : str, default "winter"`.
- `backend : "matplotlib" | None`.

### plot_study_run_times

Class `StudyRunTimesWidget` (from `widgets/gtstudy.py`). Backends: `matplotlib`. Emits a deprecation warning; delegates to `spikeinterface.benchmark.benchmark_plot_tools.plot_run_times`.

```python
StudyRunTimesWidget(study, case_keys=None, backend=None, **backend_kwargs)
```

Literal values:

- `backend : "matplotlib" | None`.

### plot_study_unit_counts

Class `StudyUnitCountsWidget` (from `widgets/gtstudy.py`). Backends: `matplotlib`. Deprecated; delegates to `plot_unit_counts` in `benchmark_plot_tools`.

```python
StudyUnitCountsWidget(study, case_keys=None, backend=None, **backend_kwargs)
```

Literal values:

- `backend : "matplotlib" | None`.

Plots `num_well_detected`, `num_false_positive`, `num_redundant`, `num_overmerged`.

### plot_study_performances

Class `StudyPerformances` (from `widgets/gtstudy.py`; note: no `Widget` suffix). Backends: `matplotlib`. Deprecated; delegates to `plot_performances` in `benchmark_plot_tools`.

```python
StudyPerformances(
    study,
    mode="ordered",
    performance_names=("accuracy", "precision", "recall"),
    case_keys=None,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `mode : "ordered" | "snr" | "swarm"` (default `"ordered"`).
  - `"ordered"`: performance vs unit indices ordered by decreasing accuracy.
  - `"snr"`: performance vs snr.
  - `"swarm"`: seaborn `swarmplot`.
- `performance_names` element values: `"accuracy"`, `"precision"`, `"recall"`.
- `backend : "matplotlib" | None`.

### plot_study_agreement_matrix

Class `StudyAgreementMatrix` (from `widgets/gtstudy.py`). Backends: `matplotlib`. Deprecated.

```python
StudyAgreementMatrix(
    study,
    ordered=True,
    case_keys=None,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | None`.

### plot_study_summary

Class `StudySummary` (from `widgets/gtstudy.py`). Backends: `matplotlib`. Deprecated. Internally invokes `plot_study_performances` (in modes `"ordered"` and `"snr"`), `plot_study_agreement_matrix`, `plot_study_run_times`, and `plot_study_unit_counts`.

```python
StudySummary(study, case_keys=None, backend=None, **backend_kwargs)
```

Literal values:

- `backend : "matplotlib" | None`.

---
