# Re-exported from `spikeinterface.core.generate` (part A)
Source in repo: `spikeinterface/src/spikeinterface/core/generate.py`
Parent index: [INDEX.md](INDEX.md)
---

### `generate_recording`

```python
def generate_recording(
    num_channels: int = 2,
    sampling_frequency: float = 30000.0,
    durations: list[float] = [5.0, 2.5],
    set_probe: bool | None = True,
    ndim: int | None = 2,
    t_starts: list[float] | None = None,
    seed: int | None = None,
) -> BaseRecording
```

Lightweight lazy `MockRecording` with white noise and (optionally) a linear probe. Useful for testing.

Parameters:
- `num_channels` (int, default 2).
- `sampling_frequency` (float, default 30000.0): In Hz.
- `durations` (list[float], default `[5.0, 2.5]`): One entry per segment.
- `set_probe` (bool | None, default True): If True, attach a linear probe (from `probeinterface.generate_linear_probe`).
- `ndim` (int | None, default 2): Set to 3 for a 3-D probe.
- `t_starts` (list[float] | None, default None): Per-segment start times; must match `durations` length.
- `seed` (int | None, default None).

Returns a `MockRecording` (subclass of `BaseRecording`) named `"SyntheticRecording"`, annotated `is_filtered=True`.

### `generate_sorting`

```python
def generate_sorting(
    num_units=5,
    sampling_frequency=30000.0,
    durations=[10.325, 3.5],
    firing_rates=3.0,
    empty_units=None,
    refractory_period_ms=4.0,
    add_spikes_on_borders=False,
    num_spikes_per_border=3,
    border_size_samples=20,
    t_starts=None,
    seed=None,
)
```

Returns a `NumpySorting` with random firings.

Parameters:
- `num_units` (int, default 5).
- `sampling_frequency` (float, default 30000.0).
- `durations` (list[float], default `[10.325, 3.5]`): Per-segment durations in seconds.
- `firing_rates` (float | list[float] | np.ndarray | tuple, default 3.0): Scalar, per-unit vector, or `(lim0, lim1)` uniform range.
- `empty_units` (list | None, default None): Units that will have zero spikes (mostly for tests).
- `refractory_period_ms` (float, default 4.0).
- `add_spikes_on_borders` (bool, default False): If True, add spikes near segment borders.
- `num_spikes_per_border` (int, default 3).
- `border_size_samples` (int, default 20).
- `t_starts` (list[float] | None, default None): Per-segment start times.
- `seed` (int | None, default None).

### `generate_snippets`

```python
def generate_snippets(
    nbefore=20,
    nafter=44,
    num_channels=2,
    wf_folder=None,
    sampling_frequency=30000.0,
    durations=[10.325, 3.5],
    set_probe=True,
    ndim=2,
    num_units=5,
    empty_units=None,
    **job_kwargs,
)
```

Generates a synthetic `NumpySnippets` object together with its associated `NumpySorting`.

Parameters:
- `nbefore` (int, default 20): Samples before the peak.
- `nafter` (int, default 44): Samples after the peak.
- `num_channels` (int, default 2).
- `wf_folder` (str | Path | None, default None): Optional folder for on-disk waveforms; None keeps them in memory.
- `sampling_frequency` (float, default 30000.0).
- `durations` (list[float], default `[10.325, 3.5]`): Per-segment durations.
- `set_probe` (bool, default True): Attach a probe to the returned snippets.
- `ndim` (int, default 2): Probe dimensionality.
- `num_units` (int, default 5).
- `empty_units` (list | None, default None).
- `**job_kwargs`: Forwarded to `snippets_from_sorting`.

Returns `(snippets, sorting)`.

### `generate_templates`

```python
def generate_templates(
    channel_locations,
    units_locations,
    sampling_frequency,
    ms_before,
    ms_after,
    seed=None,
    dtype="float32",
    upsample_factor=None,
    unit_params=None,
    mode="ellipsoid",
    spatial_profile="exponential",
)
```

Parameters:
- `channel_locations` (np.ndarray): Channel locations (2-D or 3-D; 2-D is padded with zeros for the z axis).
- `units_locations` (np.ndarray): Must be 3-D (shape `(num_units, 3)`; asserted).
- `sampling_frequency` (float).
- `ms_before` (float).
- `ms_after` (float).
- `seed` (int | None, default None).
- `dtype` (np.dtype | str, default `"float32"`).
- `upsample_factor` (int | None, default None): If set, output gains a trailing `upsample_factor` axis.
- `unit_params` (dict | None, default None): Per-unit template parameters. Keys accepted (each may be a scalar, per-unit array, or `(lim0, lim1)` tuple range):

    - `"alpha"` – amplitude of the action potential in a.u. (default range: (100.0, 500.0))
    - `"depolarization_ms"` – depolarization interval in ms (default range: (0.09, 0.14))
    - `"repolarization_ms"` – repolarization interval in ms (default range: (0.5, 0.8))
    - `"recovery_ms"` – recovery interval in ms (default range: (1.0, 1.5))
    - `"positive_amplitude"` – positive amplitude in a.u. (default range: (0.1, 0.25)) (negative amplitude is fixed to -1)
    - `"smooth_ms"` – Gaussian smoothing sigma in ms (default range: (0.03, 0.07))
    - `"spatial_decay"` – spatial decay constant in um (default range: (10.0, 45.0))
    - `"spatial_power"` – exponent for power-law spatial decay (default range: (1.5, 2.5))
    - `"propagation_speed"` – propagation delay speed in um/ms (default range: (250.0, 350.0))
    - `"ellipse_shrink"` – shrink factor used by `mode="ellipsoid"` (default range: (0.4, 1))
    - `"ellipse_angle"` – angle used by `mode="ellipsoid"` (default range: (0, np.pi * 2))
- `mode` (Literal, default `"ellipsoid"`): one of `"ellipsoid"`, `"sphere"`.
- `spatial_profile` (Literal, default `"exponential"`): one of `"exponential"`, `"power"`.
  - `"exponential"`: `channel_factors = alpha * exp(-r / spatial_decay)`.
  - `"power"`: `channel_factors = alpha / (1.0 + (r/spatial_decay) ** spatial_power)`.

Returns array of shape `(num_units, num_samples, num_channels)`, or `(num_units, num_samples, num_channels, upsample_factor)` when `upsample_factor is not None`.

### `generate_recording_by_size`

```python
def generate_recording_by_size(
    full_traces_size_GiB: float,
    seed: int | None = None,
    strategy: Literal["tile_pregenerated", "on_the_fly"] = "tile_pregenerated",
) -> MockRecording
```

Generate a large lazy `MockRecording` whose size in GiB is specified directly. Hard-codes `num_channels=384`, `sampling_frequency=30000.0`, `dtype="float32"`.

Parameters:
- `full_traces_size_GiB` (float): Total in-memory-equivalent size of the recording in gibibytes.
- `seed` (int | None, default None).
- `strategy` (Literal, default `"tile_pregenerated"`): one of `"tile_pregenerated"`, `"on_the_fly"`.

### `generate_ground_truth_recording`

```python
def generate_ground_truth_recording(
    durations=[10.0],
    sampling_frequency=25000.0,
    num_channels=4,
    num_units=10,
    sorting=None,
    probe=None,
    generate_probe_kwargs=dict(
        num_columns=2,
        xpitch=20,
        ypitch=20,
        contact_shapes="circle",
        contact_shape_params={"radius": 6},
    ),
    templates=None,
    ms_before=1.0,
    ms_after=3.0,
    upsample_factor=None,
    upsample_vector=None,
    generate_sorting_kwargs=dict(firing_rates=15, refractory_period_ms=4.0),
    noise_kwargs=dict(noise_levels=5.0, strategy="on_the_fly"),
    generate_unit_locations_kwargs=dict(margin_um=10.0, minimum_z=5.0, maximum_z=50.0, minimum_distance=20),
    generate_templates_kwargs=None,
    dtype="float32",
    seed=None,
)
```

Generates a fully synthetic `(recording, sorting)` pair by combining a probe, sorting, templates (via `generate_templates`), and noise (via `NoiseGeneratorRecording`). If `templates`, `sorting`, or `probe` are not provided, they are generated from the corresponding kwargs.

Parameters:
- `durations` (list[float], default `[10.0]`).
- `sampling_frequency` (float, default 25000.0).
- `num_channels` (int, default 4): Ignored when `probe` is provided.
- `num_units` (int, default 10): Ignored when `sorting` is provided.
- `sorting` (Sorting | None, default None).
- `probe` (Probe | None, default None).
- `generate_probe_kwargs` (dict, default `dict(num_columns=2, xpitch=20, ypitch=20, contact_shapes="circle", contact_shape_params={"radius": 6})`): Forwarded to `probeinterface.generate_multi_columns_probe`.
- `templates` (np.ndarray | None, default None): Shape `(num_units, num_samples, num_channels)` or `(num_units, num_samples, num_channels, upsample_factor)`.
- `ms_before` (float, default 1.0).
- `ms_after` (float, default 3.0).
- `upsample_factor` (int | None, default None): Only used when templates are auto-generated.
- `upsample_vector` (np.ndarray | None, default None): Per-spike jitter index; same shape as spike vector.
- `generate_sorting_kwargs` (dict, default `dict(firing_rates=15, refractory_period_ms=4.0)`).
- `noise_kwargs` (dict, default `dict(noise_levels=5.0, strategy="on_the_fly")`): Forwarded to `NoiseGeneratorRecording`.
- `generate_unit_locations_kwargs` (dict, default `dict(margin_um=10.0, minimum_z=5.0, maximum_z=50.0, minimum_distance=20)`).
- `generate_templates_kwargs` (dict | None, default None).
- `dtype` (np.dtype | str, default `"float32"`).
- `seed` (int | None, default None).

Returns `(recording, sorting)` where `recording.name == "GroundTruthRecording"` and `sorting.name == "GroundTruthSorting"`.
