# Filtering
Source in repo: `spikeinterface/src/spikeinterface/preprocessing/filter.py`
Parent index: [INDEX.md](INDEX.md)
---

## Filtering

All temporal filters are wrappers around `scipy.signal`. `filter_mode="sos"` is the
default and is preferred (numerically more stable than `"ba"`).

### filter / FilterRecording

Generic IIR filter (bandpass or highpass; also accepts pre-computed coefficients).

```python
FilterRecording(
    recording,
    band=(300.0, 6000.0),
    btype="bandpass",
    filter_order=5,
    ftype="butter",
    filter_mode="sos",
    margin_ms=None,
    add_reflect_padding=False,
    coeff=None,
    dtype=None,
    direction="forward-backward",
)
```

Enumerated Literal-style parameters:

- `btype` ∈ {`"bandpass"`, `"highpass"`}
- `filter_mode` ∈ {`"sos"` (second-order sections), `"ba"` (numerator/denominator)}
- `ftype` — any `scipy.signal.iirfilter` type. The commonly used values are
  {`"butter"`, `"bessel"`, `"cheby1"`, `"cheby2"`, `"ellip"`}. Default `"butter"`.
- `direction` ∈ {`"forward"`, `"backward"`, `"forward-backward"`}. Only
  `"forward-backward"` is zero-phase (uses `sosfiltfilt`/`filtfilt`); the other two use
  `sosfilt`/`lfilter`.

`margin_ms` is **required** by the class (subclasses `bandpass_filter` /
`highpass_filter` / `notch_filter` provide it).

### bandpass_filter / BandpassFilterRecording

```python
bandpass_filter(
    recording,
    freq_min=300.0,
    freq_max=6000.0,
    margin_ms="auto",
    dtype=None,
    ignore_low_freq_error=False,
    _skip_margin_warning_for_old_version=False,
    **filter_kwargs,
)
```

- `margin_ms`: `"auto"` → `5 * (1000.0 / freq_min)` ms; else float.
- `ignore_low_freq_error`: unless True, raises `ValueError` when `freq_min < 100 Hz`
  (`HIGHPASS_ERROR_THRESHOLD_HZ`).
- `**filter_kwargs` are forwarded to `FilterRecording` (see above): `filter_order`
  (default 5), `filter_mode` ∈ {`"sos"`, `"ba"`} default `"sos"`, `ftype` (default
  `"butter"`), `direction` ∈ {`"forward"`, `"backward"`, `"forward-backward"`} default
  `"forward-backward"`, `add_reflect_padding` (default False), `coeff` (default None).

### highpass_filter / HighpassFilterRecording

```python
highpass_filter(
    recording,
    freq_min=300.0,
    margin_ms="auto",
    dtype=None,
    ignore_low_freq_error=False,
    _skip_margin_warning_for_old_version=False,
    **filter_kwargs,
)
```

`btype="highpass"` is passed to `FilterRecording`. Same `**filter_kwargs` as
`bandpass_filter`.

### notch_filter / NotchFilterRecording

Applies an IIR notch (via `scipy.signal.iirnotch`, internally `filter_mode="ba"`).
Does **not** accept unsigned dtypes.

```python
NotchFilterRecording(recording, freq=3000, q=30, margin_ms="auto", dtype=None, **filter_kwargs)
```

- `margin_ms`: `"auto"` → `(5 / pi) * (q / freq) * 1000` ms.

### causal_filter

```python
causal_filter(
    recording,
    direction="forward",
    band=(300.0, 6000.0),
    btype="bandpass",
    filter_order=5,
    ftype="butter",
    filter_mode="sos",
    margin_ms=5.0,
    add_reflect_padding=False,
    coeff=None,
    dtype=None,
)
```

- `direction` ∈ {`"forward"`, `"backward"`} (asserted). Zero-phase (`"forward-backward"`)
  is **not** allowed here.
- `btype` ∈ {`"bandpass"`, `"highpass"`}.
- `filter_mode` ∈ {`"sos"`, `"ba"`}.
- `ftype` defaults to `"butter"` (any `scipy.signal.iirfilter` value).

### gaussian_filter / GaussianFilterRecording

FFT-based convolution with a Gaussian kernel.

```python
GaussianFilterRecording(
    recording: BaseRecording,
    freq_min: float = 300.0,
    freq_max: float = 5000.0,
    margin_sd: float = 5.0,
)
```

- `freq_min=None` → lowpass; `freq_max=None` → highpass; both set → bandpass; both
  `None` raises `ValueError`.

### filter_opencl / FilterOpenCLRecording

Simple OpenCL implementation. Only `filter_mode="sos"` is supported. Requires
`pyopencl`. Not registered in `preprocessor_dict` — import directly from
`spikeinterface.preprocessing.filter_opencl` if needed.

```python
FilterOpenCLRecording(
    recording,
    band=[300.0, 6000.0],
    btype="bandpass",
    filter_order=5,
    ftype="butter",
    filter_mode="sos",
    margin_ms=5.0,
)
```

- `btype` ∈ {`"bandpass"`, `"lowpass"`, `"highpass"`, `"bandstop"`}.
- `filter_mode` ∈ {`"sos"`} (only value allowed).
- `ftype` — any `scipy.signal.iirdesign` type (`"butter"`, `"cheby1"`, ...).
