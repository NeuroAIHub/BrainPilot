# Motion — peak helpers and motion_utils

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/motion/`
Parent index: [../INDEX.md](../INDEX.md)

---

### `compute_peak_displacements`

```python
from spikeinterface.sortingcomponents.motion import compute_peak_displacements

compute_peak_displacements(peaks, motion, recording, peak_locations=None)
```

Returns per-peak displacement (float32 array). Requires `recording` not
`None`.

### `correct_motion_on_peaks`

```python
from spikeinterface.sortingcomponents.motion import correct_motion_on_peaks

correct_motion_on_peaks(peaks, peak_locations, motion, recording) -> np.ndarray
```

Applies the inverse motion to `peak_locations[motion.direction]` and returns
the corrected copy.

### `clean_motion_vector`

```python
from spikeinterface.sortingcomponents.motion import clean_motion_vector

clean_motion_vector(
    motion,
    temporal_bins,
    bin_duration_s,
    speed_threshold=30,
    sigma_smooth_s=None,
)
```

- `speed_threshold : float`, default `30` (um/s).
- `sigma_smooth_s : float | None`, default `None`.

### `motion_utils` helpers

Building blocks used by the estimators, all in
`spikeinterface.sortingcomponents.motion.motion_utils`:

- `get_spatial_windows(...)` — build non-rigid window functions along depth.
- `get_rigid_windows(spatial_bin_centers)`
- `get_window_domains(windows)`
- `scipy_conv1d(input, weights, padding="valid")`
- `get_spatial_bin_edges(recording, direction, hist_margin_um, bin_um)`
- `make_2d_motion_histogram(...)`
- `make_3d_motion_histograms(...)`
