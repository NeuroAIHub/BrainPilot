# Template Metrics — Part B (multi-channel classes + get_* funcs up to waveform_widths)
Source in repo: `spikeinterface/src/spikeinterface/metrics/template/metrics.py`
Parent index: [../INDEX.md](../INDEX.md)
---

### 2.5 Multi-channel template metric classes

Registered list:

```python
multi_channel_metrics = [
    VelocityFits,
    ExpDecay,
    Spread,
]
```

So `get_multi_channel_template_metric_names()` returns `["velocity_fits", "exp_decay", "spread"]`. All need `sorting_analyzer` **not sparse** (or per-unit sparsity mask providing enough channels — a warning is raised when a unit has fewer than `MIN_SPARSE_CHANNELS_FOR_MULTI_CHANNEL_WARNING = 10` channels). The `templates` extension is required. `metric_function` on all three multi-channel classes injects `metric_params["depth_direction"] = tmp_data["depth_direction"]` before calling the underlying `get_*` function.

#### `VelocityFits`
- `metric_name = "velocity_fits"`
- `metric_params = {"min_channels": 3, "min_r2": 0.2, "column_range": None}`
- `metric_columns = {"velocity_above": float, "velocity_below": float}`
- `metric_descriptions`:
  - `"velocity_above": "Velocity of the spike propagation above the max channel in µm/ms"`
  - `"velocity_below": "Velocity of the spike propagation below the max channel in µm/ms"`
- `needs_tmp_data = True`
- `deprecated_names = ["velocity_above", "velocity_below"]`
- Returns a namedtuple `Velocities(velocity_above, velocity_below)`.
- Underlying function: `get_velocity_fits(template, channel_locations, sampling_frequency, **metric_params)`

#### `ExpDecay`
- `metric_name = "exp_decay"`
- `metric_params`:
  ```python
  {
      "peak_function": "ptp",         # Literal: "ptp" | "min"  (any other value falls back to np.ptp)
      "min_r2": 0.2,
      "linear_fit": False,
      "channel_tolerance": None,      # None -> old style (all channels); e.g. 33 -> bombcell-style x-tolerance
      "min_channels_for_fit": None,   # None -> default 5 for linear, 8 for exp
      "num_channels_for_fit": None,   # None -> default 6 for linear, 10 for exp
      "normalize_decay": False,
  }
  ```
- `metric_columns = {"exp_decay": float}`
- `metric_descriptions = {"exp_decay": "Spatial decay of the template amplitude over distance from the extremum channel (1/um). Uses exponential or linear fit based on linear_fit parameter."}`
- `needs_tmp_data = True`
- Underlying function: `get_exp_decay(template, channel_locations, sampling_frequency, **metric_params)`

#### `Spread`
- `metric_name = "spread"`
- `metric_params = {"spread_threshold": 0.2, "spread_smooth_um": 20, "column_range": None}`
- `metric_columns = {"spread": float}`
- `metric_descriptions = {"spread": "Spread of the template amplitude in µm, calculated as the distance between channels whose templates exceed the spread_threshold."}`
- `needs_tmp_data = True`
- Underlying function: `get_spread(template, channel_locations, sampling_frequency, **metric_params)`

### 2.6 Underlying `get_*` metric functions

Defined in `template/metrics.py`. These are the raw, template-level functions the metric classes call for each unit. All accept `**kwargs` matching the metric class's `metric_params`.

#### `get_peak_to_trough_duration`

```python
def get_peak_to_trough_duration(peaks_info, sampling_frequency, **kwargs) -> float:
    """
    Return the duration in seconds between the main trough and the main peak after the trough
    of input waveforms.

    The function assumes that the trough comes before the peak.

    Parameters
    ----------
    peaks_info : dict
        Peaks and troughs detection results from get_trough_and_peak_idx
    sampling_frequency : float
        The sampling frequency of the template

    Returns
    -------
    pt_duration: float
        The duration in seconds between the main trough and the main peak after the trough
    """
```

Meaning: `(peaks_info["peak_after_index"] - peaks_info["trough_index"]) / sampling_frequency`. Returns `np.nan` if either index is `None`.

#### `get_half_widths`

```python
def get_half_widths(main_channel_template, sampling_frequency, peaks_info, **kwargs) -> tuple[float, float]:
    """
    Return the half width of the main trough and main peak in seconds.

    Parameters
    ----------
    main_channel_template: numpy.ndarray
        The 1D template waveform
    sampling_frequency : float
        The sampling frequency of the template
    peaks_info : dict
        Peaks and troughs detection results from get_trough_and_peak_idx

    Returns
    -------
    hw: tuple[float, float]
        The half width in seconds of (trough, peak)
    """
```

Half-width is computed via the internal `_compute_halfwidth(template, extremum_index, sampling_frequency)` helper — the width at 50 % amplitude (assuming zero baseline). For the trough the waveform is inverted first; for the peak, the larger of `peak_after` / `peak_before` is used.

#### `get_repolarization_slope`

```python
def get_repolarization_slope(main_channel_template, sampling_frequency, peaks_info, **kwargs):
    """
    Return slope of repolarization period between trough and baseline.

    After reaching it's maximum polarization, the neuron potential will
    recover. The repolarization slope is defined as the dV/dT of the action potential
    between trough and baseline. The returned slope is in units of (unit of template)
    per second. By default traces are scaled to units of µV, controlled
    by `sorting_analyzer.return_in_uV`. In this case this function returns the slope
    in µV/s.

    Parameters
    ----------
    main_channel_template: numpy.ndarray
        The 1D template waveform
    sampling_frequency : float
        The sampling frequency of the template
    peaks_info: dict
        Peaks and troughs detection results from get_trough_and_peak_idx

    Returns
    -------
    slope: float
        The repolarization slope
    """
```

Uses `scipy.stats.linregress` over samples from `trough_index` up to the first return-to-baseline (`main_channel_template >= 0`). Returns `np.nan` if `trough_index` is `None`/`0`, no return to baseline is found, or the window is < 3 samples.

#### `get_recovery_slope`

```python
def get_recovery_slope(main_channel_template, sampling_frequency, peaks_info, **kwargs):
    """
    Return the recovery slope between the main peak after the trough and baseline.

    After repolarization, the neuron hyperpolarizes until it peaks. The recovery slope is the
    slope of the action potential after the peak, returning to the baseline
    in dV/dT. The returned slope is in units of (unit of template)
    per second. By default traces are scaled to units of µV, controlled
    by `sorting_analyzer.return_in_uV`. In this case this function returns the slope
    in µV/s. The slope is computed within a user-defined window after the peak.

    Parameters
    ----------
    main_channel_template: numpy.ndarray
        The 1D template waveform
    sampling_frequency : float
        The sampling frequency of the template
    peaks_info: dict
        The index of the peak after the trough
    **kwargs: Required kwargs:
        - recovery_window_ms: the window in ms after the peak to compute the recovery_slope

    Returns
    -------
    res.slope: float
        The recovery slope
    """
```

Asserts `"recovery_window_ms" in kwargs`. Default from `RecoverySlope.metric_params` is `0.7`.

#### `get_number_of_peaks`

```python
def get_number_of_peaks(peaks_info, **kwargs):
    """
    Count the total number of peaks (positive) and troughs (negative) in the template.

    Uses the pre-computed peak/trough detection from get_trough_and_peak_idx.

    Parameters
    ----------
    peaks_info: dict
        Peaks and troughs detection results from get_trough_and_peak_idx

    Returns
    -------
    num_positive_peaks : int
        The number of positive peaks (peaks_before + peaks_after)
    num_negative_peaks : int
        The number of negative peaks (troughs)
    """
```

Computed as `num_positive = len(peaks_info["peak_before_sample_indices"]) + len(peaks_info["peak_after_sample_indices"])`, `num_negative = len(peaks_info["trough_sample_indices"])`.

#### `get_main_to_next_extremum_duration`

```python
def get_main_to_next_extremum_duration(template, peaks_info, sampling_frequency, **kwargs):
    """
    Calculate duration from the main extremum to the next extremum.

    The duration is measured from the largest absolute feature (main trough or main peak)
    to the next extremum. For typical negative-first waveforms, this is trough-to-peak.
    For positive-first waveforms, this is peak-to-trough.

    Parameters
    ----------
    template : numpy.ndarray
        The 1D template waveform
    peaks_info : dict
        Peaks and troughs detection results from get_trough_and_peak_idx
    sampling_frequency : float
        The sampling frequency in Hz

    Returns
    -------
    main_to_next_extremum_duration : float
        Duration in seconds from main extremum to next extremum
    """
```

Returns `np.nan` when no candidate extremum pair is available.

#### `get_waveform_ratios`

```python
def get_waveform_ratios(template, peaks_info, **kwargs):
    """
    Calculate various waveform amplitude ratios.

    Parameters
    ----------
    template : numpy.ndarray
        The 1D template waveform
    peaks_info : dict
        Peaks and troughs detection results from get_trough_and_peak_idx

    Returns
    -------
    ratios : dict
        Dictionary containing:
        - "peak_before_to_trough_ratio": ratio of peak before to trough amplitude
        - "peak_after_to_trough_ratio": ratio of peak after to trough amplitude
        - "peak_before_to_peak_after_ratio": ratio of peak before to peak after amplitude
        - "main_peak_to_trough_ratio": ratio of larger peak to trough amplitude
    """
```

All values use absolute amplitudes. Internal `safe_ratio(a, b)` returns `np.nan` for zero/NaN denominator. `main_peak_to_trough_ratio` uses `max(peak_before_amp, peak_after_amp) / trough_amp` (falling back to `np.nan` if both are NaN).

#### `get_waveform_widths`

```python
def get_waveform_widths(peaks_info, sampling_frequency, **kwargs):
    """
    Get the widths of the main trough and peaks in seconds.

    Parameters
    ----------
    peaks_info : dict
        Peaks and troughs detection results from get_trough_and_peak_idx
    sampling_frequency : float
        The sampling frequency in Hz

    Returns
    -------
    widths : dict
        Dictionary containing:
        - "trough_width": width of main trough in seconds
        - "peak_before_width": width of main peak before trough in seconds
        - "peak_after_width": width of main peak after trough in seconds
    """
```

Converts the `*_width` values (in samples) from `peaks_info` to seconds via multiplication by `1.0 / sampling_frequency`.
