# Source Localization Reference

## Table of Contents
1. [Source Space Setup](#source-space)
2. [BEM Model](#bem)
3. [Forward Solution](#forward)
4. [Noise Covariance](#noise-covariance)
5. [Minimum Norm Estimates](#minimum-norm)
6. [Beamformers](#beamformers)
7. [Dipole Fitting](#dipole-fitting)
8. [Template MRI (fsaverage)](#template-mri)
9. [Source Estimate Operations](#stc-operations)

## Source Space

```python
# Surface source space
src = mne.setup_source_space(subject, spacing='oct6', subjects_dir=subjects_dir)
# spacing options:
#   'oct5' ~1026 sources/hemi, 'oct6' ~4098 (default), 'ico4' ~2562, 'ico5' ~10242

# Volume source space
src = mne.setup_volume_source_space(subject, pos=5.0, subjects_dir=subjects_dir)
# pos: grid spacing in mm

# Mixed source space (surface + volume)
src = mne.setup_source_space(subject, spacing='oct6') + \
      mne.setup_volume_source_space(subject, pos=5.0, volume_label='Left-Hippocampus')

# Read/write
src = mne.read_source_spaces('sample-src.fif')
src.save('sample-src.fif')
```

## BEM

```python
# 3-layer BEM for EEG (brain, skull, scalp)
model = mne.make_bem_model(subject, conductivity=(0.3, 0.006, 0.3),
                            subjects_dir=subjects_dir)

# 1-layer BEM for MEG only (inner skull)
model = mne.make_bem_model(subject, conductivity=(0.3,),
                            subjects_dir=subjects_dir)

# Compute BEM solution
bem = mne.make_bem_solution(model)

# Sphere model (simpler alternative)
sphere = mne.make_sphere_model(r0='auto', head_radius='auto', info=info)
```

## Forward Solution

```python
fwd = mne.make_forward_solution(
    info, trans=trans, src=src, bem=bem,
    eeg=True, meg=True, mindist=5.0, n_jobs=-1)

# Read from file
fwd = mne.read_forward_solution('sample-fwd.fif')

# Convert orientation
fwd = mne.convert_forward_solution(fwd, surf_ori=True, force_fixed=False)

# Restrict to label
fwd_label = mne.forward.restrict_forward_to_label(fwd, label)
```

## Noise Covariance

```python
# From pre-stimulus baseline epochs
noise_cov = mne.compute_covariance(epochs, tmax=0., method='auto')
# method: 'auto', 'empirical', 'diagonal_fixed', 'shrunk', 'oas',
#         'ledoit_wolf', 'factor_analysis'

# From empty room recording
noise_cov = mne.compute_raw_covariance(raw_empty_room)

# Ad-hoc covariance (for testing)
noise_cov = mne.make_ad_hoc_cov(info)

# Read/write
noise_cov = mne.read_cov('sample-cov.fif')
mne.write_cov('sample-cov.fif', noise_cov)

# Visualize
noise_cov.plot(info)
evoked.plot_white(noise_cov)  # check whitening quality
```

## Minimum Norm Estimates

```python
from mne.minimum_norm import (
    make_inverse_operator, apply_inverse, apply_inverse_epochs,
    apply_inverse_raw, apply_inverse_cov, read_inverse_operator,
    write_inverse_operator
)

# Create inverse operator
inv = make_inverse_operator(info, fwd, noise_cov,
                             loose=0.2,    # 0=fixed, 0.2=default, 1=free
                             depth=0.8)    # depth weighting (0-1)

# Apply to evoked
snr = 3.0
lambda2 = 1. / snr ** 2  # = 1/9 ≈ 0.111
stc = apply_inverse(evoked, inv, lambda2, method='dSPM',
                     pick_ori=None)  # None, 'normal', 'vector'

# Apply to epochs (per-trial source estimates)
stcs = apply_inverse_epochs(epochs, inv, lambda2, method='dSPM',
                             return_generator=True)  # memory-efficient

# Apply to raw (continuous)
stc = apply_inverse_raw(raw, inv, lambda2, method='MNE')

# Apply to covariance (source power)
stc_power = apply_inverse_cov(data_cov, info, inv)

# Resolution analysis
from mne.minimum_norm import make_inverse_resolution_matrix, resolution_metrics
rm = make_inverse_resolution_matrix(fwd, inv, method='dSPM', lambda2=lambda2)
metrics = resolution_metrics(rm, src, function='psf', metric='peak_err')
```

## Beamformers

### LCMV (time domain)
```python
from mne.beamformer import make_lcmv, apply_lcmv, apply_lcmv_epochs, apply_lcmv_raw

data_cov = mne.compute_covariance(epochs, tmin=0., tmax=0.5)
filters = make_lcmv(info, fwd, data_cov,
                     noise_cov=noise_cov,
                     reg=0.05,
                     pick_ori='max-power')  # None, 'normal', 'max-power', 'vector'

stc = apply_lcmv(evoked, filters)
stcs = apply_lcmv_epochs(epochs, filters)
stc = apply_lcmv_raw(raw, filters)
```

### DICS (frequency domain)
```python
from mne.beamformer import make_dics, apply_dics, apply_dics_csd, apply_dics_epochs
from mne.time_frequency import csd_morlet

csd = csd_morlet(epochs, freqs=[10], n_cycles=7)
noise_csd = csd_morlet(epochs, freqs=[10], n_cycles=7, tmin=-0.5, tmax=0.)

filters = make_dics(info, fwd, csd, noise_csd=noise_csd, reg=0.05)
stc_power, freqs = apply_dics_csd(csd, filters)
stc = apply_dics(evoked, filters)
```

### RAP-MUSIC / TRAP-MUSIC
```python
from mne.beamformer import rap_music, trap_music
dipoles, residual = rap_music(evoked, fwd, noise_cov, n_dipoles=2)
```

## Dipole Fitting

```python
dip, residual = mne.fit_dipole(evoked, noise_cov, bem, trans,
                                min_dist=5.0, n_jobs=-1)
dip.plot_locations(trans, subject, subjects_dir)
dip.plot_amplitudes()

# Confidence volume
dip.conf  # confidence volume in mm³
```

## Template MRI (fsaverage)

For EEG studies without individual MRI:

```python
import os.path as op
fs_dir = mne.datasets.fetch_fsaverage(verbose=True)
subjects_dir = op.dirname(fs_dir)
subject = 'fsaverage'
trans = 'fsaverage'  # built-in identity transform

src = mne.setup_source_space(subject, spacing='oct6', subjects_dir=subjects_dir)
model = mne.make_bem_model(subject, subjects_dir=subjects_dir)
bem = mne.make_bem_solution(model)
fwd = mne.make_forward_solution(info, trans, src, bem)

# Then proceed with inverse as usual
inv = make_inverse_operator(info, fwd, noise_cov)
stc = apply_inverse(evoked, inv, lambda2=1./9., method='dSPM')
```

## Source Estimate Operations

```python
# Visualization
stc.plot(subject, subjects_dir=subjects_dir, hemi='both',
         surface='inflated', views='lateral')
brain = stc.plot(subject, hemi='split', size=(800, 400))
brain.add_foci(vertex_id, hemi='rh', color='yellow')
brain.save_image('brain.png')

# Peak detection
vertex, time_idx = stc.get_peak(hemi='rh', tmin=0.05, tmax=0.15)

# Time operations
stc.crop(tmin=0., tmax=0.3)
stc_mean = stc.mean()

# ROI extraction
label = mne.read_label('lh.V1.label')
stc_label = stc.in_label(label)

# Extract label time courses
labels = mne.read_labels_from_annot(subject, parc='aparc', subjects_dir=subjects_dir)
label_ts = mne.extract_label_time_course(stcs, labels, src,
                                          mode='mean_flip')  # 'mean', 'mean_flip',
                                                              # 'pca_flip', 'max'

# Morphing between subjects
morph = mne.compute_source_morph(stc, subject_from='sample',
                                  subject_to='fsaverage',
                                  subjects_dir=subjects_dir)
stc_fsaverage = morph.apply(stc)

# Arithmetic
stc_diff = stc1 - stc2
stc_scaled = stc * 1e9
```
