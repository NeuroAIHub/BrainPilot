# Drifting generator (`drifting_generator.py`)
Source in repo: `spikeinterface/src/spikeinterface/generation/drifting_generator.py`
Parent index: [INDEX.md](INDEX.md)
---

### `generate_drifting_recording`

Generates two synthetic recordings: one static and one drifting, with the same units and the same spike trains.

```python
def generate_drifting_recording(
    num_units=250,
    duration=600.0,
    sampling_frequency=30000.0,
    probe_name="Neuropixels1-128",
    probe=None,
    generate_probe_kwargs=None,
    unit_locations=None,
    generate_unit_locations_kwargs=dict(
        margin_um=20.0,
        minimum_z=5.0,
        maximum_z=45.0,
        minimum_distance=18.0,
        max_iteration=100,
        distance_strict=False,
        distribution="uniform",
    ),
    displacement_data=None,
    generate_displacement_vector_kwargs=dict(
        displacement_sampling_frequency=5.0,
        drift_start_um=[0, 20],
        drift_stop_um=[0, -20],
        drift_step_um=1,
        motion_list=[
            dict(
                drift_mode="zigzag",
                non_rigid_gradient=None,
                t_start_drift=60.0,
                t_end_drift=None,
                period_s=200,
            ),
        ],
    ),
    generate_templates_kwargs=dict(
        ms_before=1.5,
        ms_after=3.0,
        mode="ellipsoid",
        unit_params=dict(
            alpha=(100.0, 500.0),
            spatial_decay=(10, 45),
            ellipse_shrink=(0.4, 1),
            ellipse_angle=(0, np.pi * 2),
        ),
    ),
    sorting=None,
    generate_sorting_kwargs=dict(firing_rates=(2.0, 8.0), refractory_period_ms=4.0),
    noise=None,
    generate_noise_kwargs=dict(noise_levels=(6.0, 8.0), spatial_decay=25.0),
    amplitude_std: float | None = None,
    amplitude_factor: np.ndarray | None = None,
    extra_outputs=False,
    seed=None,
)
```

Parameters:
- `num_units` (int, default 250): Number of units.
- `duration` (float, default 600.0): Duration in seconds.
- `sampling_frequency` (float, default 30000.0): Sampling frequency (Hz).
- `probe_name` (str, default "Neuropixels1-128"): Probe type used when both `generate_probe_kwargs` and `probe` are None. Supported literal probe names accepted by the internal `_make_probe_by_name` helper: `"Neuropixels1-384"`, `"Neuropixels1-128"`, `"Neuropixels2-384"`, `"Neuropixels2-128"`, `"Neuronexus-32"`, `"tetrode"`, `"sinaps-128"`. Additionally, any string of the form `"manufacturer/probe_name"` or `"manufacturer#probe_name"` is forwarded to `probeinterface.get_probe(manufacturer, probe_name)`.
- `probe` (Probe | None, default None): Explicit probe geometry.
- `generate_probe_kwargs` (dict | None, default None): dict passed to `probeinterface.generate_multi_columns_probe`; supersedes `probe_name` when provided.
- `unit_locations` (np.ndarray | None, default None): Pre-computed unit locations of shape `(num_units, 3)`.
- `generate_unit_locations_kwargs` (dict): Passed to `generate_unit_locations` if `unit_locations is None`. Default keys: `margin_um=20.0`, `minimum_z=5.0`, `maximum_z=45.0`, `minimum_distance=18.0`, `max_iteration=100`, `distance_strict=False`, `distribution="uniform"`.
- `displacement_data` (tuple | None, default None): Output of `generate_displacement_vector`, if precomputed.
- `generate_displacement_vector_kwargs` (dict): See `generate_displacement_vector`. Default keys: `displacement_sampling_frequency=5.0`, `drift_start_um=[0, 20]`, `drift_stop_um=[0, -20]`, `drift_step_um=1`, `motion_list=[dict(drift_mode="zigzag", non_rigid_gradient=None, t_start_drift=60.0, t_end_drift=None, period_s=200)]`.
- `generate_templates_kwargs` (dict): Passed to `generate_templates`. Default keys: `ms_before=1.5`, `ms_after=3.0`, `mode="ellipsoid"`, `unit_params=dict(alpha=(100.0, 500.0), spatial_decay=(10, 45), ellipse_shrink=(0.4, 1), ellipse_angle=(0, np.pi * 2))`.
- `sorting` (NumpySorting | None, default None): Ground-truth sorting; if None one is generated.
- `generate_sorting_kwargs` (dict, default `dict(firing_rates=(2.0, 8.0), refractory_period_ms=4.0)`): Passed to `generate_sorting` if `sorting is None`.
- `noise` (NoiseGeneratorRecording | None, default None): Background-noise recording; if None, one is generated with `generate_noise`.
- `generate_noise_kwargs` (dict, default `dict(noise_levels=(6.0, 8.0), spatial_decay=25.0)`): Passed to `generate_noise` when `noise is None`.
- `amplitude_std` (float | None, default None): Std of per-spike amplitude modulation.
- `amplitude_factor` (np.ndarray | None, default None): Fixed per-spike amplitude factor.
- `extra_outputs` (bool, default False): If True, return an extra dict with intermediate variables.
- `seed` (int | None, default None): Global seed used for all steps.

Returns: `(static_recording, drifting_recording, sorting)` or, when `extra_outputs=True`, `(static_recording, drifting_recording, sorting, extra_infos)`. `extra_infos` contains keys: `displacement_vectors`, `displacement_sampling_frequency`, `unit_locations`, `displacement_unit_factor`, `unit_displacements`, `templates`, `generate_templates_kwargs`.

### `generate_displacement_vector`

Creates displacement vectors and per-unit factors for `InjectDriftingTemplatesRecording`. Supports combining several motion shapes over the same linear motion boundary.

```python
def generate_displacement_vector(
    duration,
    unit_locations,
    displacement_sampling_frequency=5.0,
    drift_start_um=[0, 30.0],
    drift_stop_um=[0, -30.0],
    drift_step_um=1,
    motion_list=[
        dict(
            drift_mode="zigzag",
            amplitude_factor=1.0,
            non_rigid_gradient=None,
            t_start_drift=60.0,
            t_end_drift=None,
            period_s=200,
        ),
    ],
    seed=None,
)
```

Parameters:
- `duration` (float): Duration of the displacement vector in seconds.
- `unit_locations` (np.ndarray): Unit locations with shape `(num_units, 2)` (only x/y used).
- `displacement_sampling_frequency` (float, default 5.0): Sampling frequency of the drift vector.
- `drift_start_um` (list of float, default `[0, 30.0]`): Start boundary of the motion in x/y direction.
- `drift_stop_um` (list of float, default `[0, -30.0]`): Stop boundary of the motion in x/y direction.
- `drift_step_um` (float, default 1): Step size used to build the `displacements_steps` array; number of steps is forced odd via `int(||stop - start||/step // 2 * 2 + 1)`.
- `motion_list` (list of dict): Each dict is passed to `make_one_displacement_vector`. Each dict may contain `drift_mode`, `amplitude_factor`, `non_rigid_gradient`, `t_start_drift`, `t_end_drift`, `period_s`, `bump_interval_s`. `len(motion_list) == displacement_vectors.shape[2]`.
- `seed` (int | None, default None): Random seed for `make_one_displacement_vector`.

Motion parameter semantics inside a `motion_list` entry:
- `drift_mode` (Literal): one of `"zigzag"`, `"bump"`, `"random_walk"`.
- `amplitude_factor` (float, default 1.0): Amplitude scaling of that motion.
- `non_rigid_gradient` (float | None): If not None, sets a per-unit factor gradient along the drift direction. Sign controls the direction; `abs(value)` in `[0, 1]` controls how strongly units near one border are suppressed vs. the opposite border.
- `t_start_drift`, `t_end_drift` (float | None): Drift start/end times in seconds.
- `period_s` (float, default 200): Zigzag period in seconds.
- `bump_interval_s` (tuple, default `(30, 90.0)`): For `"bump"` mode, interval range between random bumps.

Returns tuple: `(unit_displacements, displacement_vectors, displacement_unit_factor, displacement_sampling_frequency, displacements_steps)`.

### `make_one_displacement_vector`

```python
def make_one_displacement_vector(
    drift_mode="zigzag",
    duration=600.0,
    amplitude_factor=1.0,
    displacement_sampling_frequency=5.0,
    t_start_drift=None,
    t_end_drift=None,
    period_s=200,
    bump_interval_s=(30, 90.0),
    seed=None,
)
```

Generates a normalized (`[-0.5, 0.5]`) 1-D displacement time-series for one motion shape.

Parameters:
- `drift_mode` (Literal, default `"zigzag"`): Drift shape. Docstring lists `"zigzag"`, `"bumps"`, `"random_walk"`, but the actual `if/elif` chain accepts exactly `"zigzag"`, `"bump"`, `"random_walk"` (the singular `"bump"` is what the code checks; passing `"bumps"` raises a ValueError).
- `duration` (float, default 600.0): Duration in seconds.
- `amplitude_factor` (float, default 1.0): Amplitude factor applied to the final vector.
- `displacement_sampling_frequency` (float, default 5.0): Sampling rate of the vector.
- `t_start_drift` (float | None, default None): Time in seconds when drift starts (defaults to 0.0).
- `t_end_drift` (float | None, default None): Time in seconds when drift ends (defaults to `duration`).
- `period_s` (float, default 200): Period of the zigzag in seconds.
- `bump_interval_s` (tuple, default `(30, 90.0)`): Range interval between random bumps in seconds.
- `seed` (int | None, default None): Seed for the random bumps / random walk.

Returns the displacement vector (numpy array) scaled by `amplitude_factor`.
