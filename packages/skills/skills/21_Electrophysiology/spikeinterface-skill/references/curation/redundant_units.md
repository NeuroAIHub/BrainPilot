# Redundant units
Source in repo: `spikeinterface/src/spikeinterface/curation/remove_redundant.py`
Parent index: [INDEX.md](INDEX.md)
---

## Redundant units

### remove_redundant_units

Verbatim signature from `remove_redundant.py`:

```python
def remove_redundant_units(
    sorting_or_sorting_analyzer: BaseSorting | SortingAnalyzer,
    align: bool = True,
    unit_peak_shifts: dict[int, float] | None = None,
    delta_time: float = 0.4,
    agreement_threshold: float = 0.2,
    duplicate_threshold: float = 0.8,
    remove_strategy: str = "minimum_shift",
    extra_outputs: bool = False,
) -> BaseSorting | tuple[BaseSorting, list[tuple[int, int]]]
```

Parameters:

- `sorting_or_sorting_analyzer` (`BaseSorting | SortingAnalyzer`) - input; a
  `SortingAnalyzer` is required for `"minimum_shift"` and `"highest_amplitude"`
  strategies.
- `align` (`bool`, default `True`) - if True and a `SortingAnalyzer` is provided, spike
  trains are realigned using the per-unit template peak shift before comparison.
- `unit_peak_shifts` (`dict[int, float] | None`, default `None`) - explicit shift map
  keyed by unit id. If `None` and `align=True`, computed via
  `get_template_peak_shift_on_main_channel`.
- `delta_time` (`float`, default `0.4`) - matching-spike tolerance in ms.
- `agreement_threshold` (`float`, default `0.2`) - agreement-score cutoff for candidate
  pairs.
- `duplicate_threshold` (`float`, default `0.8`) - shared-event ratio above which the pair
  is flagged redundant.
- `remove_strategy` (`str`, default `"minimum_shift"`) - one of:
  - `"minimum_shift"` - keep the unit with the smallest absolute template peak shift
    (tie-broken by amplitude). Requires `align=True` and a `SortingAnalyzer`.
  - `"highest_amplitude"` - keep the unit with the larger max-abs amplitude on unshifted
    peak. Requires a `SortingAnalyzer`.
  - `"max_spikes"` - keep the unit with more spikes. This is the only strategy allowed
    with a bare `BaseSorting`.

  Passing any other name (including the placeholder `"with_metrics"`, which raises
  `NotImplementedError`) triggers a `ValueError` referencing `_remove_strategies =
  ("minimum_shift", "highest_amplitude", "max_spikes")`.
- `extra_outputs` (`bool`, default `False`) - if True, returns
  `(sorting_clean, redundant_unit_pairs)`.


### find_redundant_units

Verbatim signature from `remove_redundant.py`:

```python
def find_redundant_units(
    sorting: BaseSorting, delta_time: float = 0.4, agreement_threshold: float = 0.2, duplicate_threshold: float = 0.8
) -> list[tuple[int, int]]
```

Same-name parameters as `remove_redundant_units` but listed here for clarity:

- `sorting` (`BaseSorting`) - input sorting compared to itself via
  `compare_two_sorters(sorting, sorting)`.
- `delta_time` (`float`, default `0.4`) - matching-spike tolerance in ms.
- `agreement_threshold` (`float`, default `0.2`) - agreement-score cutoff for candidate
  pairs.
- `duplicate_threshold` (`float`, default `0.8`) - shared-event ratio above which the pair
  is flagged redundant.

Returns pairs of unit ids flagged as redundant.
