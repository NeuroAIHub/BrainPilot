# Noise tools (`noise_tools.py`)
Source in repo: `spikeinterface/src/spikeinterface/generation/noise_tools.py`
Parent index: [INDEX.md](INDEX.md)
---

### `generate_noise`

```python
def generate_noise(
    probe,
    sampling_frequency,
    durations,
    dtype="float32",
    noise_levels=15.0,
    spatial_decay=None,
    seed=None,
)
```

Parameters:
- `probe` (Probe): Probe object; number of channels is taken from `probe.get_contact_count()`.
- `sampling_frequency` (float).
- `durations` (list[float]): One entry per segment.
- `dtype` (np.dtype, default `"float32"`).
- `noise_levels` (float | np.ndarray | tuple, default 15.0): Scalar for common noise, array for per-channel, tuple `(lim0, lim1)` for a random per-channel uniform range.
- `spatial_decay` (float | None, default None): If not None, builds an exponential spatial covariance `exp(-distance / spatial_decay)`.
- `seed` (int | None, default None).

Returns a `NoiseGeneratorRecording` with `strategy="on_the_fly"`.

### `NoiseGeneratorRecording`

Lazy noise recording that generates chunks on demand.

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
    )
```

Parameters:
- `num_channels` (int).
- `sampling_frequency` (float).
- `durations` (list[float]): Per-segment durations.
- `noise_levels` (float | np.ndarray, default 1.0): Per-channel std.
- `cov_matrix` (np.ndarray | None, default None): `(num_channels, num_channels)` covariance for correlated noise.
- `dtype` (np.dtype | str | None, default `"float32"`): Only `"float32"` or `"float64"` are allowed; anything else raises `ValueError`.
- `seed` (int | None, default None).
- `strategy` (Literal, default `"tile_pregenerated"`): one of `"tile_pregenerated"`, `"on_the_fly"`.
  - `"tile_pregenerated"`: pregenerate a noise chunk of `noise_block_size` samples and repeat it (fast, single block memory).
  - `"on_the_fly"`: regenerate each block by combining `seed + block_index` (no preallocation, more compute).
- `noise_block_size` (int, default 30000): Block size in samples.

### `noise_generator_recording`

Alias created via:

```python
noise_generator_recording = define_function_from_class(
    source_class=NoiseGeneratorRecording, name="noise_generator_recording"
)
```

Behaves as a factory function with the same signature as `NoiseGeneratorRecording.__init__`.
