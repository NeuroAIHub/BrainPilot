# Re-exported from `spikeinterface.core.generate` (part B)
Source in repo: `spikeinterface/src/spikeinterface/core/generate.py`
Parent index: [INDEX.md](INDEX.md)
---

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
)
```

Generate random 3-D unit locations subject to margin, z-range, and pairwise minimum-distance constraints.

Parameters:
- `num_units` (int).
- `channel_locations` (np.ndarray): `(num_channels, 2)`.
- `margin_um` (float, default 20.0).
- `minimum_z` (float, default 5.0).
- `maximum_z` (float, default 40.0).
- `minimum_distance` (float, default 20.0).
- `max_iteration` (int, default 100).
- `distance_strict` (bool, default False): If True and the constraint cannot be met, raise; else warn.
- `distribution` (Literal, default `"uniform"`): one of `"uniform"`, `"multimodal"`. `"uniform"` spreads units evenly; `"multimodal"` mimics a "by layer" distribution along the y axis (dim=1).
- `num_modes` (int, default 2): Number of modes/layers when `distribution="multimodal"`.
- `seed` (int | None, default None).

Returns array of shape `(num_units, 3)` (x, y, z).

### `add_synchrony_to_sorting`

```python
def add_synchrony_to_sorting(sorting, sync_event_ratio=0.3, seed=None)
```

Add synchronous spike events on other units (same `sample_index`) at the given ratio. Returns a `TransformSorting` tracking the added spikes.

Parameters:
- `sorting` (BaseSorting).
- `sync_event_ratio` (float, default 0.3): Ratio of added synchronous spikes vs. total spikes.
- `seed` (int | None, default None).

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
)
```

Generate spike trains with random firings for a single segment. Returns `(times, labels)` numpy arrays sorted by time.

Parameters:
- `num_units` (int, default 20).
- `sampling_frequency` (float, default 30000.0).
- `duration` (float, default 60): Segment duration in seconds.
- `refractory_period_ms` (float, default 4.0).
- `firing_rates` (float | list[float] | np.ndarray | tuple, default 3.0): Scalar, per-unit vector, or `(lim0, lim1)` uniform range.
- `add_shift_shuffle` (bool, default False): If True, jitters half of the spikes to flatten the autocorrelogram less.
- `seed` (int | None, default None).

### `inject_some_duplicate_units`

```python
def inject_some_duplicate_units(sorting, num=4, max_shift=5, ratio=None, seed=None)
```

Add `num` duplicated units to `sorting`, each with a random small sample shift up to `max_shift` and an optional subsample `ratio` of spikes kept.

Parameters:
- `sorting` (BaseSorting).
- `num` (int, default 4).
- `max_shift` (int, default 5).
- `ratio` (float | None, default None).
- `seed` (int | None, default None).

### `inject_some_split_units`

```python
def inject_some_split_units(sorting, split_ids: list, num_split=2, output_ids=False, seed=None)
```

Split the specified `split_ids` units into `num_split` parts.

Parameters:
- `sorting` (BaseSorting).
- `split_ids` (list): Unit ids to split.
- `num_split` (int, default 2).
- `output_ids` (bool, default False): If True, also return the mapping of new unit ids.
- `seed` (int | None, default None).

### `synthetize_spike_train_bad_isi`

```python
def synthetize_spike_train_bad_isi(duration, baseline_rate, num_violations, violation_delta=1e-5)
```

Generate a spike train with `num_violations` refractory-period violations spaced by `violation_delta`.

Parameters:
- `duration` (float): Duration in seconds.
- `baseline_rate` (float): Baseline firing rate in Hz.
- `num_violations` (int).
- `violation_delta` (float, default 1e-5): Delta between violating spikes in seconds.

### `MockRecording`

Lazy recording that generates unit-variance white noise on demand by tiling a pre-generated block. Intended for lightweight infrastructure testing; use `NoiseGeneratorRecording` when you need correlated noise or per-channel std.

```python
class MockRecording(BaseRecording):
    def __init__(
        self,
        num_channels: int,
        sampling_frequency: float,
        durations: list[float],
        dtype: np.dtype | str | None = "float32",
        seed: int | None = None,
        strategy: Literal["tile_pregenerated", "on_the_fly"] = "tile_pregenerated",
        noise_block_size: int = 30000,
    )
```

Parameters:
- `num_channels` (int).
- `sampling_frequency` (float).
- `durations` (list[float]): Per-segment durations.
- `dtype` (np.dtype | str | None, default `"float32"`): Only `"float32"` or `"float64"` allowed.
- `seed` (int | None, default None).
- `strategy` (Literal, default `"tile_pregenerated"`): one of `"tile_pregenerated"`, `"on_the_fly"`.
- `noise_block_size` (int, default 30000): Block size in samples for the pre-generated noise.

### `InjectTemplatesRecording`

Recording that injects templates at spike times, optionally on top of a parent recording.

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
    ) -> None
```

Parameters:
- `sorting` (BaseSorting).
- `templates` (np.ndarray): Shape `(num_units, num_samples, num_channels)` (standard) or `(num_units, num_samples, num_channels, upsample_factor)` (with jitter).
- `nbefore` (list[int] | int | None, default None): If None, aligns to the largest absolute peak across templates.
- `amplitude_factor` (list[float] | float | None, default None): Per-spike amplitude scaling; scalar or vector matching the spike vector shape.
- `parent_recording` (BaseRecording | None, default None): If None, traces default to zeros.
- `num_samples` (list[int] | int | None, default None): Required if `parent_recording is None`.
- `upsample_vector` (np.ndarray | None, default None): Per-spike jitter index in `[0, upsample_factor)`. Only used when templates are 4-D.
- `check_borders` (bool, default False): If True, verify template border samples are zero.

Notable attributes: `templates`, `spike_vector`.

### `inject_templates`

```python
inject_templates = define_function_from_class(source_class=InjectTemplatesRecording, name="inject_templates")
```

Factory function alias with the same signature as `InjectTemplatesRecording.__init__`.
