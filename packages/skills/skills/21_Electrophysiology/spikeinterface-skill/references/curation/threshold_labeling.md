# Threshold-based labeling
Source in repo: `spikeinterface/src/spikeinterface/curation/threshold_metrics_curation.py`
Parent index: [INDEX.md](INDEX.md)
---

## Threshold-based labeling

### threshold_metrics_label_units

Verbatim signature from `threshold_metrics_curation.py`:

```python
def threshold_metrics_label_units(
    metrics: "pd.DataFrame",
    thresholds: dict | str | Path,
    pass_label: str = "good",
    fail_label: str = "noise",
    operator: str = "and",
    nan_policy: str = "fail",
    column_name: str = "label",
)
```

Parameters:

- `metrics` (`pd.DataFrame`) - DataFrame indexed by unit id.
- `thresholds` (`dict | str | Path`) - either a dict or path to a JSON file. Each entry
  maps `metric_name -> {"greater": float|None, "less": float|None, "abs": bool}`. Only
  the keys `"greater"`, `"less"`, `"abs"` are accepted (other keys raise `ValueError`).
  `"greater"` is inclusive `>=`; `"less"` is inclusive `<=`; `"abs": True` compares
  against `|value|`. `None` or `NaN` disables a bound.
- `pass_label` (`str`, default `"good"`) - label for units that pass.
- `fail_label` (`str`, default `"noise"`) - label for units that fail.
- `operator` (`"and" | "or"`, default `"and"`) - combine per-metric outcomes. `"and"`
  requires all thresholds to pass; `"or"` requires any threshold to pass.
- `nan_policy` (`"fail" | "pass" | "ignore"`, default `"fail"`) - `"fail"` treats NaN as
  fail; `"pass"` treats NaN as pass; `"ignore"` skips NaNs (behavior depends on
  `operator` because the initial mask differs).
- `column_name` (`str`, default `"label"`) - name of the label column in the returned
  DataFrame.

Returns a DataFrame indexed by unit id with column `column_name` containing either
`fail_label` or `pass_label`.
