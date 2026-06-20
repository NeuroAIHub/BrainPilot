# Time-Frequency Analysis Reference

## Table of Contents
1. [Power Spectral Density (PSD)](#psd)
2. [Time-Frequency Representations (TFR)](#tfr)
3. [Cross-Spectral Density (CSD)](#csd)
4. [Array-Level Functions](#array-level)
5. [Baseline Correction Modes](#baseline-modes)
6. [Parameter Selection Guide](#parameter-guide)

## PSD

```python
# New API (recommended)
psd = raw.compute_psd(method='welch', fmin=0.5, fmax=50.)
psd = raw.compute_psd(method='multitaper', fmin=0.5, fmax=50.)
psd = epochs.compute_psd(method='multitaper')

# Plotting
psd.plot()                              # PSD curves
psd.plot_topomap(normalize=True)        # topographic PSD
psd.plot_topo()                         # per-channel in layout

# Array-level
from mne.time_frequency import psd_array_welch, psd_array_multitaper
psds, freqs = psd_array_welch(data, sfreq, fmin=0.5, fmax=50., n_fft=256)
psds, freqs = psd_array_multitaper(data, sfreq, fmin=0.5, fmax=50., bandwidth=4.)
```

## TFR

### New API (recommended)
```python
import numpy as np
freqs = np.arange(4, 30, 2)

# Morlet wavelets
power = epochs.compute_tfr(method="morlet", freqs=freqs, n_cycles=freqs / 2.,
                           average=True, return_itc=True, decim=3)

# Multitaper (better frequency resolution)
power = epochs.compute_tfr(method="multitaper", freqs=freqs,
                           n_cycles=freqs / 2., time_bandwidth=4.0)

# Stockwell transform (adaptive resolution)
power = epochs.compute_tfr(method="stockwell", fmin=6, fmax=35)

# Per-epoch TFR (no averaging)
power_epochs = epochs.compute_tfr(method="morlet", freqs=freqs,
                                   n_cycles=freqs / 2., average=False)
```

### Inter-Trial Coherence (ITC)
```python
power, itc = epochs.compute_tfr(method="morlet", freqs=freqs,
                                 n_cycles=freqs / 2., return_itc=True)
# ITC ranges from 0 (no phase consistency) to 1 (perfect phase locking)
```

### TFR Visualization
```python
power.plot(picks='Cz', baseline=(-0.5, 0), mode='logratio')  # single channel
power.plot_topo(baseline=(-0.5, 0), mode='logratio')          # all channels
power.plot_topomap(tmin=0.1, tmax=0.3, fmin=8, fmax=12)       # time-freq window
power.plot_joint(baseline=(-0.5, 0), mode='mean')              # TFR + topomaps
```

### Legacy API (still works but deprecated)
```python
from mne.time_frequency import tfr_morlet, tfr_multitaper, tfr_stockwell
power, itc = tfr_morlet(epochs, freqs, n_cycles)
power = tfr_multitaper(epochs, freqs, n_cycles, time_bandwidth=4.0)
power = tfr_stockwell(epochs, fmin=6, fmax=35)
```

## CSD

Cross-spectral density for beamformer source localization:

```python
from mne.time_frequency import csd_morlet, csd_multitaper, csd_fourier, csd_tfr

# From epochs
csd = csd_morlet(epochs, freqs=[10, 20], n_cycles=7)
csd = csd_multitaper(epochs, fmin=7, fmax=30, bandwidth=4.)
csd = csd_fourier(epochs, fmin=7, fmax=30)

# From TFR
csd = csd_tfr(epochs_tfr)

# Array-level
from mne.time_frequency import csd_array_morlet, csd_array_multitaper, csd_array_fourier
csd = csd_array_morlet(data, sfreq, freqs)
```

## Array-Level Functions

For working directly with numpy arrays:

```python
from mne.time_frequency import (
    tfr_array_morlet, tfr_array_multitaper, tfr_array_stockwell,
    morlet, dpss_windows, fwhm, stft, istft, stftfreq
)

# TFR on arrays — data shape: (n_epochs, n_channels, n_times)
out = tfr_array_morlet(data, sfreq, freqs, n_cycles,
                        output='power')  # 'complex', 'power', 'phase',
                                         # 'avg_power', 'itc', 'avg_power_itc'

out = tfr_array_multitaper(data, sfreq, freqs, n_cycles, time_bandwidth=4.0)
out = tfr_array_stockwell(data, sfreq, fmin=6, fmax=35)

# Generate wavelets
Ws = morlet(sfreq=256., freqs=[10, 20], n_cycles=7)

# DPSS tapers
tapers, eigenvalues = dpss_windows(N=256, half_nbw=4, Kmax=3)

# FWHM of Morlet wavelet (Cohen, 2019)
width = fwhm(freq=10., n_cycles=7)

# Short-time Fourier transform
X = stft(data, wsize=256, tstep=128)
x_reconstructed = istft(X, tstep=128)
freqs = stftfreq(wsize=256, sfreq=256.)
```

## Baseline Correction Modes

```python
power.apply_baseline(baseline=(-0.5, 0), mode='logratio')
```

| Mode | Formula | Use case |
|------|---------|----------|
| `'mean'` | data - mean | Subtract baseline mean |
| `'ratio'` | data / mean | Ratio to baseline |
| `'logratio'` | log(data / mean) | dB-like, symmetric, most common |
| `'percent'` | (data - mean) / mean × 100 | Percent change |
| `'zscore'` | (data - mean) / std | Z-score normalization |
| `'zlogratio'` | (log(data) - log(mean)) / std(log) | Z-score of log ratio |

## Parameter Selection Guide

### n_cycles
- Lower values → better time resolution, worse frequency resolution
- Higher values → better frequency resolution, worse time resolution
- `n_cycles = freqs / 2.` — adaptive heuristic (common default)
- `n_cycles = 7` — fixed, good for narrow-band analysis

### time_bandwidth (multitaper only)
- Controls number of tapers: `n_tapers = int(time_bandwidth - 1)`
- Higher → smoother estimate, more frequency smoothing
- Default: 4.0 (gives 3 tapers)

### decim
- Decimation factor applied after TFR computation
- Reduces output size and speeds up computation
- Set to avoid aliasing (decim should not exceed Nyquist for your frequency range)

### Choosing method
- **Morlet**: Good general-purpose, adjustable time-frequency tradeoff
- **Multitaper**: Better for narrow-band, reduces spectral leakage
- **Stockwell**: Adaptive resolution, no n_cycles parameter needed
