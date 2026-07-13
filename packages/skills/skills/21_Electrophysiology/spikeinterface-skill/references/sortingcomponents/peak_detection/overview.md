# Peak detection — overview

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/peak_detection/`
Parent index: [../INDEX.md](../INDEX.md)

---

## Peak detection

Module: `spikeinterface.sortingcomponents.peak_detection`.
The `__init__.py` re-exports:

- `detect_peak_methods` (from `.method_list`)
- `detect_peaks` (from `.main`)

### `detect_peaks`

```python
from spikeinterface.sortingcomponents.peak_detection import detect_peaks

detect_peaks(
    recording,
    method=None,
    method_kwargs=None,
    pipeline_kwargs=None,
    verbose=False,
    job_kwargs=None,
    **old_kwargs,
)
```

Behaviour:

- `method` must be one of the keys of `detect_peak_methods`. If `None`, the
  code warns and falls back to `"locally_exclusive"`.
- `method_kwargs` is passed to the corresponding detector class constructor.
  For flexibility, `"method"` can be embedded inside `method_kwargs`.
- `pipeline_kwargs` is forwarded to `run_node_pipeline` (`gather_mode`,
  `gather_kwargs`, `folder`, `names`, `skip_after_n_peaks`, `slices`, ...).
- For methods with class attribute `need_noise_levels = True`, if
  `"noise_levels"` is not supplied inside `method_kwargs`, it is estimated
  via `get_noise_levels()` automatically (using an optional
  `random_slices_kwargs` extracted from `method_kwargs`).
- If `method_class.preferred_mp_context is not None`, that context is
  injected into `job_kwargs["mp_context"]`.
- Returns a structured numpy array of peaks with base dtype
  `("sample_index", "channel_index", "amplitude", "segment_index", ...)`.
  Extra fields are added by some detectors (e.g. `"z"` by
  `MatchedFilteringPeakDetector`).

### Method registry (`peak_detection.method_list.detect_peak_methods`)

Exact registry keys (in order defined in `method_list.py`):

| method key | class | engine | need_noise_levels |
|---|---|---|---|
| `"locally_exclusive"` | `LocallyExclusivePeakDetector` | `"numba"` | `True` |
| `"locally_exclusive_torch"` | `LocallyExclusiveTorchPeakDetector` | `"torch"` | `True` |
| `"locally_exclusive_cl"` | `LocallyExclusiveOpenCLPeakDetector` | `"opencl"` | `True` |
| `"matched_filtering"` | `MatchedFilteringPeakDetector` | `"numba"` | `False` (computed from prototype) |
| `"by_channel"` | `ByChannelPeakDetector` | `"numpy"` | `True` |
| `"by_channel_torch"` | `ByChannelTorchPeakDetector` | `"torch"` | `True` |

Every detector inherits from `spikeinterface.core.node_pipeline.PeakDetector`.
