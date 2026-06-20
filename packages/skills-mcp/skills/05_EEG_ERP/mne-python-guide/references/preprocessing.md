# Preprocessing Reference

## Table of Contents
1. [Filtering](#filtering)
2. [ICA Artifact Removal](#ica-artifact-removal)
3. [Automated Artifact Detection](#automated-artifact-detection)
4. [Bad Channel Handling](#bad-channel-handling)
5. [Re-referencing](#re-referencing)
6. [Maxwell Filtering (MEG)](#maxwell-filtering-meg)
7. [Current Source Density (CSD)](#current-source-density)
8. [EOG/ECG Processing](#eogecg-processing)
9. [fNIRS Preprocessing](#fnirs-preprocessing)
10. [iEEG Preprocessing](#ieeg-preprocessing)
11. [Eye-tracking Preprocessing](#eye-tracking-preprocessing)
12. [Annotations](#annotations)

## Filtering

```python
# Bandpass
raw.filter(l_freq=0.1, h_freq=40.)       # ERP standard (Luck, 2014)
raw.filter(l_freq=1., h_freq=100.)        # time-frequency / ICA fitting

# Highpass only
raw.filter(l_freq=1., h_freq=None)

# Lowpass only
raw.filter(l_freq=None, h_freq=40.)

# Notch filter (line noise)
raw.notch_filter(freqs=[50, 100, 150])    # 50 Hz regions
raw.notch_filter(freqs=[60, 120, 180])    # 60 Hz regions

# Key parameters
raw.filter(l_freq=0.1, h_freq=40.,
           method='fir',           # 'fir' (default) or 'iir'
           fir_design='firwin',    # 'firwin' (default) or 'firwin2'
           phase='zero',           # 'zero' (default), 'zero-double', 'minimum'
           l_trans_bandwidth=0.1,  # transition bandwidth (Hz)
           h_trans_bandwidth=10.)
```

## ICA Artifact Removal

```python
# Initialize
ica = mne.preprocessing.ICA(
    n_components=20,       # int or float (0-1 for variance explained)
    method='fastica',      # 'fastica' (default), 'picard', 'infomax'
    random_state=97,
    max_iter=800           # or 'auto'
)

# Fit (on 1 Hz highpass filtered data)
filt_raw = raw.copy().filter(l_freq=1., h_freq=None)
ica.fit(filt_raw)
# or: ica.fit(epochs)  # can also fit on epochs

# Automatic artifact detection
eog_idx, eog_scores = ica.find_bads_eog(raw)
ecg_idx, ecg_scores = ica.find_bads_ecg(raw, method='correlation', threshold='auto')
muscle_idx, muscle_scores = ica.find_bads_muscle(raw)

# Visual inspection
ica.plot_components()                          # topographies of all components
ica.plot_sources(raw)                          # time courses
ica.plot_properties(raw, picks=eog_idx)        # detailed per-component view
ica.plot_scores(eog_scores)                    # correlation scores
ica.plot_overlay(raw, exclude=eog_idx)         # before/after overlay

# Apply
ica.exclude = eog_idx + ecg_idx
ica.apply(raw)  # modifies in-place

# Save/load
ica.save('my-ica.fif')
ica = mne.preprocessing.read_ica('my-ica.fif')

# Cross-subject template matching
from mne.preprocessing import corrmap
corrmap(icas_list, template=(0, eog_idx[0]), threshold=0.9, label='blink')
```

## Automated Artifact Detection

```python
# Annotate high-amplitude segments
annot, bads = mne.preprocessing.annotate_amplitude(
    raw, peak=dict(eeg=200e-6), flat=dict(eeg=1e-6))
raw.set_annotations(raw.annotations + annot)

# Annotate muscle artifacts
annot, scores = mne.preprocessing.annotate_muscle_zscore(
    raw, threshold=5, ch_type='eeg')

# Annotate breaks in recording
annot = mne.preprocessing.annotate_break(raw, min_break_duration=15.)

# Annotate movement (MEG with cHPI)
annot = mne.preprocessing.annotate_movement(raw, pos, rotation_velocity_limit=5.)

# Detect bad channels (Local Outlier Factor)
bads, scores = mne.preprocessing.find_bad_channels_lof(raw)

# Detect bad channels (Maxwell filtering, MEG only)
noisy, flat = mne.preprocessing.find_bad_channels_maxwell(raw)
```

## Bad Channel Handling

```python
# Mark bad channels
raw.info['bads'] = ['EEG 053', 'MEG 2443']
raw.info['bads'].extend(['EEG 001'])

# Interpolate
raw.interpolate_bads()  # spherical spline for EEG, field interpolation for MEG

# Detect bridged electrodes
bridged, ed_matrix = mne.preprocessing.compute_bridged_electrodes(raw)
mne.preprocessing.interpolate_bridged_electrodes(raw, bridged)

# Equalize bad channels across subjects (for group analysis)
mne.preprocessing.equalize_bads(raws_list)
```

## Re-referencing

```python
# Average reference
raw.set_eeg_reference('average')

# Specific channels
raw.set_eeg_reference(['M1', 'M2'])       # mastoid reference
raw.set_eeg_reference(['TP9', 'TP10'])     # linked earlobes

# REST reference (Reference Electrode Standardization Technique)
raw.set_eeg_reference('REST', forward=fwd)

# Projection-based (add as projector, don't modify data)
raw.set_eeg_reference('average', projection=True)
```

## Maxwell Filtering (MEG)

Signal Space Separation for MEG denoising:

```python
raw_sss = mne.preprocessing.maxwell_filter(
    raw,
    origin='auto',          # head origin
    int_order=8,            # internal expansion order
    ext_order=3,            # external expansion order
    st_duration=10.,        # tSSS buffer duration (None for SSS only)
    st_correlation=0.98,    # tSSS correlation threshold
    coord_frame='head',     # coordinate frame
    calibration=cal_fname,  # fine calibration file
    cross_talk=ct_fname     # cross-talk correction file
)

# Prepare empty room data for noise covariance
raw_er = mne.preprocessing.maxwell_filter_prepare_emptyroom(raw_er, raw)
```

## Current Source Density

Surface Laplacian for EEG:

```python
raw_csd = mne.preprocessing.compute_current_source_density(raw)
epochs_csd = mne.preprocessing.compute_current_source_density(epochs)
```

## EOG/ECG Processing

```python
# Create artifact epochs
eog_epochs = mne.preprocessing.create_eog_epochs(raw, ch_name='EOG 061')
ecg_epochs = mne.preprocessing.create_ecg_epochs(raw)

# Find events
eog_events = mne.preprocessing.find_eog_events(raw)
ecg_events = mne.preprocessing.find_ecg_events(raw)

# SSP projectors
projs_eog, _ = mne.preprocessing.compute_proj_eog(raw, n_eeg=1)
projs_ecg, _ = mne.preprocessing.compute_proj_ecg(raw, n_eeg=1)
raw.add_proj(projs_eog + projs_ecg)
raw.apply_proj()

# EOG regression (alternative to ICA)
model = mne.preprocessing.EOGRegression(picks='eeg', picks_artifact='eog')
model.fit(raw)
raw_clean = model.apply(raw)
```

## fNIRS Preprocessing

```python
from mne.preprocessing.nirs import (
    optical_density, beer_lambert_law, scalp_coupling_index,
    short_channel_regression, temporal_derivative_distribution_repair
)

# Convert to optical density
raw_od = optical_density(raw)

# Scalp coupling index (quality metric)
sci = scalp_coupling_index(raw_od)
raw_od.info['bads'] = [ch for ci, ch in zip(sci, raw_od.ch_names) if ci < 0.5]

# Short channel regression
raw_od = short_channel_regression(raw_od)

# Convert to hemoglobin concentration
raw_haemo = beer_lambert_law(raw_od, ppf=0.1)

# TDDR (motion artifact correction)
raw_haemo = temporal_derivative_distribution_repair(raw_haemo)
```

## iEEG Preprocessing

```python
from mne.preprocessing.ieeg import project_sensors_onto_brain

# Project electrode contacts onto brain surface
pos_corrected = project_sensors_onto_brain(
    info, trans, subject, subjects_dir=subjects_dir)
```

## Eye-tracking Preprocessing

```python
from mne.preprocessing.eyetracking import (
    read_eyelink_calibration, interpolate_blinks, set_channel_types_eyetrack
)

cals = read_eyelink_calibration(raw_et)
raw_et = interpolate_blinks(raw_et, buffer=(0.05, 0.2))
```

## Annotations

```python
# Add annotations
raw.annotations.append(onset=5.0, duration=1.0, description='bad_segment')

# Read/write
annot = mne.read_annotations('annotations.fif')
raw.set_annotations(annot)
raw.annotations.save('annotations.fif')

# Mark bad segments interactively
raw.plot()  # click and drag to mark bad segments

# Convert annotations to events
events, event_id = mne.events_from_annotations(raw)
```
