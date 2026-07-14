# External sorters — other (part A: combinato, hdsort, herdingspikes, ironclust)

Source in repo: `spikeinterface/src/spikeinterface/sorters/external/`
Parent index: [INDEX.md](INDEX.md)
---

Files under `src/spikeinterface/sorters/external/`.

## `combinato` — `CombinatoSorter`

`external/combinato.py`. `sorter_name: str = "combinato"`, `requires_locations = False`,
`handle_multi_segment = False`.
`sorter_description`: "Combinato is a complete data-analysis framework for spike sorting in
noisy recordings ... See https://doi:10.1371/journal.pone.0166598".
`installation_mesg`: clone https://github.com/jniediek/combinato and set `COMBINATO_PATH` or
call `CombinatoSorter.set_combinato_path()`.

`_default_params`:

```python
{
    "detect_sign": -1,  # -1 - 1 - 0
    "MaxClustersPerTemp": 5,
    "MinSpikesPerClusterMultiSelect": 15,
    "RecursiveDepth": 1,
    "ReclusterClusters": True,
    "MinInputSizeRecluster": 2000,
    "FirstMatchFactor": 0.75,
    "SecondMatchFactor": 3,
    "MaxDistMatchGrouping": 1.8,
    "detect_threshold": 5,
    "max_spike_duration": 0.0015,
    "indices_per_spike": 64,
    "index_maximum": 19,
    "upsampling_factor": 3,
    "denoise": True,
    "do_filter": True,
    "keep_good_only": True,
    "chunk_memory": "500M",
}
```

`detect_sign` enumerated values (from inline comment): `-1`, `1`, `0`.

## `hdsort` — `HDSortSorter`

`external/hdsort.py`. `sorter_name: str = "hdsort"`, `compiled_name: str = "hdsort_compiled"`,
`requires_locations = False`, `handle_multi_segment = False`.
`sorter_description`: "HDsort is a template-matching spike sorter designed for high density
micro-electrode arrays. See https://doi.org/10.1152/jn.00803.2017".
`installation_mesg`: clone https://git.bsse.ethz.ch/hima_public/HDsort.git and set
`HDSORT_PATH` or call `HDSortSorter.set_hdsort_path()`.

`_default_params`:

```python
{
    "detect_threshold": 4.2,
    "detect_sign": -1,  # -1 - 1
    "filter": True,
    "parfor": True,
    "freq_min": 300,
    "freq_max": 7000,
    "max_el_per_group": 9,
    "min_el_per_group": 1,
    "add_if_nearer_than": 20,
    "max_distance_within_group": 52,
    "n_pc_dims": 6,
    "chunk_size": 500000,
    "loop_mode": "local_parfor",
    "chunk_memory": "500M",
}
```

`detect_sign` enumerated values: `-1`, `1`. `loop_mode` observed default: `"local_parfor"`.

## `herdingspikes` — `HerdingspikesSorter`

`external/herdingspikes.py`. `sorter_name = "herdingspikes"`, `requires_locations = True`,
`handle_multi_segment = False`,
`compatible_with_parallel = {"loky": True, "multiprocessing": True, "threading": False}`.
`sorter_description`: "HerdingSpikes is a density-based spike sorter designed for large-scale
high-density recordings ... See https://www.sciencedirect.com/science/article/pii/S221112471730236X".
`installation_mesg`: `pip install herdingspikes`. More info at https://github.com/mhhennig/hs2.

`_default_params`:

```python
{
    "chunk_size": None,
    "rescale": True,
    "rescale_value": -1280.0,
    "lowpass": True,
    "common_reference": "median",
    "spike_duration": 1.0,
    "amp_avg_duration": 0.4,
    "threshold": 8.0,
    "min_avg_amp": 1.0,
    "AHP_thr": 0.0,
    "neighbor_radius": 90.0,
    "inner_radius": 70.0,
    "peak_jitter": 0.25,
    "rise_duration": 0.26,
    "decay_filtering": False,
    "decay_ratio": 1.0,
    "localize": True,
    "save_shape": True,
    "out_file": "HS2_detected",
    "left_cutout_time": 0.3,
    "right_cutout_time": 1.8,
    "verbose": True,
    "clustering_bandwidth": 4.0,
    "clustering_alpha": 4.5,
    "clustering_n_jobs": -1,
    "clustering_bin_seeding": True,
    "clustering_min_bin_freq": 4,
    "clustering_subset": None,
    "pca_ncomponents": 2,
    "pca_whiten": True,
}
```

`common_reference` observed default: `"median"`. `out_file` observed default: `"HS2_detected"`.

## `ironclust` — `IronClustSorter`

`external/ironclust.py`. `sorter_name: str = "ironclust"`,
`compiled_name: str = "p_ironclust"`, `requires_locations = True`,
`requires_binary_data = True`, `gpu_capability = "nvidia-optional"`,
`handle_multi_segment = False`.
Description attribute is misspelled `sorter_descrpition` in source — a bug: reading
`sorter_description` returns the `BaseSorter` default (empty string). The intended text is
"IronClust is a density-based spike sorter designed for high-density probes (e.g. Neuropixels).
It uses features and spike location estimates for clustering and performs drift correction.
See https://doi.org/10.1101/101030".
`installation_mesg`: clone https://github.com/flatironinstitute/ironclust and set
`IRONCLUST_PATH` or call `IronClustSorter.set_ironclust_path()`.

`_default_params`:

```python
{
    "detect_sign": -1,  # Use -1, 0, or 1, depending on the sign of the spikes in the recording
    "adjacency_radius": 50,  # Use -1 to include all channels in every neighborhood
    "adjacency_radius_out": 100,  # Use -1 to include all channels in every neighborhood
    "detect_threshold": 3.5,  # detection threshold
    "prm_template_name": "",  # .prm template file name
    "freq_min": 300,
    "freq_max": 8000,
    "merge_thresh": 0.985,  # Threshold for automated merging
    "pc_per_chan": 9,  # Number of principal components per channel
    "whiten": False,  # Whether to do channel whitening as part of preprocessing
    "filter_type": "bandpass",  # none, bandpass, wiener, fftdiff, ndiff
    "filter_detect_type": "none",  # none, bandpass, wiener, fftdiff, ndiff
    "common_ref_type": "trimmean",  # none, mean, median
    "batch_sec_drift": 300,  # batch duration in seconds. clustering time duration
    "step_sec_drift": 20,  # compute anatomical similarity every n sec
    "knn": 30,  # K nearest neighbors
    "min_count": 30,  # Minimum cluster size
    "fGpu": True,  # Use GPU if available
    "fft_thresh": 8,  # FFT-based noise peak threshold
    "fft_thresh_low": 0,  # FFT-based noise peak lower threshold (set to 0 to disable dual thresholding scheme)
    "nSites_whiten": 16,  # Number of adjacent channels to whiten
    "feature_type": "gpca",  # gpca, pca, vpp, vmin, vminmax, cov, energy, xcov
    "delta_cut": 1,  # Cluster detection threshold (delta-cutoff)
    "post_merge_mode": 1,  # post merge mode
    "sort_mode": 1,  # sort mode
    "fParfor": False,  # parfor loop
    "filter": True,  # Enable or disable filter
    "clip_pre": 0.25,  # pre-peak clip duration in ms
    "clip_post": 0.75,  # post-peak clip duration in ms
    "merge_thresh_cc": 1,  # cross-correlogram merging threshold, set to 1 to disable
    "nRepeat_merge": 3,  # number of repeats for merge
    "merge_overlap_thresh": 0.95,  # knn-overlap merge threshold
    "version": 2,
}
```

String-Literal enumerations from inline comments:

- `detect_sign`: `-1`, `0`, `1`.
- `filter_type`: `"none"`, `"bandpass"`, `"wiener"`, `"fftdiff"`, `"ndiff"`.
- `filter_detect_type`: `"none"`, `"bandpass"`, `"wiener"`, `"fftdiff"`, `"ndiff"`.
- `common_ref_type`: `"none"`, `"mean"`, `"median"`, `"trimmean"` (default).
- `feature_type`: `"gpca"`, `"pca"`, `"vpp"`, `"vmin"`, `"vminmax"`, `"cov"`, `"energy"`,
  `"xcov"`.
