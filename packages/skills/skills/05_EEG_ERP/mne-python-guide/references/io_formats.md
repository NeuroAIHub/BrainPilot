# I/O Formats Reference

## Table of Contents
1. [All Supported Readers](#all-supported-readers)
2. [Auto-Detection](#auto-detection)
3. [Creating Objects from Arrays](#creating-objects-from-arrays)
4. [Exporting Data](#exporting-data)
5. [Creating Info Objects](#creating-info-objects)

## All Supported Readers

| Function | Format | Extensions |
|----------|--------|------------|
| `mne.io.read_raw()` | Auto-detect | any |
| `mne.io.read_raw_fif()` | Neuromag FIF | .fif |
| `mne.io.read_raw_edf()` | EDF/EDF+ | .edf |
| `mne.io.read_raw_bdf()` | BioSemi BDF | .bdf |
| `mne.io.read_raw_gdf()` | GDF | .gdf |
| `mne.io.read_raw_eeglab()` | EEGLAB | .set |
| `mne.io.read_raw_brainvision()` | BrainVision | .vhdr |
| `mne.io.read_raw_egi()` | EGI NetStation | .mff, .raw |
| `mne.io.read_raw_cnt()` | Neuroscan CNT | .cnt |
| `mne.io.read_raw_ctf()` | CTF MEG | .ds |
| `mne.io.read_raw_kit()` | KIT/Ricoh | .sqd, .con |
| `mne.io.read_raw_bti()` | BTi/4D | config |
| `mne.io.read_raw_fieldtrip()` | FieldTrip | .mat |
| `mne.io.read_raw_nirx()` | NIRx fNIRS | .hdr |
| `mne.io.read_raw_snirf()` | SNIRF fNIRS | .snirf |
| `mne.io.read_raw_boxy()` | BOXY fNIRS | .txt |
| `mne.io.read_raw_hitachi()` | Hitachi fNIRS | .csv |
| `mne.io.read_raw_eyelink()` | EyeLink | .asc |
| `mne.io.read_raw_nicolet()` | Nicolet | .data |
| `mne.io.read_raw_nihon()` | Nihon Kohden | .eeg |
| `mne.io.read_raw_persyst()` | Persyst | .lay |
| `mne.io.read_raw_eximia()` | Eximia | .nxe |
| `mne.io.read_raw_ant()` | ANT Neuro | .cnt |
| `mne.io.read_raw_curry()` | Neuroscan Curry | .cdt |
| `mne.io.read_raw_neuralynx()` | Neuralynx | .ncs |
| `mne.io.read_raw_nsx()` | Blackrock NSx | .ns* |
| `mne.io.read_raw_nedf()` | NEDF | .nedf |
| `mne.io.read_raw_fil()` | FIL | .bin |
| `mne.io.read_raw_artemis123()` | Artemis 123 | .bin |

All readers accept `preload=True/False`. Use `preload=True` for interactive analysis; `preload=False` for large files (memory-mapped).

## Auto-Detection

```python
# MNE can auto-detect format from file extension
raw = mne.io.read_raw('my_data.edf', preload=True)
```

## Creating Objects from Arrays

When you have numpy arrays and want to create MNE objects:

```python
import mne
import numpy as np

# Create Info
info = mne.create_info(
    ch_names=['Fz', 'Cz', 'Pz', 'Oz'],
    sfreq=256.,
    ch_types='eeg'
)
info.set_montage('standard_1020')

# RawArray — continuous data
data = np.random.randn(4, 1000)  # (n_channels, n_times)
raw = mne.io.RawArray(data, info)

# EpochsArray — segmented data
epochs_data = np.random.randn(50, 4, 128)  # (n_epochs, n_channels, n_times)
events = np.column_stack([
    np.arange(0, 50 * 128, 128),
    np.zeros(50, dtype=int),
    np.ones(50, dtype=int)
])
epochs = mne.EpochsArray(epochs_data, info, events, tmin=-0.2,
                          event_id={'stimulus': 1})

# EvokedArray — averaged data
evoked_data = np.random.randn(4, 128)  # (n_channels, n_times)
evoked = mne.EvokedArray(evoked_data, info, tmin=-0.2)

# SpectrumArray — power spectrum
psd_data = np.random.rand(4, 65)  # (n_channels, n_freqs)
freqs = np.arange(0, 65)
spectrum = mne.time_frequency.SpectrumArray(psd_data, info, freqs)
```

## Exporting Data

```python
raw.export('output.edf')           # to EDF
raw.export('output.edf', fmt='edf')
epochs.export('output.set')         # to EEGLAB
raw.export('output.bdf', fmt='bdf') # to BDF
```

## Creating Info Objects

```python
# Basic
info = mne.create_info(ch_names=['C3', 'C4'], sfreq=256., ch_types='eeg')

# Mixed channel types
info = mne.create_info(
    ch_names=['EEG1', 'EEG2', 'EOG1', 'ECG1'],
    sfreq=512.,
    ch_types=['eeg', 'eeg', 'eog', 'ecg']
)

# Set montage (electrode positions)
info.set_montage('standard_1020')
# Available montages: 'standard_1020', 'standard_1005', 'biosemi64', etc.
# List all: mne.channels.get_builtin_montages()

# JSON serialization (v1.11+)
json_dict = info.to_json_dict()
info_restored = mne.Info.from_json_dict(json_dict)
```

## Reading Other Data Types

```python
# Events
events = mne.read_events('events.eve')
events, event_id = mne.events_from_annotations(raw)

# Epochs from file
epochs = mne.read_epochs('saved-epo.fif')

# Evoked from file
evoked_list = mne.read_evokeds('evoked-ave.fif')
evoked = mne.read_evokeds('evoked-ave.fif', condition='auditory/left')

# Forward solution
fwd = mne.read_forward_solution('sample-fwd.fif')

# Inverse operator
inv = mne.minimum_norm.read_inverse_operator('sample-inv.fif')

# Source estimate
stc = mne.read_source_estimate('sample')

# Covariance
cov = mne.read_cov('sample-cov.fif')

# Annotations
annot = mne.read_annotations('annotations.fif')

# Labels (FreeSurfer ROIs)
label = mne.read_label('lh.V1.label')
labels = mne.read_labels_from_annot(subject, parc='aparc', subjects_dir=subjects_dir)

# Trans (head-MRI transform)
trans = mne.read_trans('sample-trans.fif')
```
