# Performance metrics
Source in repo: `spikeinterface/src/spikeinterface/comparison/comparisontools.py`
Parent index: [INDEX.md](INDEX.md)
---

Computed by `compute_performance(count_score)` in `comparisontools.py`.
Per-row (per-GT-unit) definitions, given `tp`, `fn`, `fp`, `num_gt`:

| Metric | Formula |
| --- | --- |
| `accuracy` | `tp / (tp + fn + fp)` |
| `recall` | `tp / (tp + fn)` (a.k.a. sensitivity) |
| `precision` | `tp / (tp + fp)` |
| `false_discovery_rate` | `fp / (tp + fp)` |
| `miss_rate` | `fn / num_gt` |

Notes from the source: no `TN` is defined (does not apply here); `accuracy`
equals `tp_rate` because `TN = 0`; `recall` equals sensitivity. Rows where
`num_gt == 0` or `tp == 0` are left at `0`.

The `_perf_keys` list in `comparisontools.py` is:

```python
_perf_keys = ["accuracy", "recall", "precision", "false_discovery_rate", "miss_rate"]
```

`GroundTruthComparison.get_performance(method=..., output=...)`:
- `method="raw_count"` — returns `self.count_score` (columns `tp`, `fn`,
  `fp`, `num_gt`, `num_tested`, `tested_id`, indexed by `gt_unit_id`).
- `method="by_unit"` — returns per-unit performance DataFrame.
- `method="pooled_with_average"` — column-wise mean of `"by_unit"`.
- `output="pandas"` (default) returns a `DataFrame`/`Series`; `output="dict"`
  converts via `.to_dict()`.
