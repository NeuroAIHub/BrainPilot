# Template Metrics — Part C (waveform_baseline_flatness + multi-channel get_* + detection helpers)
Source in repo: `spikeinterface/src/spikeinterface/metrics/template/metrics.py`
Parent index: [../INDEX.md](../INDEX.md)
---


#### `get_waveform_baseline_flatness`

```python
def get_waveform_baseline_flatness(template, sampling_frequency, **kwargs):
    """
    Compute the baseline flatness of the waveform.

    This metric measures the max deviation of the baseline from its own mean,
    relative to the max deviation of the whole waveform from the baseline mean.
    A lower value indicates a flat baseline (expected for good units).
    Referenced to baseline mean so it works with both zero-centered and
    DC-offset data.

    Parameters
    ----------
    template : numpy.ndarray
        The 1D template waveform
    sampling_frequency : float
        The sampling frequency in Hz
    **kwargs : Required kwargs:
        - baseline_window_ms : tuple of (start_ms, end_ms) defining the baseline window
          relative to waveform start. Default is (0, 0.5) for first 0.5ms.

    Returns
    -------
    baseline_flatness : float
        Ratio of max(abs(baseline - baseline_mean)) / max(abs(template - baseline_mean)).
        Lower = flatter baseline.
    """
```

Reads `baseline_window_ms` from `kwargs`; if `None`, returns `np.nan`.

#### `get_velocity_fits`

```python
def get_velocity_fits(template, channel_locations, sampling_frequency, **kwargs):
    """
    Compute both velocity above and below the max channel of the template in units µm/ms.

    Parameters
    ----------
    template: numpy.ndarray
        The template waveform (num_samples, num_channels)
    channel_locations: numpy.ndarray
        The channel locations (num_channels, 2)
    sampling_frequency : float
        The sampling frequency of the template
    **kwargs: Required kwargs:
        - depth_direction: the direction to compute velocity above and below ("x", "y", or "z")
        - min_channels: the minimum number of channels above or below to compute velocity
        - min_r2: the minimum r2 to accept the velocity fit
        - column_range: the range in µm in the x-direction to consider channels for velocity

    Returns
    -------
    velocity_above : float
        The velocity above the max channel
    velocity_below : float
        The velocity below the max channel
    """
```

Asserted required kwargs (source): `"depth_direction"`, `"min_channels"`, `"min_r2"`, `"column_range"`. `depth_direction` accepts `"x"`, `"y"`, or `"z"` (`depth_dim = 1 if depth_direction == "y" else 0`). Uses `fit_line_robust` (Theil-Sen: median of pairwise slopes) on distance-vs-peak-time pairs.

#### `get_exp_decay`

```python
def get_exp_decay(template, channel_locations, sampling_frequency=None, **kwargs):
    """
    Compute the spatial decay of the template amplitude over distance.

    Can fit either an exponential decay (with offset) or a linear decay model. Channels are first
    filtered by x-distance tolerance from the max channel, then the closest channels
    in y-distance are used for fitting.

    Parameters
    ----------
    template: numpy.ndarray
        The template waveform (num_samples, num_channels)
    channel_locations: numpy.ndarray
        The channel locations (num_channels, 2)
    sampling_frequency : float
        The sampling frequency of the template
    **kwargs: Required kwargs:
        - peak_function: the function to use to compute the peak amplitude ("ptp" or "min")
        - min_r2: the minimum r2 to accept the fit
        - linear_fit: bool, if True use linear fit, otherwise exponential fit
        - channel_tolerance: max x-distance (um) from max channel to include channels
        - min_channels_for_fit: minimum number of valid channels required for fitting
        - num_channels_for_fit: number of closest channels to use for fitting
        - normalize_decay: bool, if True normalize amplitudes to max before fitting

    Returns
    -------
    exp_decay_value : float
        The spatial decay slope (decay constant for exp fit, negative slope for linear fit)
    """
```

Asserted required kwargs: `"peak_function"`, `"min_r2"`. `peak_function` is `Literal["ptp", "min"]` (any other value falls back to `np.ptp`). Optional kwargs (`.get(...)`): `linear_fit` (default `False`), `channel_tolerance` (default `None` -> old-style all-channels), `min_channels_for_fit` (default `None` -> 5 for linear, 8 for exp), `num_channels_for_fit` (default `None` -> 6 for linear, 10 for exp), `normalize_decay` (default `False`). Exponential model: `y = amp0 * exp(-decay * x) + offset`, with bounds `([1e-5, amp0 - 0.5*amp0, 0], [2, amp0 + 0.5*amp0, 2*offset0])`. Returns `np.nan` on `curve_fit` failure or when `r2 < min_r2`.

#### `get_spread`

```python
def get_spread(template, channel_locations, sampling_frequency, **kwargs) -> float:
    """
    Compute the spread of the template amplitude over distance in units µm/s.

    Parameters
    ----------
    template: numpy.ndarray
        The template waveform (num_samples, num_channels)
    channel_locations: numpy.ndarray
        The channel locations (num_channels, 2)
    sampling_frequency : float
        The sampling frequency of the template
    **kwargs: Required kwargs:
        - depth_direction: the direction to compute velocity above and below ("x", "y", or "z")
        - spread_threshold: the threshold to compute the spread
        - column_range: the range in µm in the x-direction to consider channels for velocity

    Returns
    -------
    spread : float
        Spread of the template amplitude
    """
```

Asserted required kwargs (source): `"depth_direction"`, `"spread_threshold"`, `"spread_smooth_um"`, `"column_range"` (the docstring above is missing `spread_smooth_um` but the code hard-asserts it). Returns `np.ptp(depth of channels whose normalized-ptp > spread_threshold)`. If `spread_smooth_um is not None and > 0`, `MM = np.ptp(template, 0)` is smoothed via `scipy.ndimage.gaussian_filter1d` with `sigma = spread_smooth_um / np.median(np.diff(np.unique(channel_depths)))`.

Multi-channel helpers used inside these functions:

```python
def transform_column_range(template, channel_locations, column_range, depth_direction="y"):
    """
    Transform template and channel locations based on column range.
    """
```

```python
def sort_template_and_locations(template, channel_locations, depth_direction="y"):
    """
    Sort template and locations.
    """
```

```python
def fit_line_robust(x, y, eps=1e-12):
    """
    Fit line using robust Theil-Sen estimator (median of pairwise slopes).
    """
```

`fit_line_robust` returns `(slope, r2_score)`, or `(np.nan, -np.inf)` when all `x` are identical.

### 2.7 Detection helpers

Exported from `metrics/template/__init__.py`:

```python
from .metrics import get_trough_and_peak_idx
```

Full signature:

```python
def get_trough_and_peak_idx(
    template,
    sampling_frequency,
    min_thresh_detect_peaks_troughs=0.4,
    edge_exclusion_ms=0.1,
    min_peak_trough_distance_ratio=0.2,
    min_extremum_distance_samples=3,
):
    """
    Detect troughs and peaks in a template waveform and return detailed information
    about each detected feature.
    Trough are defined as "minimum" points (negative peaks) and peaks as "maximum" points (positive peaks).

    The function will detect troughs first (by inverting the template and using find_peaks), then peaks before and after
    the main trough. For each detection, three attempts are made:

    1. Use the specified prominence threshold to detect peaks/troughs.
       If multiple are found, the most prominent is selected as the main extremum.
    2. If no peaks/troughs are found at the initial threshold, the threshold is halved and detection is attempted again.
       If multiple "peaks" are found at the half threshold, the most prominent is selected as the main extremum.
    3. If still no peaks/troughs are found, a last resort method is used: the global extremum (max for peaks,
       min for troughs) in the search window is selected as the main extremum.

    Extremum are filtered to ensure a minimum distance from each other and from the edges of the template, to prevent
    spurious detections.

    Parameters
    ----------
    template : numpy.ndarray
        The 1D template waveform
    sampling_frequency : float
        The sampling frequency in Hz
    min_thresh_detect_peaks_troughs : float, default: 0.3
        Minimum prominence threshold as a fraction of the template's absolute max value
    edge_exclusion_ms : float, default: 0.1
        Duration in ms to exclude from the start and end of the template
        when detecting peaks/troughs. Prevents spurious edge detections.
    min_peak_trough_distance_ratio : float, default: 0.2
        Minimum peak-trough distance as a fraction of trough half-width. Used to filter out peaks too close to trough.
    min_extremum_distance_samples : int, default: 3
        Minimum distance between consecutive extrema (peaks and troughs) and between extrema and edges in samples.

    Returns
    -------
    peaks_info : dict
        Dictionary containing various information about detected extrema in "peak_before", "trough", "peak_after":
        - "{extremum}_sample_indices": array of all extrema sample indices using main prominence threshold
        - "{extremum}_prominences": array of all extrema prominences using main prominence threshold
        - "{extremum}_widths": array of all extrema widths using main prominence threshold
        - "{extremum}_index": sample index of the main extremum in template
        - "{extremum}_width": width of the main extremum in samples
        - "{extremum}_width_left": sample index of the left intersection point of the main with its prominence level
        - "{extremum}_width_right": sample index of the right intersection point of the main with its prominence level
        - "{extremum}_half_width_left": sample index of the left intersection point of the main with half of amplitude
        - "{extremum}_half_width_right": sample index of the right intersection point of the main with half of amplitude
    """
```

Note: the header's default for `min_thresh_detect_peaks_troughs` is `0.4` and for `edge_exclusion_ms` is `0.1`, but the docstring block advertises `0.3` and `0.1`, and the `ComputeTemplateMetrics` extension overrides these with `0.3` and `0.09` (see `_set_params`).

The three-attempt detection strategy inside is implemented by:

```python
def detect_peaks_on_templates(
    template,
    extremum_name,
    prominence,
    start_search_index,
    end_search_index,
    width=0,
):
    """Detect peaks on template. Three attempts are made to find a valid peak:

    1. Use the specified prominence threshold to detect peaks.
       If multiple are found, the most prominent is selected as the main extremum.
    2. If no peaks are found at the initial threshold, the threshold is halved and detection is attempted again.
       If multiple "peaks" are found at the half threshold, the most prominent is selected as the main extremum.
    3. If still no peaks are found, a last resort method is used: use the global maximum in the search window.
    ...
    """
```

Internal helper (not exported):

```python
def _compute_halfwidth(template, extremum_index, sampling_frequency):
    """Compute the halfwidth of a positive peak. Returns (hw, l, r); hw = np.nan and l = r = -1 if no crossings."""
```

---

