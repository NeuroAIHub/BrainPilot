# Visualization Reference

## Table of Contents
1. [Raw Data](#raw)
2. [Epochs](#epochs)
3. [Evoked](#evoked)
4. [Topomaps](#topomaps)
5. [Time-Frequency](#tfr)
6. [Source Estimates](#source)
7. [ICA](#ica)
8. [Sensors and Layout](#sensors)
9. [Publication Figures](#publication)
10. [Report Generation](#report)
11. [3D Backend](#3d-backend)

## Raw Data

```python
raw.plot(duration=5, n_channels=30, scalings='auto')  # interactive browser
raw.compute_psd(fmax=50).plot()                         # PSD curves
raw.compute_psd().plot_topomap(normalize=True)          # PSD topomap
raw.plot_sensors(show_names=True)                       # sensor positions
raw.plot_sensors(kind='3d')                             # 3D sensor positions
```

## Epochs

```python
epochs.plot(n_epochs=20, n_channels=20)     # interactive (click to mark bad)
epochs.plot_image(picks='eeg')               # ERP image (trials × time heatmap)
epochs.plot_drop_log()                       # rejection statistics
epochs.plot_topo_image()                     # topographic image
```

## Evoked

```python
evoked.plot()                                           # butterfly plot
evoked.plot_joint()                                     # butterfly + topomaps at peaks
evoked.plot_topomap(times=[0.1, 0.2, 0.3])             # scalp topographies
evoked.plot_image()                                     # channels × time heatmap
evoked.plot_topo()                                      # per-channel in layout
evoked.plot_white(noise_cov)                            # whitened (check noise model)

# Compare conditions
mne.viz.plot_compare_evokeds(
    {'auditory': evoked_aud, 'visual': evoked_vis},
    picks='Cz', ci=0.95)

# Field maps
maps = mne.make_field_map(evoked, trans, subject, subjects_dir)
mne.viz.plot_evoked_field(evoked, maps)
```

## Topomaps

```python
# Generic topomap from array
mne.viz.plot_topomap(data, info,
                      cmap='RdBu_r',
                      vlim=(-3, 3),
                      contours=6,
                      sensors=True,
                      show_names=False,
                      mask=significant_channels,
                      outlines='head')
```

## Time-Frequency

```python
power.plot(picks='Cz', baseline=(-0.5, 0), mode='logratio')  # single channel
power.plot_topo(baseline=(-0.5, 0), mode='logratio')          # all channels
power.plot_topomap(tmin=0.1, tmax=0.3, fmin=8, fmax=12)       # time-freq window
power.plot_joint(baseline=(-0.5, 0), mode='mean')              # TFR + topomaps
```

## Source Estimates

```python
# 3D brain (requires PyVista)
stc.plot(subject, subjects_dir=subjects_dir, hemi='both',
         surface='inflated', views='lateral', time_viewer=True)

# Split view
brain = stc.plot(subject, hemi='split', size=(800, 400),
                  views='lateral', surface='inflated')

# Add markers
brain.add_foci(vertex_id, hemi='rh', color='yellow')
brain.add_text(0.1, 0.9, 'Peak activation', font_size=14)

# Save screenshot
brain.save_image('brain.png')

# Volume source estimates
mne.viz.plot_volume_source_estimates(stc_vol, src,
                                      subject=subject, subjects_dir=subjects_dir)

# Vector source estimates
mne.viz.plot_vector_source_estimates(stc_vec, subject=subject)
```

## ICA

```python
ica.plot_components(picks=range(20))                    # component topographies
ica.plot_sources(raw)                                   # component time courses
ica.plot_properties(raw, picks=[0, 1, 2])               # detailed per-component
ica.plot_scores(eog_scores)                             # correlation scores
ica.plot_overlay(raw, exclude=[0, 1])                   # before/after overlay
```

## Sensors and Layout

```python
raw.plot_sensors(show_names=True, kind='topomap')       # 2D sensor map
mne.viz.plot_montage(mne.channels.make_standard_montage('standard_1020'))
mne.viz.plot_layout(mne.channels.find_layout(info))

# Coregistration check
mne.viz.plot_alignment(info, trans, subject, subjects_dir,
                        surfaces=['head', 'brain'], meg='sensors', eeg='original')
```

## Publication Figures

```python
import matplotlib.pyplot as plt

# Custom multi-panel figure
fig, axes = plt.subplots(1, 3, figsize=(12, 4))
evoked.plot_topomap(times=[0.1, 0.2, 0.3], axes=axes, show=False,
                     colorbar=False)
fig.savefig('figure.pdf', dpi=300, bbox_inches='tight')

# Combine evoked with brain screenshot
fig, axes = plt.subplots(2, 1, figsize=(4.5, 3),
                          gridspec_kw=dict(height_ratios=[3, 4]))
evoked.plot(axes=axes[0], show=False)
axes[1].imshow(brain_screenshot)
axes[1].axis('off')

# Brain colorbar
from mpl_toolkits.axes_grid1 import make_axes_locatable
divider = make_axes_locatable(axes[1])
cax = divider.append_axes('right', size='5%', pad=0.2)
mne.viz.plot_brain_colorbar(cax, clim, colormap, label='Activation')
```

## Report Generation

```python
report = mne.Report(title='EEG Analysis')
report.add_raw(raw, title='Raw Data', psd=True)
report.add_epochs(epochs, title='Epochs')
report.add_evokeds(evoked, titles=['Auditory'])
report.add_ica(ica, title='ICA', inst=raw)
report.add_covariance(noise_cov, info, title='Noise Covariance')
report.add_forward(fwd, title='Forward Solution')
report.add_inverse_operator(inv, title='Inverse Operator')
report.add_stc(stc, title='Source Estimate',
               subject=subject, subjects_dir=subjects_dir)
report.save('report.html', overwrite=True, open_browser=False)
```

## 3D Backend

```python
mne.viz.set_3d_backend('pyvistaqt')    # desktop (default)
mne.viz.set_3d_backend('notebook')      # Jupyter notebook

# Browser backend for 2D plots
mne.viz.set_browser_backend('matplotlib')  # or 'qt'
```
