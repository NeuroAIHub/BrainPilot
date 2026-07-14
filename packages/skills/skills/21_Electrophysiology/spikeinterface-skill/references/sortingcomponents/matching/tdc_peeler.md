# Template matching — tdc-peeler

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/matching/tdc.py`
Parent index: [../INDEX.md](../INDEX.md)

---

### `tdc-peeler` — `TridesclousPeeler`

Class attributes: `name = "tdc-peeler"`, `need_noise_levels = True`,
`need_first_call_before_pipeline = True`.

```python
TridesclousPeeler(
    recording,
    templates,
    return_output=True,
    peak_sign="neg",
    exclude_sweep_ms=0.8,
    peak_shift_ms=0.2,
    detect_threshold=5,
    noise_levels=None,
    motion_aware=False,
    motion=None,
    drifting_templates=None,
    interpolation_time_bin_size_s=1.0,
    motion_step_um=2.0,
    use_fine_detector=True,
    detection_radius_um=80.0,
    cluster_radius_um=150.0,
    amplitude_fitting_radius_um=150.0,
    sample_shift=2,
    ms_before=0.5,
    ms_after=0.8,
    max_peeler_loop=2,
    amplitude_limits=(0.7, 1.4),
)
```

- `peak_sign : str`, default `"neg"` — used with values `"neg"`, `"pos"`,
  `"both"` in `use_fine_detector` branch.
- `exclude_sweep_ms : float`, default `0.8`.
- `peak_shift_ms : float`, default `0.2`.
- `detect_threshold : float`, default `5`.
- `noise_levels : array | None`, default `None` — required (asserted
  not-None).
- `motion_aware : bool`, default `False`.
- `motion : Motion | None`, default `None` — required if
  `motion_aware=True`.
- `drifting_templates : DriftingTemplates | None`, default `None`.
- `interpolation_time_bin_size_s : float`, default `1.0`.
- `motion_step_um : float`, default `2.0`.
- `use_fine_detector : bool`, default `True`.
- `detection_radius_um : float`, default `80.0`.
- `cluster_radius_um : float`, default `150.0`.
- `amplitude_fitting_radius_um : float`, default `150.0`.
- `sample_shift : int`, default `2`.
- `ms_before : float`, default `0.5`.
- `ms_after : float`, default `0.8`.
- `max_peeler_loop : int`, default `2`.
- `amplitude_limits : tuple`, default `(0.7, 1.4)`.
- `return_output : bool`, default `True`.

Uses `LocallyExclusivePeakDetector` for the fast detector and, if
`use_fine_detector=True`, `MatchedFilteringPeakDetector` for refinement.
