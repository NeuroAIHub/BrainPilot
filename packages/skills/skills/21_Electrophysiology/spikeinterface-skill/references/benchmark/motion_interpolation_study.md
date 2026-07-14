# MotionInterpolationStudy

Source in repo: `spikeinterface/src/spikeinterface/benchmark/benchmark_motion_interpolation.py`
Parent index: [INDEX.md](INDEX.md)
---

## MotionInterpolationStudy

Located in `benchmark_motion_interpolation.py`. Compares a sorter's accuracy on the same underlying units when the input recording is either static, drifting-uncorrected, or drifting-corrected (motion-interpolated).

### `MotionInterpolationBenchmark`

```python
class MotionInterpolationBenchmark(Benchmark):
    def __init__(
        self, static_recording, gt_sorting, params, sorter_folder,
        drifting_recording, motion, temporal_bins, spatial_bins,
    ):
        ...

    def run(self, **job_kwargs):
        if self.params["recording_source"] == "static":
            recording = self.static_recording
        elif self.params["recording_source"] == "drifting":
            recording = self.drifting_recording
        elif self.params["recording_source"] == "corrected":
            recording = InterpolateMotionRecording(
                self.drifting_recording, self.motion,
                **self.params["correct_motion_kwargs"],
            )
        else:
            raise ValueError("recording_source")

        sorting = run_sorter(
            self.params["sorter_name"], recording,
            folder=self.sorter_folder, **self.params["sorter_params"],
            delete_output_folder=False,
        )
        self.result["sorting"] = sorting

    def compute_result(self, exhaustive_gt=True, merging_score=0.2): ...

    _run_key_saved = [("sorting", "sorting")]
    _result_key_saved = [
        ("comparison", "pickle"),
        ("accuracy", "npy"),
        ("comparison_merged", "pickle"),
        ("accuracy_merged", "npy"),
    ]
```

The critical string literal:

* `params["recording_source"]` must be one of exactly three values, all case-sensitive:
    * `"static"` — use the static (non-drifting) recording.
    * `"drifting"` — use the raw drifting recording.
    * `"corrected"` — build an `InterpolateMotionRecording` and use that. `params["correct_motion_kwargs"]` supplies the interpolation kwargs.

Any other value raises `ValueError("recording_source")`.

`params["sorter_name"]` is any sorter name accepted by `spikeinterface.sorters.run_sorter`; `params["sorter_params"]` is expanded into that call.

### `MotionInterpolationStudy`

```python
class MotionInterpolationStudy(BenchmarkStudy):

    benchmark_class = MotionInterpolationBenchmark

    def create_benchmark(self, key): ...

    def plot_sorting_accuracy(
        self,
        case_keys=None,
        mode="ordered_accuracy",
        legend=True,
        colors=None,
        mode_best_merge=False,
        figsize=(10, 5),
        ax=None,
        axes=None,
    ):
        """
        Parameters
        ----------
        mode : {"ordered_accuracy", "depth_snr", "snr", "depth"}
            Plot layout to use.
        mode_best_merge : bool, default False
            If False, use `result["accuracy"]`; if True, use `result["accuracy_merged"]`.
        """
```

`plot_sorting_accuracy(mode=...)` is a string literal with exactly four accepted values:

* `"ordered_accuracy"` (default) — one axis, curves of accuracy sorted decreasingly.
* `"depth_snr"` — one row per case, scatter of `(depth, snr)` coloured by accuracy, with a shared colourbar.
* `"snr"` — one axis, scatter of `(snr, accuracy)`.
* `"depth"` — one axis, scatter of `(depth, accuracy)` with dashed lines at min/max channel `y`.
