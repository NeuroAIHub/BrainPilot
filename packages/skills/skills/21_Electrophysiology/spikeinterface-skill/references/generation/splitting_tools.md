# Splitting tools (`splitting_tools.py`)
Source in repo: `spikeinterface/src/spikeinterface/generation/splitting_tools.py`
Parent index: [INDEX.md](INDEX.md)
---

### `split_sorting_by_times`

```python
def split_sorting_by_times(
    sorting_analyzer,
    splitting_probability=0.5,
    partial_split_prob=0.95,
    unit_ids=None,
    min_snr=None,
    seed=None,
)
```

Splits units in a `SortingAnalyzer`'s sorting into two along the temporal median of their spikes.

Parameters:
- `sorting_analyzer`: A `SortingAnalyzer` whose sorting should be split.
- `splitting_probability` (float, default 0.5): Fraction of units to split (with `unit_ids=None`).
- `partial_split_prob` (float, default 0.95): Fraction of "late-half" spikes that actually get reassigned to the new unit id.
- `unit_ids` (list | None, default None): Explicit list of units to split.
- `min_snr` (float | None, default None): If set, requires `noise_levels` and `quality_metrics` extensions; only units with SNR strictly greater than `min_snr` are candidates.
- `seed` (int | None, default None).

Returns `(new_sorting, splitted_pairs)`.

### `split_sorting_by_amplitudes`

```python
def split_sorting_by_amplitudes(
    sorting_analyzer,
    splitting_probability=0.5,
    partial_split_prob=0.95,
    unit_ids=None,
    min_snr=None,
    seed=None,
)
```

Splits units by amplitude median (requires the `spike_amplitudes` extension; computes it if missing). Same parameter semantics as `split_sorting_by_times`. Returns `(new_sorting, splitted_pairs)`.

Parameters:
- `sorting_analyzer`: A `SortingAnalyzer` whose sorting should be split.
- `splitting_probability` (float, default 0.5): Fraction of units to split.
- `partial_split_prob` (float, default 0.95): Fraction of above-median-amplitude spikes reassigned to the new unit id.
- `unit_ids` (list | None, default None): Explicit list of units to split.
- `min_snr` (float | None, default None): If set, computes/uses `noise_levels` and `quality_metrics` extensions and filters candidates by SNR.
- `seed` (int | None, default None).
