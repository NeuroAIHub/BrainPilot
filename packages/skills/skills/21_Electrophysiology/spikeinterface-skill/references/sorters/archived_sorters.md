# Archived sorters

Source in repo: `spikeinterface/src/spikeinterface/sorters/external/`
Parent index: [INDEX.md](INDEX.md)
---

Present in `sorter_full_list` and/or `archived_sorter_list`. `run_sorter("klusta", ...)` and
`run_sorter("yass", ...)` both raise
`ValueError("The sorter {sorter_name} is archived and no longer supported. ...")` because
`sorter_name` appears in `archived_sorters()`.

## `klusta` — `KlustaSorter`

`external/klusta.py`. `sorter_name = "klusta"`, `requires_locations = False`,
`requires_binary_data = True`.
`sorter_description`: "Klusta is a density-based spike sorter that uses a masked EM approach for
clustering. See https://doi.org/10.1038/nn.4268".
`installation_mesg`: `pip install Cython h5py tqdm` then `pip install click klusta klustakwik2`.

`_default_params`:

```python
{
    "adjacency_radius": None,
    "threshold_strong_std_factor": 5,
    "threshold_weak_std_factor": 2,
    "detect_sign": -1,
    "extract_s_before": 16,
    "extract_s_after": 32,
    "n_features_per_channel": 3,
    "pca_n_waveforms_max": 10000,
    "num_starting_clusters": 50,
}
```

Note: `KlustaSorter` is imported at the top of `sorterlist.py` but NOT included in
`sorter_full_list`; it lives only in `archived_sorter_list`.

## `yass` — `YassSorter`

`external/yass.py`. `sorter_name = "yass"`, `requires_locations = False`,
`requires_binary_data = True`, `gpu_capability = "nvidia-required"`.
`sorter_description`: "YASS is a deconvolution and neural network based spike sorting algorithm
designed for recordings with no drift (such as retinal recordings). See
https://www.biorxiv.org/content/10.1101/2020.03.18.997924v1".
`installation_mesg`: `pip install yass-algorithm`.

`_default_params`:

```python
{
    "dtype": "int16",  # the only datatype that Yass currently accepts;
    "freq_min": 300,   # High-pass filter cutoff frequency
    "freq_max": 0.3,   # Low-pass filter cutoff frequency as proportion of sampling rate
    "neural_nets_path": None,  # default NNs are set to None - Yass will always retrain on dataset
    "multi_processing": 1,     # 0: single core; 1: multi CPU core
    "n_processors": 1,
    "n_gpu_processors": 1,
    "n_sec_chunk": 10,
    "n_sec_chunk_gpu_detect": 0.5,
    "n_sec_chunk_gpu_deconv": 5,
    "gpu_id": 0,
    "generate_phy": 0,          # 0 - do not run; 1: generate phy files
    "phy_percent_spikes": 0.05,
    "spatial_radius": 70,
    "spike_size_ms": 5,
    "clustering_chunk": [0, 300],
    "update_templates": 0,
    "neuron_discover": 0,
    "template_update_time": 300,
}
```

`dtype` enumerated value: `"int16"` (only accepted value). Note: `YassSorter` appears BOTH in
`sorter_full_list` and in `archived_sorter_list` in the source, but `available_sorters()` still
returns `"yass"` while `run_sorter("yass", ...)` raises.
