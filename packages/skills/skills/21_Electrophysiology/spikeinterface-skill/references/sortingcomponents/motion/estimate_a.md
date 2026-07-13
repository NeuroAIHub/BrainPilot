# Motion — estimate_motion (overview + decentralized + iterative_template)

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/motion/motion_estimation.py`
Parent index: [../INDEX.md](../INDEX.md)

---

## Motion

Module: `spikeinterface.sortingcomponents.motion`. Public re-exports from
`motion/__init__.py`:

- `estimate_motion` (from `motion_estimation`)
- `compute_peak_displacements`, `correct_motion_on_peaks`,
  `interpolate_motion_on_traces`, `InterpolateMotionRecording`,
  `interpolate_motion` (from `motion_interpolation`)
- `clean_motion_vector` (from `motion_cleaner`)

### `estimate_motion`

```python
from spikeinterface.sortingcomponents.motion import estimate_motion

estimate_motion(
    recording,
    peaks=None,
    peak_locations=None,
    direction="y",
    rigid=False,
    win_shape="gaussian",
    win_step_um=200.0,
    win_scale_um=300.0,
    win_margin_um=None,
    method="dredge_ap",
    extra_outputs=False,
    progress_bar=False,
    verbose=False,
    margin_um=None,
    **method_kwargs,
) -> Motion | tuple[Motion, dict]
```

- Only single-segment recordings are supported
  (`recording.get_num_segments() == 1` asserted).
- `direction : "x" | "y" | "z"`, default `"y"`.
- `rigid : bool`, default `False`.
- `win_shape : "gaussian" | "rect" | "triangle"`, default `"gaussian"`.
- `win_step_um : float`, default `200.0`.
- `win_scale_um : float`, default `300.0`.
- `win_margin_um : float | None`, default `None` (auto -win_scale_um/2).
- `method : str`, default `"dredge_ap"` — key of
  `estimate_motion_methods`.
- `extra_outputs : bool`, default `False`.
- `progress_bar : bool`, default `False`.
- `verbose : bool`, default `False`.
- `margin_um` — deprecated; use `hist_margin_um` or `win_margin_um`.
- Returns `Motion` object (or `(motion, extra)` when `extra_outputs=True`).

### Method registry (`motion_estimation._methods_list` /
`estimate_motion_methods`)

Exact registry keys, built from `_methods_list = [DecentralizedRegistration,
IterativeTemplateRegistration, DredgeLfpRegistration, DredgeApRegistration,
MedicineRegistration]`:

- `"decentralized"` → `DecentralizedRegistration`
  (`need_peak_location = True`)
- `"iterative_template"` → `IterativeTemplateRegistration`
  (`need_peak_location = True`)
- `"dredge_lfp"` → `DredgeLfpRegistration`
  (`need_peak_location = False`)
- `"dredge_ap"` (default) → `DredgeApRegistration`
  (`need_peak_location = True`)
- `"medicine"` → `MedicineRegistration`
  (`need_peak_location = True`)

Note: the module ships `"dredge_ap"` and `"dredge_lfp"`; there is no plain
`"dredge"` key.

#### `decentralized` — method_kwargs (from `DecentralizedRegistration.run`)

- `bin_um : float`, default `5.0`
- `hist_margin_um : float`, default `20.0`
- `bin_s : float`, default `2.0`
- `histogram_depth_smooth_um : float | None`, default `1.0`
- `histogram_time_smooth_s : float | None`, default `1.0`
- `pairwise_displacement_method : "conv" | "phase_cross_correlation"`,
  default `"conv"`
- `max_displacement_um : float`, default `100.0`
- `weight_scale : "linear" | "exp"`, default `"linear"`
- `error_sigma : float`, default `0.2`
- `conv_engine : "numpy" | "torch" | None`, default `None`
- `torch_device`, default `None`
- `batch_size : int`, default `1`
- `corr_threshold : float`, default `0.0`
- `time_horizon_s : float | None`, default `None`
- `convergence_method : "lsmr" | "lsqr_robust" | "gradient_descent"`,
  default `"lsmr"`
- `soft_weights : bool`, default `False`
- `normalized_xcorr : bool`, default `True`
- `centered_xcorr : bool`, default `True`
- `temporal_prior : bool`, default `True`
- `spatial_prior : bool`, default `False`
- `force_spatial_median_continuity : bool`, default `False`
- `reference_displacement : "mean" | "median" | "time" | "mode_search"`,
  default `"median"`
- `reference_displacement_time_s : float`, default `0`
- `robust_regression_sigma : float`, default `2`
- `lsqr_robust_n_iter : int`, default `20`
- `weight_with_amplitude : bool`, default `False`

#### `iterative_template` — method_kwargs (from
`IterativeTemplateRegistration.run`)

- `bin_um : float`, default `10.0`
- `hist_margin_um : float`, default `0.0`
- `bin_s : float`, default `2.0`
- `num_amp_bins : int`, default `20`
- `num_shifts_global : int`, default `15`
- `num_iterations : int`, default `10`
- `num_shifts_block : int`, default `5`
- `smoothing_sigma : float`, default `0.5`
- `kriging_sigma : float`, default `1`
- `kriging_p : float`, default `2`
- `kriging_d : float`, default `2`
