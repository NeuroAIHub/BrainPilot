# Generation — generate.py
Source in repo: `spikeinterface/src/spikeinterface/core/generate.py`
Parent index: [INDEX.md](INDEX.md)
Related: [aggregation_slicing.md](aggregation_slicing.md), [io_extractors.md](io_extractors.md), [datasets.md](datasets.md)
---

## 1. Generation — `generate.py`

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
) -> BaseRecording:
```
Returns a lazy `MockRecording` (a `BaseRecording`) with white noise. `ndim=3` yields a 3-D probe. `recording.name = "SyntheticRecording"`. Sets `is_filtered=True`.

### `generate_sorting`

```python
def generate_sorting(
    num_units=5,
    sampling_frequency=30000.0,   # in Hz
    durations=[10.325, 3.5],      # in s for 2 segments
    firing_rates=3.0,
    empty_units=None,
    refractory_period_ms=4.0,     # in ms
    add_spikes_on_borders=False,
    num_spikes_per_border=3,
    border_size_samples=20,
    t_starts=None,
    seed=None,
):
```
Returns a `NumpySorting`. Internally uses `synthesize_poisson_spike_vector`.

### `generate_snippets`

```python
def generate_snippets(
    nbefore=20,
    nafter=44,
    num_channels=2,
    wf_folder=None,
    sampling_frequency=30000.0,
    durations=[10.325, 3.5],  #  in s for 2 segments
    set_probe=True,
    ndim=2,
    num_units=5,
    empty_units=None,
    **job_kwargs,
):
```
Returns `(snippets: NumpySnippets, sorting: NumpySorting)`.

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
):
```

- `mode`: `"ellipsoid"` | `"sphere"` (default `"ellipsoid"`)
- `spatial_profile`: `"exponential"` | `"power"` (default `"exponential"`)
- Optional `unit_params` keys with default ranges: `"alpha"` (100.0–500.0), `"depolarization_ms"` (0.09–0.14), `"repolarization_ms"` (0.5–0.8), `"recovery_ms"` (1.0–1.5), `"positive_amplitude"` (0.05–0.15), `"smooth_ms"` (0.03–0.07), `"spatial_decay"` (20–40), `"spatial_power"` (1.5–2.5), `"propagation_speed"` (250.–350.).
- Output shape: `(num_units, num_samples, num_channels)`, or `(num_units, num_samples, num_channels, upsample_factor)` when upsampling.

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
):
```
Returns `(recording, sorting)`. `recording` is annotated `is_filtered=True`.

### `generate_unit_locations`

```python
def generate_unit_locations(
    num_units,
    channel_locations,
    margin_um=20.0,
    minimum_z=5.0,
    maximum_z=40.0,
    minimum_distance=20.0,
    max_iteration=100,
    distance_strict=False,
    distribution="uniform",
    num_modes=2,
    seed=None,
):
```
- `distribution`: `"uniform"` | `"multimodal"`
- Returns `units_locations` of shape `(num_units, 3)`.

### `NoiseGeneratorRecording` (moved to `spikeinterface.generation.noise_tools`)

`spikeinterface.core.NoiseGeneratorRecording` and `noise_generator_recording` are back-compat aliases exposed via `core/__init__.py::__getattr__`. Importing them emits a `FutureWarning` and forwards to `spikeinterface.generation.noise_tools`; they will be removed in 0.106.0.

```python
class NoiseGeneratorRecording(BaseRecording):
    def __init__(
        self,
        num_channels: int,
        sampling_frequency: float,
        durations: list[float],
        noise_levels: float | np.ndarray = 1.0,
        cov_matrix: np.ndarray | None = None,
        dtype: np.dtype | str | None = "float32",
        seed: int | None = None,
        strategy: Literal["tile_pregenerated", "on_the_fly"] = "tile_pregenerated",
        noise_block_size: int = 30000,
    ):
```
- `dtype`: only `"float32"` or `"float64"` accepted.
- `strategy`: `"tile_pregenerated"` | `"on_the_fly"`.

### `InjectTemplatesRecording`

```python
class InjectTemplatesRecording(BaseRecording):
    def __init__(
        self,
        sorting: BaseSorting,
        templates: np.ndarray,
        nbefore: list[int] | int | None = None,
        amplitude_factor: list[float] | float | None = None,
        parent_recording: BaseRecording | None = None,
        num_samples: list[int] | int | None = None,
        upsample_vector: np.ndarray | None = None,
        check_borders: bool = False,
    ) -> None:
```
`templates` can be 3-D `(num_units, num_samples, num_channels)` or 4-D `(num_units, num_samples, num_channels, upsample_factor)`. Attributes: `self.templates`, `self.spike_vector`.

### `synthesize_random_firings`

```python
def synthesize_random_firings(
    num_units=20,
    sampling_frequency=30000.0,
    duration=60,
    refractory_period_ms=4.0,
    firing_rates=3.0,
    add_shift_shuffle=False,
    seed=None,
):
```
Returns `(times, labels)` arrays for one segment.

### `synthetize_spike_train_bad_isi`

```python
def synthetize_spike_train_bad_isi(duration, baseline_rate, num_violations, violation_delta=1e-5):
```
Returns a spike-train array (in seconds).

### Runnable example (typical usage)

```python
import spikeinterface.core as sc

# quick synthetic Recording / Sorting for demos and tests
recording = sc.generate_recording(num_channels=4, durations=[10.0], sampling_frequency=30000.0, seed=0)
sorting = sc.generate_sorting(num_units=5, durations=[10.0], firing_rates=3.0, seed=0)

# ground truth pair, sharing seed and probe
rec_gt, sort_gt = sc.generate_ground_truth_recording(
    durations=[10.0],
    num_channels=8,
    num_units=6,
    sampling_frequency=30000.0,
    seed=0,
)
```

### Related (also exported from `spikeinterface.core`)

- `synthesize_poisson_spike_vector(num_units=20, sampling_frequency=30000.0, duration=60.0, refractory_period_ms=4.0, firing_rates=3.0, seed=0)` — returns `(spike_frames, unit_indices)`. `firing_rates` accepts scalar / array / tuple (tuple → uniform draw range).
- `add_synchrony_to_sorting(sorting, sync_event_ratio=0.3, seed=None)` — returns a `TransformSorting`.
- `create_sorting_npz(num_seg, file_path)`
- `inject_some_duplicate_units(sorting, num=4, max_shift=5, ratio=None, seed=None)`
- `inject_some_split_units(sorting, split_ids: list, num_split=2, output_ids=False, seed=None)`
- `inject_templates = define_function_from_class(source_class=InjectTemplatesRecording, name="inject_templates")` — same signature as `InjectTemplatesRecording`.
- `MockRecording(num_channels: int, sampling_frequency: float, durations: list[float], dtype: np.dtype | str | None = "float32", seed: int | None = None, strategy: Literal["tile_pregenerated", "on_the_fly"] = "tile_pregenerated", noise_block_size: int = 30000)` — the class backing `generate_recording`. `dtype` must be `"float32"` or `"float64"`; `strategy` values: `"tile_pregenerated"` | `"on_the_fly"`.
- `generate_recording_by_size(full_traces_size_GiB: float, seed: int | None = None, strategy: Literal["tile_pregenerated", "on_the_fly"] = "tile_pregenerated") -> MockRecording` — 384 channels, 30 kHz; `strategy` values: `"tile_pregenerated"` | `"on_the_fly"`.
