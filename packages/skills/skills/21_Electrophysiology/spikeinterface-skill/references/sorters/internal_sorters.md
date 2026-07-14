# Internal sorters

Source in repo: `spikeinterface/src/spikeinterface/sorters/internal/`
Parent index: [INDEX.md](INDEX.md)
---

Files under `src/spikeinterface/sorters/internal/`.

## `simple` — `SimpleSorter`

`sorters/internal/simplesorter.py`. `sorter_name = "simple"`, `handle_multi_segment = True`.
No `sorter_description` class attribute; class docstring: "Implementation of a very simple
sorter useful for teaching. Detects peaks, projects waveforms with SVD or PCA, applies a
well-known clustering algo from scikit-learn. No template matching. No auto cleaning. Mainly
useful for few channels (1 to 8), teaching and testing."

`_default_params`:

```python
{
    "apply_preprocessing": True,
    "freq_min": 150.0,
    "freq_max": 6000.0,
    "peak_sign": "neg",
    "detect_threshold": 5.0,
    "ms_before": 1.0,
    "ms_after": 1.5,
    "n_svd_components_per_channel": 5,
    "clusterer": "hdbscan",
    "clusterer_kwargs": {},
    "seed": None,
    "job_kwargs": {},
}
```

## `spykingcircus2` — `Spykingcircus2Sorter`

`sorters/internal/spyking_circus2.py`. `sorter_name = "spykingcircus2"`,
`handle_multi_segment = True`.
Install hint: `pip install 'spikeinterface[spykingcircus2]'`.
`sorter_description`: "Spyking Circus 2 is a rewriting of Spyking Circus, within the
SpikeInterface framework. ... uses a full Orthogonal Matching Pursuit engine ..."

`_default_params`:

```python
{
    "general": {"ms_before": 0.5, "ms_after": 1.5, "radius_um": 100.0},
    "filtering": {"freq_min": 150, "freq_max": 7000, "ftype": "bessel", "filter_order": 2},
    "whitening": {"mode": "local", "regularize": False},
    "detection": {
        "method": "matched_filtering",
        "method_kwargs": dict(peak_sign="neg", detect_threshold=5),
        "pipeline_kwargs": dict(),
    },
    "selection": {
        "method": "uniform",
        "method_kwargs": dict(n_peaks_per_channel=5000, min_n_peaks=100000, select_per_channel=False),
    },
    "apply_motion_correction": True,
    "motion_correction": {"preset": "dredge_fast"},
    "merging": {"max_distance_um": 50},
    "clustering": {"method": "iterative-hdbscan", "method_kwargs": dict()},
    "cleaning": {"min_snr": 5, "max_jitter_ms": 0.2, "sparsify_threshold": 1, "mean_sd_ratio_threshold": 3},
    "min_firing_rate": 0.1,
    "matching": {"method": "circus-omp", "method_kwargs": dict(), "pipeline_kwargs": dict()},
    "apply_preprocessing": True,
    "apply_whitening": True,
    "cache_preprocessing": {"mode": "memory", "memory_limit": 0.5},
    "chunk_preprocessing": {"memory_limit": None},
    "multi_units_only": False,
    "job_kwargs": {},
    "seed": 42,
    "deterministic_peaks_detection": False,
    "debug": False,
}
```

String-Literal parameter values observed:
`filtering.ftype = "bessel"`, `whitening.mode = "local"`,
`detection.method = "matched_filtering"` and `detection.method_kwargs.peak_sign = "neg"`,
`selection.method = "uniform"`, `motion_correction.preset = "dredge_fast"`,
`clustering.method = "iterative-hdbscan"`, `matching.method = "circus-omp"`,
`cache_preprocessing.mode = "memory"`.

## `tridesclous2` — `Tridesclous2Sorter`

`sorters/internal/tridesclous2.py`. `sorter_name = "tridesclous2"`,
`handle_multi_segment = True`.
Install hint: `pip install 'spikeinterface[tridesclous2]'`. No class-level
`sorter_description` attribute.

`_default_params`:

```python
{
    "apply_preprocessing": True,
    "preprocessing_dict": None,
    "apply_motion_correction": False,
    "motion_correction_preset": "dredge_fast",
    "clustering_ms_before": 0.5,
    "clustering_ms_after": 1.5,
    "detection_radius_um": 150.0,
    "features_radius_um": 120.0,
    "split_radius_um": 60.0,
    "template_radius_um": 100.0,
    "merge_similarity_lag_ms": 0.5,
    "freq_min": 150.0,
    "freq_max": 6000.0,
    "cache_preprocessing_mode": "auto",
    "peak_sign": "neg",
    "detect_threshold": 5.0,
    "n_peaks_per_channel": 5000,
    "n_svd_components_per_channel": 5,
    "n_pca_features": 6,
    "clustering_recursive_depth": 3,
    "ms_before": 1.0,
    "ms_after": 2.5,
    "template_sparsify_threshold": 1.5,
    "template_min_snr_ptp": 3.5,
    "template_max_jitter_ms": 0.2,
    "min_firing_rate": 0.1,
    "gather_mode": "memory",
    "job_kwargs": {},
    "seed": None,
    "save_array": True,
    "debug": False,
}
```

String-Literal values: `motion_correction_preset = "dredge_fast"`,
`cache_preprocessing_mode = "auto"`, `peak_sign = "neg"`, `gather_mode = "memory"`.

## `lupin` — `LupinSorter`

`sorters/internal/lupin.py`. `sorter_name = "lupin"`, `handle_multi_segment = True`.
Install hint: `pip install 'spikeinterface[lupin]'`. No class-level `sorter_description`;
class docstring: "Gentleman thief spike sorter. Composed of pieces of code and ideas stolen
from yass, tridesclous, spyking-circus, kilosort. Aims to be the best sorter buildable using
spikeinterface.sortingcomponents."

`_default_params`:

```python
{
    "apply_preprocessing": True,
    "preprocessing_dict": None,
    "apply_motion_correction": False,
    "motion_correction_preset": "dredge_fast",
    "clustering_ms_before": 0.3,
    "clustering_ms_after": 1.3,
    "whitening_radius_um": 100.0,
    "detection_radius_um": 50.0,
    "features_radius_um": 120.0,
    "split_radius_um": 60.0,
    "template_radius_um": 100.0,
    "merge_similarity_lag_ms": 0.5,
    "freq_min": 150.0,
    "freq_max": 7000.0,
    "cache_preprocessing_mode": "auto",
    "peak_sign": "neg",
    "detect_threshold": 5.0,
    "n_peaks_per_channel": 5000,
    "n_svd_components_per_channel": 5,
    "n_pca_features": 4,
    "clustering_recursive_depth": 3,
    "ms_before": 1.0,
    "ms_after": 2.5,
    "template_sparsify_threshold": 1.0,
    "template_min_snr_ptp": 4.0,
    "template_max_jitter_ms": 0.2,
    "template_matching_engine": "wobble",
    "min_firing_rate": 0.1,
    "gather_mode": "memory",
    "job_kwargs": {},
    "seed": None,
    "save_array": True,
    "debug": False,
}
```

String-Literal values: `motion_correction_preset = "dredge_fast"`,
`cache_preprocessing_mode = "auto"`, `peak_sign = "neg"`,
`template_matching_engine = "wobble"`, `gather_mode = "memory"`.

## `kilosort4_like` (optional) — `Kilosort4LikeSorter`

Only present if the optional third-party package `spikeinterface_kilosort_components` is
installed. Registered from `spikeinterface_kilosort_components.kilosort_like_sorter
.Kilosort4LikeSorter`. Retrieve defaults with `get_default_sorter_params("kilosort4_like")`
when available.
