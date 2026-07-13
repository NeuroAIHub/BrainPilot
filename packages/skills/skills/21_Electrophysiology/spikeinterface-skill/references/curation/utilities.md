# Utilities
Source in repo: `spikeinterface/src/spikeinterface/curation/curation_tools.py`
Parent index: [INDEX.md](INDEX.md)
---

## Utilities

### get_labeling_summary

Verbatim signature from `curation_tools.py`:

```python
def get_labeling_summary(unit_labels: np.ndarray, possible_labels=None) -> dict
```

Parameters:

- `unit_labels` (`np.ndarray`) - one label string per unit.
- `possible_labels` (`list[str] | None`, default `None`) - restrict the label universe.
  Unknown labels raise `ValueError`.

Returns `{"total_units": int, "counts": {label: int, ...}, "percentages": {label: float, ...}}`.
