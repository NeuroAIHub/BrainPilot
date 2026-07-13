# Drift tools (`drift_tools.py`)
Source in repo: `spikeinterface/src/spikeinterface/generation/drift_tools.py`
Parent index: [INDEX.md](INDEX.md)
---

### `interpolate_templates`

```python
def interpolate_templates(templates_array, source_locations, dest_locations, interpolation_method="cubic")
```

Interpolate templates spatially onto new channel positions using `scipy.interpolate.griddata` with `fill_value=0`.

Parameters:
- `templates_array` (np.ndarray): shape `(num_templates, num_samples, num_channels)`.
- `source_locations` (np.ndarray): `(num_channels, 2)`.
- `dest_locations` (np.ndarray): `(num_channels, 2)` or `(num_motions, num_channels, 2)`.
- `interpolation_method` (str, default `"cubic"`): Interpolation method forwarded to `griddata`.

Returns `new_templates_array` with shape `(num_templates, num_samples, num_channels)` or `(num_motions, num_templates, num_samples, num_channels)`.

### `move_dense_templates`

```python
def move_dense_templates(templates_array, displacements, source_probe, dest_probe=None, interpolation_method="cubic")
```

Move dense templates by 2-D displacements using spatial interpolation. Optionally remap to a different destination probe.

Parameters:
- `templates_array` (np.ndarray): `(num_templates, num_samples, num_channels)`.
- `displacements` (np.ndarray): `(num_displacement, 2)`.
- `source_probe` (Probe).
- `dest_probe` (Probe | None, default None): Defaults to `source_probe`.
- `interpolation_method` (Literal, default `"cubic"`): One of `"cubic"`, `"linear"`.

Returns: `new_templates_array` with shape `(num_displacement, num_templates, num_samples, num_channels)`.

### `DriftingTemplates`

Subclass of `Templates` that carries pre-moved template variants and their displacements. Supports either on-the-fly interpolation per spike or precomputed discrete displacements.

Constructor:

```python
class DriftingTemplates(Templates):
    def __init__(self, templates_array_moved=None, displacements=None, **static_kwargs)
```

- `templates_array_moved` (np.ndarray | None): `(num_displacement, num_templates, num_samples, num_channels)`.
- `displacements` (np.ndarray | None): `(num_displacement, 2)`. Must be given together with `templates_array_moved`.
- `**static_kwargs`: forwarded to `Templates.__init__`. `probe` must be provided (asserted).

Attributes (exact names, set on the instance):
- `templates_array_moved` (np.ndarray | None)
- `displacements` (np.ndarray | None)
- Plus everything inherited from `Templates` (e.g. `templates_array`, `sampling_frequency`, `nbefore`, `probe`, `sparsity_mask`, `is_in_uV`, `unit_ids`, `channel_ids`, `num_units`, `num_channels`, `num_samples`).

Class methods:
- `from_static_templates(cls, templates: Templates) -> DriftingTemplates`: Build a `DriftingTemplates` from a static `Templates`; then call `precompute_displacements` before injecting. Forwards `templates_array`, `sampling_frequency`, `nbefore`, `probe`, `sparsity_mask`, `is_in_uV`, `unit_ids`, `channel_ids`.
- `from_precomputed_templates(cls, templates_array_moved: ArrayLike, displacements: ArrayLike, sampling_frequency: float, nbefore: int, probe: Probe) -> DriftingTemplates`: Build directly from precomputed moved templates. The middle displacement index (`templates_array_moved[templates_array_moved.shape[0] // 2]`) is used as the static representative for the underlying `Templates`.

Instance methods:
- `move_one_template(self, unit_index, displacement, **interpolation_kwargs)`: Interpolate a single unit's template by a single 2-D displacement (`displacement.shape == (1, 2)` asserted). Returns array of shape `(num_samples, num_channels)`.
- `precompute_displacements(self, displacements, **interpolation_kwargs)`: Precompute moved templates for all units for each row of `displacements` (`(num_displacements, 2)`). Sets `self.templates_array_moved` and `self.displacements`.

### `make_linear_displacement`

```python
def make_linear_displacement(start, stop, num_step=10)
```

Return 2-D linear displacements from `start` to `stop`, inclusive, of shape `(num_step, 2)`. With `num_step == 1`, returns the midpoint. Raises `ValueError` for `num_step < 1`.

### `InjectDriftingTemplatesRecording`

Recording class that injects drifting templates on top of an optional parent recording.

```python
class InjectDriftingTemplatesRecording(BaseRecording):
    def __init__(
        self,
        sorting: BaseSorting,
        drifting_templates: DriftingTemplates,
        displacement_vectors: list[np.ndarray],
        displacement_sampling_frequency: float,
        displacement_unit_factor: np.ndarray | None = None,
        parent_recording: BaseRecording | None = None,
        num_samples: list[int] | None = None,
        amplitude_factor: list[np.ndarray] | np.ndarray | float | None = None,
        mode="precompute",
    )
```

Parameters:
- `sorting` (BaseSorting): Ground-truth spike trains.
- `drifting_templates` (DriftingTemplates): Must have `templates_array_moved` and `displacements` set when `mode="precompute"`.
- `displacement_vectors` (list[np.ndarray]): One per segment; each has shape `(num_times, 2, num_motions)`.
- `displacement_sampling_frequency` (float): Sampling frequency of the drift vector.
- `displacement_unit_factor` (np.ndarray | None, default None): `(num_units, num_motions)`; when None, treated as all-ones (rigid drift).
- `parent_recording` (BaseRecording | None, default None): Recording to add spikes on top of. If None, zero traces are used.
- `num_samples` (list[int] | int | None, default None): Per-segment number of samples. Required if `parent_recording is None`.
- `amplitude_factor` (float | np.ndarray | list[np.ndarray] | None, default None): Per-spike amplitude scaling. If scalar, all spikes; if vector, must match the spike vector shape.
- `mode` (str, default `"precompute"`): Currently only `"precompute"` is implemented (uses nearest precomputed displacement per spike).

Notable attributes set on the instance: `drifting_templates`, `spike_vector`.
