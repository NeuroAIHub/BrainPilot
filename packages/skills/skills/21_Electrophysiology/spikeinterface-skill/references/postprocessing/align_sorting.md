# Align sorting (`align_sorting` / `AlignSortingExtractor`)
Source in repo: `spikeinterface/src/spikeinterface/postprocessing/alignsorting.py`
Parent index: [INDEX.md](INDEX.md)
---

## Align sorting (`align_sorting` / `AlignSortingExtractor`)

Source: `src/spikeinterface/postprocessing/alignsorting.py`. This is **not** an `AnalyzerExtension` — it is a `BaseSorting` wrapper that shifts each unit's spike train by a per-unit sample offset (typically to peak-align spikes across templates). Both `align_sorting` and `AlignSortingExtractor` are re-exported by `postprocessing/__init__.py`.

```python
class AlignSortingExtractor(BaseSorting):
    def __init__(self, sorting, unit_peak_shifts):
        ...

align_sorting = define_function_from_class(source_class=AlignSortingExtractor, name="align_sorting")
```

- `sorting`: `BaseSorting` — sorting to align.
- `unit_peak_shifts`: `dict` — mapping `unit_id -> int` (samples). Positive shift => spike train shifted back in time; negative shift => shifted forward.
- Returns: `AlignSortingExtractor`, a new sorting.

Recommended usage:

```python
from spikeinterface.postprocessing import align_sorting

shifts = {unit_id: int(shift_samples) for unit_id, shift_samples in unit_peak_shifts.items()}
aligned_sorting = align_sorting(sorting, unit_peak_shifts=shifts)
```
