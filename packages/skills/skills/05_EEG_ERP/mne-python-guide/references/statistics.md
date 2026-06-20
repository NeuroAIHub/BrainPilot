# Statistics Reference

## Table of Contents
1. [Cluster-Based Permutation Tests](#cluster-permutation)
2. [Spatio-Temporal Cluster Tests](#spatio-temporal)
3. [TFCE](#tfce)
4. [Adjacency Matrices](#adjacency)
5. [Parametric Tests](#parametric)
6. [Multiple Comparison Correction](#correction)
7. [Linear Regression](#regression)
8. [ERP Quality Metrics](#erp-quality)
9. [Source Space Statistics](#source-stats)

## Cluster-Based Permutation Tests

Controls for multiple comparisons by clustering neighboring significant samples (Maris & Oostenveld, 2007):

```python
from mne.stats import permutation_cluster_test, permutation_cluster_1samp_test

# Two-sample test (comparing two conditions)
T_obs, clusters, p_values, H0 = permutation_cluster_test(
    [X1, X2],               # list of arrays, shape (n_obs, n_times)
    n_permutations=1000,
    tail=0,                  # 0=two-tailed, 1=right, -1=left
    threshold=None,          # None=auto, float, or dict for TFCE
    out_type='mask'          # 'mask' or 'indices'
)

# One-sample test (against zero)
T_obs, clusters, p_values, H0 = permutation_cluster_1samp_test(
    X,                       # shape (n_obs, n_times)
    n_permutations=1000,
    tail=0
)

# Find significant clusters
good_clusters = [clusters[i] for i in range(len(clusters)) if p_values[i] < 0.05]
```

## Spatio-Temporal Cluster Tests

For data with both spatial and temporal dimensions:

```python
from mne.stats import spatio_temporal_cluster_test, spatio_temporal_cluster_1samp_test

# Build adjacency matrix
adjacency, ch_names = mne.channels.find_ch_adjacency(epochs.info, 'eeg')

# Data shape: (n_obs, n_times, n_channels) — NOTE: time BEFORE channels!
X1 = cond1_epochs.get_data().transpose(0, 2, 1)  # transpose from (obs, ch, time)
X2 = cond2_epochs.get_data().transpose(0, 2, 1)

# Two-sample
T_obs, clusters, p_values, H0 = spatio_temporal_cluster_test(
    [X1, X2], adjacency=adjacency, n_permutations=1000)

# One-sample
T_obs, clusters, p_values, H0 = spatio_temporal_cluster_1samp_test(
    X, adjacency=adjacency, n_permutations=1000)
```

## TFCE

Threshold-Free Cluster Enhancement — avoids arbitrary cluster-forming threshold:

```python
tfce = dict(start=0.4, step=0.4)  # TFCE parameters
T_obs, clusters, p_values, H0 = spatio_temporal_cluster_test(
    [X1, X2], tfce, adjacency=adjacency, n_permutations=100)
```

## Adjacency Matrices

```python
# From channel layout (most common)
adjacency, ch_names = mne.channels.find_ch_adjacency(info, ch_type='eeg')
# or from template: adjacency, ch_names = mne.channels.read_ch_adjacency('biosemi64')

# Distance-based
adjacency = mne.spatial_dist_adjacency(info, dist=0.04)

# Source space
adjacency = mne.spatial_src_adjacency(src)
adjacency = mne.spatio_temporal_src_adjacency(src, n_times)

# Triangulation-based
adjacency = mne.spatial_tris_adjacency(tris)

# Inter-hemisphere
adjacency = mne.spatial_inter_hemi_adjacency(src, max_dist=0.04)

# Combine for multi-dimensional data (time × freq × space)
adjacency = mne.stats.combine_adjacency(n_times, n_freqs, ch_adjacency)

# Visualize
mne.viz.plot_ch_adjacency(info, adjacency, ch_names)
```

## Parametric Tests

```python
from mne.stats import (f_oneway, f_mway_rm, f_threshold_mway_rm,
                        ttest_1samp_no_p, ttest_ind_no_p)

# One-way ANOVA
F_obs, p_values = f_oneway(X1, X2, X3)

# Repeated measures ANOVA
F_obs, p_values = f_mway_rm(data, factor_levels=[2, 3], effects='A*B')
# effects: 'A', 'B', 'A:B', 'A*B' (main + interaction)

# Get F-threshold for cluster test
threshold = f_threshold_mway_rm(n_subjects, factor_levels=[2, 3],
                                 effects='A*B', pvalue=0.05)

# T-tests (return t-statistic only, no p-value — for use as cluster threshold)
t_obs = ttest_1samp_no_p(X)
t_obs = ttest_ind_no_p(X1, X2)
```

## Multiple Comparison Correction

```python
from mne.stats import bonferroni_correction, fdr_correction

# Bonferroni
reject_bonf, pval_bonf = bonferroni_correction(p_values, alpha=0.05)

# FDR (Benjamini-Hochberg)
reject_fdr, pval_fdr = fdr_correction(p_values, alpha=0.05, method='indep')
# method: 'indep' (Benjamini-Hochberg) or 'negcorr' (Benjamini-Yekutieli)

# Permutation t-test with t-max correction
from mne.stats import permutation_t_test
T_obs, p_values, H0 = permutation_t_test(X, n_permutations=10000, tail=0)
```

## Linear Regression

### On Epochs (with metadata)
```python
from mne.stats import linear_regression

# epochs.metadata must be a pandas DataFrame
results = linear_regression(epochs, design_matrix, names=['intercept', 'condition'])
results['condition'].beta.plot_joint()   # regression coefficients as evoked
results['condition'].t_val.plot_joint()  # t-values
results['condition'].p_val               # p-values
```

### On Raw (continuous regression, overlap correction)
```python
from mne.stats import linear_regression_raw

results = linear_regression_raw(
    raw, events, event_id={'stim': 1, 'resp': 2},
    tmin=-0.1, tmax=1.0,
    covariates=None,       # dict-like for continuous predictors
    reject=dict(eeg=100e-6),
    decim=10               # important for high sfreq data!
)
# Returns dict of Evoked-like objects, one per condition
results['stim'].plot()
```

## ERP Quality Metrics

```python
from mne.stats.erp import compute_sme

# Standardized Measurement Error
sme = compute_sme(epochs)  # returns Evoked-like object
sme.plot()
```

## Source Space Statistics

```python
from mne.stats import summarize_clusters_stc

# Visualize significant source-space clusters
stc_cluster = summarize_clusters_stc(
    clu,                    # output from cluster test
    tstep=tstep,
    vertices=vertices,
    subject='fsaverage'
)
stc_cluster.plot(subject='fsaverage', subjects_dir=subjects_dir)

# Bootstrap confidence intervals
from mne.stats import bootstrap_confidence_interval
ci = bootstrap_confidence_interval(data, ci=0.95, n_bootstraps=2000,
                                    stat_fun='mean')
```
