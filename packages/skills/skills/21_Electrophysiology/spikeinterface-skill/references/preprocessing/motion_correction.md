# Motion correction
Source in repo: `spikeinterface/src/spikeinterface/preprocessing/motion.py`
Parent index: [INDEX.md](INDEX.md)
---

## Motion correction

### correct_motion

High-level driver: detects peaks, (optionally) subsamples, localizes, estimates
motion, and returns an `InterpolateMotionRecording`. Should run **after**
filtering/denoising and **before** whitening. If the recording is not float, it is
cast to `float32`.

```python
correct_motion(
    recording: BaseRecording,
    preset: Literal[
        "dredge",
        "medicine",
        "dredge_fast",
        "nonrigid_accurate",
        "nonrigid_fast_and_accurate",
        "rigid_fast",
        "kilosort_like",
    ] = "dredge_fast",
    folder: str | Path | None = None,
    output_motion: bool = False,
    output_motion_info: bool = False,
    overwrite: bool = False,
    detect_kwargs: dict = {},
    select_kwargs: dict = {},
    localize_peaks_kwargs: dict = {},
    estimate_motion_kwargs: dict = {},
    interpolate_motion_kwargs: dict = {},
    **job_kwargs,
)
```

Return types:

- default → `recording_corrected`
- `output_motion=True` → `(recording_corrected, motion)`
- `output_motion_info=True` → `(recording_corrected, motion_info)`
- both True → `(recording_corrected, motion, motion_info)`

### compute_motion

Same as `correct_motion` but stops before applying the interpolation. Returns
`motion` (or `(motion, motion_info)` if `output_motion_info=True`).

```python
compute_motion(
    recording: BaseRecording,
    preset: Literal[
        "dredge",
        "medicine",
        "dredge_fast",
        "nonrigid_accurate",
        "nonrigid_fast_and_accurate",
        "rigid_fast",
        "kilosort_like",
    ] = "dredge_fast",
    detect_kwargs: dict = {},
    select_kwargs: dict = {},
    localize_peaks_kwargs: dict = {},
    estimate_motion_kwargs: dict = {},
    output_motion_info: bool = False,
    folder: str | Path | None = None,
    overwrite: bool = False,
    raise_error: bool = True,
    **job_kwargs,
) -> dict
```

### get_motion_presets

Returns the list of preset names (excluding the empty `""` sentinel):

```python
get_motion_presets()
# ['dredge', 'medicine', 'dredge_fast', 'nonrigid_accurate',
#  'nonrigid_fast_and_accurate', 'rigid_fast', 'kilosort_like']
```

**All motion presets** (from `motion_options_preset` in `motion.py`):

| Preset | `doc` field / summary |
| --- | --- |
| `dredge` | "Official Dredge preset". detect=`locally_exclusive` (neg, thr=8.0, sweep=0.8 ms, radius=80.0), localize=`monopolar_triangulation`, estimate=`dredge_ap` (nonrigid, `win_shape="gaussian"`, `win_step_um=400`, `win_scale_um=400`), interpolate=`kriging` with `border_mode="force_extrapolate"`. |
| `medicine` | "Medicine method: https://jazlab.github.io/medicine/". detect=`locally_exclusive`, localize=`monopolar_triangulation`, estimate=`medicine`, interpolate=defaults. |
| `dredge_fast` | "Modified and faster Dredge preset". Same as `dredge` but localize=`grid_convolution`. **Default preset.** |
| `nonrigid_accurate` | "method by Paninski lab (monopolar_triangulation + decentralized)". estimate=`decentralized` (nonrigid), interpolate with `border_mode="remove_channels"`. |
| `nonrigid_fast_and_accurate` | "mixed methods by KS & Paninski lab (grid_convolution + decentralized)". |
| `rigid_fast` | "Rigid and not super accurate but fast. Use center of mass." detect radius=75, localize=`center_of_mass`, estimate=`dredge_ap` (`bin_s=5.0`, `rigid=True`). |
| `kilosort_like` | "Mimic the drift correction of kilosort (grid_convolution + iterative_template)". detect radius=50, localize=`grid_convolution` with a gaussian_2d weight scheme, estimate=`iterative_template` (`bin_s=2.0`, `win_step_um=200`, `win_scale_um=400`, `hist_margin_um=0`, `win_shape="rect"`). |

### get_motion_parameters_preset

Returns the full nested-dict of parameters for a given preset (with defaults resolved
from the underlying detection/localization/motion-estimation classes).

```python
get_motion_parameters_preset(preset)   # e.g. get_motion_parameters_preset("dredge")
```

### save_motion_info

```python
save_motion_info(motion_info, folder, overwrite=False)
```

Writes `parameters.json`, `run_times.json`, `peaks.npy`, `peak_locations.npy`, and
`motion/` (via `Motion.save`).

### load_motion_info

```python
load_motion_info(folder)
```

Loads a motion-info dict from a folder (backward-compatible with the legacy on-disk
format `spatial_bins.npy` / `temporal_bins.npy` / `motion.npy`).
