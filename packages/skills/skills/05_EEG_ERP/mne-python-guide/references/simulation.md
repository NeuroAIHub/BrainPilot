# Simulation Reference

## Table of Contents
1. [Creating Objects from Arrays](#from-arrays)
2. [Simulating Source Activity](#source-activity)
3. [Simulating Raw Data](#raw-data)
4. [Simulating Evoked Responses](#evoked)
5. [Adding Artifacts](#artifacts)
6. [Adding Noise](#noise)
7. [SourceSimulator Class](#source-simulator)
8. [Simulation Metrics](#metrics)

## Creating Objects from Arrays

```python
import mne
import numpy as np

# Create Info
info = mne.create_info(ch_names=['Fz', 'Cz', 'Pz'], sfreq=256., ch_types='eeg')
info.set_montage('standard_1020')

# RawArray
data = np.random.randn(3, 10000)  # (n_channels, n_times)
raw = mne.io.RawArray(data, info)

# EpochsArray
epochs_data = np.random.randn(50, 3, 128)  # (n_epochs, n_channels, n_times)
events = np.column_stack([np.arange(0, 50*128, 128), np.zeros(50, int), np.ones(50, int)])
epochs = mne.EpochsArray(epochs_data, info, events, tmin=-0.2, event_id={'stim': 1})

# EvokedArray
evoked_data = np.random.randn(3, 128)  # (n_channels, n_times)
evoked = mne.EvokedArray(evoked_data, info, tmin=-0.2)
```

## Simulating Source Activity

```python
from mne.simulation import simulate_stc, simulate_sparse_stc

# Dense source simulation
stc = simulate_stc(src, labels=[label_lh, label_rh],
                    stc_data=np.array([[1, 1, 0], [0, 1, 1]]),
                    tmin=0, tstep=1./info['sfreq'])

# Sparse source simulation (few active dipoles)
stc = simulate_sparse_stc(src, n_dipoles=2, times=times,
    data_fun=lambda t: 1e-9 * np.sin(20 * 2 * np.pi * t))

# Select source in label
from mne.simulation import select_source_in_label
lh_vertno, rh_vertno = select_source_in_label(src, label, location='center')
```

## Simulating Raw Data

```python
from mne.simulation import simulate_raw, SourceSimulator

# Simple: from source time course + forward model
raw_sim = simulate_raw(info, stc=stc, forward=fwd)

# Complex: using SourceSimulator
source_sim = SourceSimulator(src, tstep=1./info['sfreq'])
source_sim.add_data(label, waveform, events)
raw_sim = simulate_raw(info, source_sim, forward=fwd)
```

## Simulating Evoked Responses

```python
from mne.simulation import simulate_evoked

evoked_sim = simulate_evoked(fwd, stc, info,
                              cov=noise_cov,   # noise covariance
                              nave=100,         # number of averages
                              random_state=42)
```

## Adding Artifacts

```python
from mne.simulation import add_ecg, add_eog

# Add heartbeat artifact
raw_sim = add_ecg(raw_sim)

# Add eye blink artifact
raw_sim = add_eog(raw_sim)

# Add cHPI signals (MEG)
from mne.simulation import add_chpi
raw_sim = add_chpi(raw_sim, head_pos=head_pos)
```

## Adding Noise

```python
from mne.simulation import add_noise

# From covariance
add_noise(raw_sim, cov=noise_cov, random_state=42)
add_noise(evoked_sim, cov=noise_cov, random_state=42)

# Ad-hoc covariance
cov = mne.make_ad_hoc_cov(info)
add_noise(raw_sim, cov, random_state=42)
```

## SourceSimulator Class

For complex experimental designs with multiple conditions:

```python
from mne.simulation import SourceSimulator

source_sim = SourceSimulator(src, tstep=1./info['sfreq'])

# Add condition 1: auditory in left hemisphere
waveform_aud = 1e-9 * np.sin(2 * np.pi * 10 * times)
source_sim.add_data(label_auditory, waveform_aud, events_aud)

# Add condition 2: visual in right hemisphere
waveform_vis = 1e-9 * np.cos(2 * np.pi * 15 * times)
source_sim.add_data(label_visual, waveform_vis, events_vis)

# Get source estimate
stc = source_sim.get_stc()

# Get stimulus channel
stim_data = source_sim.get_stim_channel()

# Properties
source_sim.duration
source_sim.n_times

# Generate raw
raw_sim = simulate_raw(info, source_sim, forward=fwd)
```

## Simulation Metrics

Compare simulated ground truth with estimated source activity:

```python
from mne.simulation.metrics import (
    cosine_score,
    region_localization_error,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
    spatial_deviation_error,
    peak_position_error
)

# Cosine similarity (0=orthogonal, 1=identical)
score = cosine_score(stc_true, stc_estimated)

# Region localization error (mm)
rle = region_localization_error(stc_true, stc_estimated, src)

# Classification metrics (after binarization)
f1 = f1_score(stc_true, stc_estimated, threshold='90%')
prec = precision_score(stc_true, stc_estimated, threshold='90%')
rec = recall_score(stc_true, stc_estimated, threshold='90%')
auc = roc_auc_score(stc_true, stc_estimated)

# Spatial spread metrics
sd = spatial_deviation_error(stc_true, stc_estimated, src, threshold='50%')
ppe = peak_position_error(stc_true, stc_estimated, src)
```
