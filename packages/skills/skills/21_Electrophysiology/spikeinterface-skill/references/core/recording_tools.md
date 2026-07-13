# Recording Tools — recording_tools.py
Source in repo: `spikeinterface/src/spikeinterface/core/recording_tools.py`
Parent index: [INDEX.md](INDEX.md)
Related: [core_tools.md](core_tools.md), [job_tools.md](job_tools.md), [base_recording_b.md](base_recording_b.md)
---

## 8. Recording Tools — `recording_tools.py`

### `get_channel_distances`

```python
def get_channel_distances(recording):
```
Returns a 2-D array of pairwise channel distances.

### `get_closest_channels`

```python
def get_closest_channels(recording, channel_ids=None, num_channels=None):
```
Returns `(closest_channels_inds, dists)` as 2-D arrays.

### `get_noise_levels`

```python
def get_noise_levels(
    recording: "BaseRecording",
    return_scaled: bool | None = None,
    return_in_uV: bool = True,
    method: Literal["mad", "std", "rms"] = "mad",
    force_recompute: bool = False,
    random_slices_kwargs: dict = {},
    **kwargs,
) -> np.ndarray:
```
- `method`: `"mad"` | `"std"` | `"rms"`
- `return_scaled` is deprecated, use `return_in_uV`.
- Result is cached in the recording's property store under key `f"noise_level_{method}_{'scaled' if return_in_uV else 'raw'}"`. Pass `force_recompute=True` to recompute.
- `**kwargs` are split into `random_slices_kwargs_` and `job_kwargs` (backward-compat handling).

### `get_random_data_chunks`

```python
def get_random_data_chunks(
    recording, return_scaled=None, return_in_uV=False, concatenated=True, **random_slices_kwargs
):
```
Uses `get_random_sample_slices()` internally. `**random_slices_kwargs` are forwarded (e.g., `num_chunks_per_segment=20`, `chunk_size=...`).

### `get_chunk_with_margin`

```python
def get_chunk_with_margin(
    rec_segment,
    start_frame,
    end_frame,
    channel_indices,
    margin,
    add_zeros=False,
    add_reflect_padding=False,
    window_on_margin=False,
    dtype=None,
):
```
Thin backward-compat wrapper delegating to `get_time_series_chunk_with_margin`.

### `order_channels_by_depth`

```python
def order_channels_by_depth(recording, channel_ids=None, dimensions=("x", "y"), flip=False):
```
- `dimensions`: either a string in `"x"`, `"y"`, `"z"`, or a tuple/list of such strings (default `("x", "y")`).
- Returns `(order_f, order_r)`.

Note: the public signature takes `channel_ids` (which the ticket omitted); the callable order is `(recording, channel_ids=None, dimensions=("x", "y"), flip=False)`.

### Additional helpers in `recording_tools.py`

The following live in `spikeinterface.core.recording_tools`. Only `write_to_h5_dataset_format` is re-exported from `spikeinterface.core.__init__`; the others must be imported from `spikeinterface.core.recording_tools`.

- `read_binary_recording(file, num_channels, dtype, time_axis=0, offset=0)` — returns a `np.memmap`.
- `write_binary_file_handle(recording, file_handle=None, time_axis=0, dtype=None, byte_offset=0, verbose=False, **job_kwargs)`
- `write_to_h5_dataset_format(recording, dataset_path, segment_index, save_path=None, file_handle=None, time_axis=0, single_axis=False, dtype=None, chunk_size=None, chunk_memory="500M", verbose=False, return_scaled=None, return_in_uV=False)` — re-exported from `spikeinterface.core`.
- `get_rec_attributes(recording)` — dict with `channel_ids`, `sampling_frequency`, `num_channels`, `num_samples`, `is_filtered`, `properties`, `dtype`.
- `do_recording_attributes_match(recording1: "BaseRecording", recording2_attributes: bool, check_dtype: bool = True) -> tuple[bool, str]`.
- `check_probe_do_not_overlap(probes)`
- `_set_group_property_based_on_probegroup(recording, probegroup: ProbeGroup, group_mode: Literal["auto", "by_probe", "by_shank", "by_side"])` — `group_mode`: `"auto"` | `"by_probe"` | `"by_shank"` | `"by_side"`.
