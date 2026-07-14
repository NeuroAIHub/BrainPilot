# Bombcell curation plots

Source in repo: `spikeinterface/src/spikeinterface/widgets/bombcell_curation.py`
Parent index: [INDEX.md](INDEX.md)
---

### Bombcell curation plots

Class `BombcellUpsetPlotWidget` (from `widgets/bombcell_curation.py`), aliased as `plot_bombcell_labels_upset`. Backends: `matplotlib`. Requires the `upsetplot-bombcell` package.

```python
BombcellUpsetPlotWidget(
    sorting_analyzer,
    unit_labels: np.ndarray,
    thresholds: dict | None = None,
    unit_labels_to_plot: list | None = None,
    min_subset_size: int = 1,
    backend=None,
    **backend_kwargs,
)
```

Literal values:

- `backend : "matplotlib" | None`.

Unit labels understood internally (mapped to threshold sections):

- `"noise"` -> `thresholds["noise"]`
- `"mua"` -> `thresholds["mua"]`
- `"non_soma"`, `"non_soma_good"`, `"non_soma_mua"` -> `thresholds["non-somatic"]`
- `"good"` is removed from `unit_labels_to_plot` when `unit_labels_to_plot=None`.

Attributes: `.figure`, `.figures` (list, one per label), `.axes` (list of axes lists).

Module-level function `plot_bombcell_unit_labeling_all` (also in `bombcell_curation.py`):

```python
plot_bombcell_unit_labeling_all(
    sorting_analyzer,
    unit_labels: np.ndarray,
    thresholds: dict | None = None,
    include_upset: bool = True,
    backend=None,
    **kwargs,
)
# Returns:
# {
#   "histograms": MetricsHistogramsWidget,
#   "waveforms": WaveformOverlayByLabelWidget,
#   "upset":     BombcellUpsetPlotWidget,   # only if include_upset and metrics available
# }
```

Runs all three Bombcell curation-diagnostic plots at once.

---
