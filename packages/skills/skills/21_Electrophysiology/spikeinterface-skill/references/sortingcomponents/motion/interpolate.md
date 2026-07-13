# Motion — interpolate_motion and InterpolateMotionRecording

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/motion/motion_interpolation.py`
Parent index: [../INDEX.md](../INDEX.md)

---

### `interpolate_motion` and `InterpolateMotionRecording`

`interpolate_motion` is a functional alias generated via
`define_function_handling_dict_from_class(InterpolateMotionRecording,
name="interpolate_motion")`. Same parameters as the class:

```python
InterpolateMotionRecording(
    recording,
    motion,
    border_mode="remove_channels",
    spatial_interpolation_method="kriging",
    sigma_um=20.0,
    p=1,
    num_closest=3,
    interpolation_time_bin_centers_s=None,
    interpolation_time_bin_edges_s=None,
    interpolation_time_bin_size_s=None,
    dtype=None,
    **spatial_interpolation_kwargs,
)
```

Class attribute: `name = "interpolate_motion"`.

- `border_mode : "remove_channels" | "force_extrapolate" | "force_zeros"`,
  default `"remove_channels"` — handled with explicit `elif` branches in the
  source; any other value raises `ValueError("Wrong border_mode")`.
- `spatial_interpolation_method : "kriging" | "idw" | "nearest"`, default
  `"kriging"`.
- `sigma_um : float`, default `20.0` — kriging kernel width.
- `p : int`, default `1` — kriging kernel exponent.
- `num_closest : int`, default `3` — number of channels used by `"idw"`.
- `interpolation_time_bin_centers_s`, default `None`.
- `interpolation_time_bin_edges_s`, default `None`.
- `interpolation_time_bin_size_s`, default `None`.
- `dtype : str | np.dtype | None`, default `None`.
- `**spatial_interpolation_kwargs` forwarded to
  `interpolate_motion_on_traces`.

### `interpolate_motion_on_traces`

```python
from spikeinterface.sortingcomponents.motion import interpolate_motion_on_traces

interpolate_motion_on_traces(
    traces,
    times,
    channel_locations,
    motion,
    segment_index=None,
    channel_inds=None,
    interpolation_time_bin_centers_s=None,
    interpolation_time_bin_edges_s=None,
    spatial_interpolation_method="kriging",
    spatial_interpolation_kwargs={},
    dtype=None,
)
```

- `spatial_interpolation_method : "idw" | "kriging"`, default `"kriging"`
  (only these two are documented in this function's docstring).
- Returns `traces_corrected` with shape `(num_samples, num_channels)` (or
  `(num_samples, len(channel_inds))` when `channel_inds is not None`).
