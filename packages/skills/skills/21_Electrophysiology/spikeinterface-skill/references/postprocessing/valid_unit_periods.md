# valid_unit_periods — ComputeValidUnitPeriods
Source in repo: `spikeinterface/src/spikeinterface/postprocessing/valid_unit_periods.py`
Parent index: [INDEX.md](INDEX.md)
---

## valid_unit_periods — ComputeValidUnitPeriods

- extension name: `"valid_unit_periods"`
- Compute class: `ComputeValidUnitPeriods(AnalyzerExtension)`
- `need_recording=False`, `use_nodepipeline=False`; `need_job_kwargs` is set to `True` and then reassigned to `False` at class-definition time (the effective final value is `False`).
- depends on: `[]`; when `method in ("false_positives_and_negatives", "combined")`, additionally requires the `"amplitude_scalings"` extension (declared via `get_required_dependencies`).
- Source: `src/spikeinterface/postprocessing/valid_unit_periods.py`

Parameters (from `_set_params`):

```python
def _set_params(
    self,
    method: str = "false_positives_and_negatives",
    period_duration_s_absolute: float = 30.0,
    period_target_num_spikes: int = 300,
    period_mode: str = "absolute",
    relative_margin_size: float = 1.0,
    fp_threshold: float = 0.1,
    fn_threshold: float = 0.1,
    minimum_n_spikes: int = 100,
    minimum_valid_period_duration: float = 180,
    min_num_periods_relative: int = 5,
    user_defined_periods: object | None = None,
    refractory_period_ms: float = 0.8,
    censored_period_ms: float = 0.0,
    num_histogram_bins: int = 50,
    histogram_smoothing_value: int = 3,
    amplitudes_bins_min_ratio: int = 5,
):
```

- `method`: `"false_positives_and_negatives" | "user_defined" | "combined"`, default `"false_positives_and_negatives"`.
- `period_duration_s_absolute`: `float`, default `30.0` seconds.
- `period_target_num_spikes`: `int`, default `300`.
- `period_mode`: `"absolute" | "relative"`, default `"absolute"`.
- `relative_margin_size`: `float`, default `1.0`.
- `fp_threshold`, `fn_threshold`: `float`, default `0.1`.
- `minimum_n_spikes`: `int`, default `100`.
- `minimum_valid_period_duration`: `float` seconds, default `180`.
- `min_num_periods_relative`: `int`, default `5`.
- `user_defined_periods`: `np.ndarray | None`, default `None`; required for method `"user_defined"`; shape `(n_periods, 3)` or `(n_periods, 4)`, cast to `unit_period_dtype`.
- `refractory_period_ms`: `float`, default `0.8`.
- `censored_period_ms`: `float`, default `0.0`.
- `num_histogram_bins`: `int`, default `50`.
- `histogram_smoothing_value`: `int`, default `3`.
- `amplitudes_bins_min_ratio`: `int`, default `5`.

Extension instance methods:
```python
ext.get_data(outputs="by_unit" | "numpy")
ext.get_fps_and_fns(unit_ids=None)      # per-segment dicts of fp/fn rates
ext.get_period_centers(unit_ids=None)
```

Module-level helpers:

```python
def compute_subperiods(
    sorting_analyzer,
    period_duration_s_absolute: float = 10,
    period_target_num_spikes: int = 1000,
    period_mode: str = "absolute",
    relative_margin_size: float = 1.0,
    min_num_periods_relative: int = 5,
    unit_ids: list | None = None,
) -> dict
```

- `period_duration_s_absolute`: `float`, default `10` (note: different default from the extension itself, which uses `30.0`).
- `period_target_num_spikes`: `int`, default `1000` (again different from the extension default of `300`).
- `period_mode`: `"absolute" | "relative"`, default `"absolute"`.
- `relative_margin_size`: `float`, default `1.0`.
- `min_num_periods_relative`: `int`, default `5`.
- `unit_ids`: `list | None`, default `None`.

```python
def merge_overlapping_periods_for_unit(subperiods)
def merge_overlapping_periods_across_units_and_segments(periods)
```

Public convenience function:
```python
compute_valid_unit_periods = ComputeValidUnitPeriods.function_factory()
```

Recommended usage:

```python
analyzer.compute("amplitude_scalings")   # needed for fp/fn methods
analyzer.compute(
    "valid_unit_periods",
    method="false_positives_and_negatives",
    period_duration_s_absolute=30.0,
    fp_threshold=0.1, fn_threshold=0.1,
    minimum_valid_period_duration=180,
)

ext = analyzer.get_extension("valid_unit_periods")
periods_by_unit = ext.get_data(outputs="by_unit")
fps, fns = ext.get_fps_and_fns()
```
