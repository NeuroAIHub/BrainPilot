# MotionEstimationStudy

Source in repo: `spikeinterface/src/spikeinterface/benchmark/benchmark_motion_estimation.py`
Parent index: [INDEX.md](INDEX.md)
---

## MotionEstimationStudy

Located in `benchmark_motion_estimation.py`.

### Free function

```python
def get_gt_motion_from_unit_displacement(
    unit_displacements,
    displacement_sampling_frequency,
    unit_locations,
    temporal_bins_s,
    spatial_bins_um,
    direction_dim=1,
):
    """
    Build a `Motion` object holding the ground-truth motion by interpolating
    the per-unit displacements into the temporal/spatial bins that the tested
    estimator produced.
    """
```

### `MotionEstimationBenchmark`

```python
class MotionEstimationBenchmark(Benchmark):
    def __init__(
        self, recording, gt_sorting, params,
        unit_locations, unit_displacements,
        displacement_sampling_frequency, direction="y",
    ):
        ...
        self.direction_dim = ["x", "y"].index(direction)

    def run(self, **job_kwargs):
        p = self.params
        noise_levels = get_noise_levels(self.recording, return_in_uV=False, **job_kwargs)
        detect_kwargs = p["detect_kwargs"].copy()
        detect_kwargs["noise_levels"] = noise_levels
        peaks = detect_peaks(self.recording, method_kwargs=detect_kwargs, job_kwargs=job_kwargs)
        if p["select_kwargs"] is not None:
            selected_peaks = select_peaks(self.peaks, **p["select_kwargs"], **job_kwargs)
        else:
            selected_peaks = peaks
        peak_locations = localize_peaks(
            self.recording, selected_peaks,
            method_kwargs=p["localize_kwargs"], job_kwargs=job_kwargs,
        )
        motion = estimate_motion(
            self.recording, selected_peaks, peak_locations,
            **p["estimate_motion_kwargs"],
        )
        ...
        self.result["peaks"] = peaks
        self.result["peak_locations"] = peak_locations
        self.result["step_run_times"] = step_run_times
        self.result["raw_motion"] = motion

    def compute_result(self, **result_params): ...

    _run_key_saved = [
        ("peaks", "npy"),
        ("peak_locations", "npy"),
        ("raw_motion", "Motion"),
        ("step_run_times", "pickle"),
    ]
    _result_key_saved = [
        ("gt_motion", "Motion"),
        ("motion",    "Motion"),
    ]
```

`direction` is a string literal — only `"x"` or `"y"` are supported (used as index into `["x", "y"]`).

`params` must have the following keys:

* `detect_kwargs` — kwargs forwarded to `detect_peaks`.
* `select_kwargs` — kwargs for `select_peaks`, or `None` to skip peak selection.
* `localize_kwargs` — kwargs for `localize_peaks`.
* `estimate_motion_kwargs` — kwargs for `estimate_motion`.

### `MotionEstimationStudy`

```python
class MotionEstimationStudy(BenchmarkStudy):
    """
    Benchmark study to compare motion estimation methods.

    The ground truth displacements of all units must be known and method outputs
    will be compared to them.

    See also `spikeinterface.generation.generate_drifting_recording` for
    generating drifting recordings.
    """

    benchmark_class = MotionEstimationBenchmark

    def create_benchmark(self, key): ...

    def plot_true_drift(self, case_keys=None, scaling_probe=1.5, figsize=(8, 6)): ...
    def plot_drift(
        self, case_keys=None, gt_drift=True, tested_drift=True,
        raster=False, scaling_probe=1.0, figsize=(8, 6),
    ): ...
    def plot_errors(self, case_keys=None, figsize=None, lim=None): ...
    def plot_summary_errors(self, case_keys=None, show_legend=True, figsize=(15, 5)): ...
```
