# Decoding & MVPA Reference

## Table of Contents
1. [MNE Transformers](#transformers)
2. [Temporal Decoding](#temporal-decoding)
3. [Temporal Generalization](#temporal-generalization)
4. [CSP (Common Spatial Patterns)](#csp)
5. [SPoC, SSD, Xdawn](#spoc-ssd-xdawn)
6. [Receptive Field Estimation](#receptive-field)
7. [Source-Space Decoding](#source-decoding)
8. [Utility Functions](#utilities)

## MNE Transformers (sklearn-compatible)

| Transformer | Purpose |
|-------------|---------|
| `Scaler(info, scalings='mean')` | Channel-type-aware standardization |
| `Vectorizer()` | Reshape (n_epochs, n_ch, n_times) → (n_epochs, n_features) |
| `FilterEstimator(info, l_freq, h_freq)` | Temporal filtering in pipeline |
| `TemporalFilter(l_freq, h_freq)` | Temporal filtering (no info needed) |
| `PSDEstimator(sfreq, fmin, fmax)` | PSD features |
| `TimeFrequency(freqs, sfreq)` | TFR features |
| `UnsupervisedSpatialFilter(PCA(10))` | Spatial PCA/ICA |
| `LinearModel(LogisticRegression())` | Wrapper for pattern extraction |

## Temporal Decoding

Fit a classifier at each time point independently (King & Dehaene, 2014):

```python
from mne.decoding import SlidingEstimator, cross_val_multiscore
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

X = epochs.get_data(copy=True)  # (n_epochs, n_channels, n_times)
y = epochs.events[:, -1]

clf = make_pipeline(StandardScaler(), LogisticRegression(solver='liblinear'))
slider = SlidingEstimator(clf, scoring='roc_auc', n_jobs=-1)
scores = cross_val_multiscore(slider, X, y, cv=5)
# scores shape: (n_folds, n_times)

# Plot
import matplotlib.pyplot as plt
fig, ax = plt.subplots()
ax.plot(epochs.times, scores.mean(axis=0))
ax.axhline(0.5, color='k', linestyle='--')
ax.set(xlabel='Time (s)', ylabel='AUC', title='Temporal Decoding')
```

## Temporal Generalization

Train at each time, test at all times — reveals dynamics of neural representations:

```python
from mne.decoding import GeneralizingEstimator

gen = GeneralizingEstimator(clf, scoring='roc_auc', n_jobs=-1)
scores = cross_val_multiscore(gen, X, y, cv=5)
# scores shape: (n_folds, n_train_times, n_test_times)

# Plot generalization matrix
fig, ax = plt.subplots()
im = ax.imshow(scores.mean(axis=0), origin='lower', cmap='RdBu_r',
               extent=epochs.times[[0, -1, 0, -1]], vmin=0.3, vmax=0.7)
ax.set(xlabel='Test time (s)', ylabel='Train time (s)')
ax.axhline(0, color='k'); ax.axvline(0, color='k')
plt.colorbar(im, ax=ax, label='AUC')
```

## CSP

Common Spatial Patterns for two-class discrimination (Blankertz et al., 2008):

```python
from mne.decoding import CSP

csp = CSP(n_components=4, reg=None, log=True, norm_trace=False)
clf = make_pipeline(csp, LogisticRegression(solver='liblinear'))
scores = cross_val_multiscore(clf, X, y, cv=5)

# Visualize spatial patterns and filters
csp.fit(X, y)
csp.plot_patterns(epochs.info)   # neurophysiologically interpretable
csp.plot_filters(epochs.info)    # spatial filters applied to data
```

## SPoC, SSD, Xdawn

### SPoC (Source Power Comodulation)
For continuous target variables (not classification):
```python
from mne.decoding import SPoC
from sklearn.linear_model import Ridge

spoc = SPoC(n_components=2, reg='oas', log=True)
clf = make_pipeline(spoc, Ridge())
# Use with continuous y (e.g., reaction time, behavioral score)
```

### SSD (Spatio-Spectral Decomposition)
Maximize signal in target band vs flanking bands:
```python
from mne.decoding import SSD

ssd = SSD(info, filt_params_signal=dict(l_freq=8, h_freq=12),
          filt_params_noise=dict(l_freq=6, h_freq=14))
ssd.fit(X)
X_ssd = ssd.transform(X)
ssd.plot_patterns(info)
```

### Xdawn
Enhance ERP signal for P300/BCI applications:
```python
from mne.decoding import XdawnTransformer

xdawn = XdawnTransformer(n_components=2)
clf = make_pipeline(xdawn, Vectorizer(), LogisticRegression())
scores = cross_val_multiscore(clf, X, y, cv=5)
```

## Receptive Field Estimation

Spectro-temporal receptive field (STRF) analysis:

```python
from mne.decoding import ReceptiveField, TimeDelayingRidge

rf = ReceptiveField(
    tmin=-0.1, tmax=0.4, sfreq=100,
    estimator=TimeDelayingRidge(
        tmin=-0.1, tmax=0.4, sfreq=100,
        reg_type='laplacian', alpha=0.1
    )
)
rf.fit(X_stimulus, y_response)
rf.coef_  # receptive field weights
rf.plot()
```

## Source-Space Decoding

```python
# Apply inverse to get source data, then decode
stcs = apply_inverse_epochs(epochs, inv, lambda2, method='dSPM')
X_source = np.array([stc.data for stc in stcs])  # (n_epochs, n_vertices, n_times)

# Feature selection (reduce dimensionality)
from sklearn.feature_selection import SelectKBest, f_classif
clf = make_pipeline(
    SelectKBest(f_classif, k=500),
    StandardScaler(),
    LogisticRegression()
)
slider = SlidingEstimator(clf, scoring='roc_auc')
scores = cross_val_multiscore(slider, X_source, y, cv=5)
```

## Utility Functions

```python
from mne.decoding import cross_val_multiscore, get_coef, compute_ems

# Cross-validation with multiple scores
scores = cross_val_multiscore(estimator, X, y, cv=5, scoring='roc_auc')

# Extract spatial patterns from LinearModel
from mne.decoding import LinearModel
model = LinearModel(LogisticRegression())
model.fit(X_2d, y)
patterns = get_coef(model, attr='patterns_')  # neurophysiological patterns
filters = get_coef(model, attr='filters_')    # spatial filters

# Effect-matched spatial filtering
evoked_ems = compute_ems(epochs, conditions=['left', 'right'])
```
