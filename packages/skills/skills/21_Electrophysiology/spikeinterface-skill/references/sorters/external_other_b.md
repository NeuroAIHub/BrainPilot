# External sorters — other (part B: rtsort, waveclus, waveclus_snippets)

Source in repo: `spikeinterface/src/spikeinterface/sorters/external/`
Parent index: [INDEX.md](INDEX.md)
---

Files under `src/spikeinterface/sorters/external/`.

## `rtsort` — `RTSortSorter`

`external/rt_sort.py`. `sorter_name = "rtsort"`, `gpu_capability = "nvidia-required"`,
`handle_multi_segment = False`.
`sorter_description`: "RT-Sort is a real-time spike sorting algorithm that enables sorted
detection of action potentials within 7.5ms±1.5ms after the waveform trough while the recording
remains ongoing. ... See
https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0312438".
`installation_mesg`: `pip install git+https://github.com/braingeneers/braindance#egg=braindance[rt-sort]`,
plus PyTorch/CUDA and (on Linux) Torch-TensorRT.

`_default_params`:

```python
{
    "detection_model": "neuropixels",
    "recording_window_ms": None,
    "stringent_thresh": 0.175,
    "loose_thresh": 0.075,
    "inference_scaling_numerator": 15.4,
    "ms_before": 0.5,
    "ms_after": 0.5,
    "pre_median_ms": 50,
    "inner_radius": 50,
    "outer_radius": 100,
    "min_elecs_for_array_noise_n": 100,
    "min_elecs_for_array_noise_f": 0.1,
    "min_elecs_for_seq_noise_n": 50,
    "min_elecs_for_seq_noise_f": 0.05,
    "min_activity_root_cocs": 2,
    "min_activity_hz": 0.05,
    "max_n_components_latency": 4,
    "min_coc_n": 10,
    "min_coc_p": 10,
    "min_extend_comp_p": 50,
    "elec_patience": 6,
    "split_coc_clusters_amps": True,
    "min_amp_dist_p": 0.1,
    "max_n_components_amp": 4,
    "min_loose_elec_prob": 0.03,
    "min_inner_loose_detections": 3,
    "min_loose_detections_n": 4,
    "min_loose_detections_r_spikes": 1 / 3,
    "min_loose_detections_r_sequences": 1 / 3,
    "max_latency_diff_spikes": 2.5,
    "max_latency_diff_sequences": 2.5,
    "clip_latency_diff_factor": 2,
    "max_amp_median_diff_spikes": 0.45,
    "max_amp_median_diff_sequences": 0.45,
    "clip_amp_median_diff_factor": 2,
    "max_root_amp_median_std_spikes": 2.5,
    "max_root_amp_median_std_sequences": 2.5,
    "repeated_detection_overlap_time": 0.2,
    "min_seq_spikes_n": 10,
    "min_seq_spikes_hz": 0.05,
    "relocate_root_min_amp": 0.8,
    "relocate_root_max_latency": -2,
    "device": "cuda",
    "num_processes": None,
    "ignore_warnings": True,
    "debug": False,
}
```

String-Literal defaults: `detection_model = "neuropixels"`, `device = "cuda"`.

## `waveclus` — `WaveClusSorter`

`external/waveclus.py`. `sorter_name: str = "waveclus"`,
`compiled_name: str = "waveclus_compiled"`, `requires_locations = False`.
`sorter_description`: "WaveClus combines a wavelet-based feature extraction and paramagnetic
clustering with a template-matching approach. It is mainly designed for monotrodes and low-channel
count probes. See https://doi.org/10.1152/jn.00339.2018".
`installation_mesg`: clone https://github.com/csn-le/wave_clus and provide the path via
`WAVECLUS_PATH` or `WaveClusSorter.set_waveclus_path()`.

`_default_params`:

```python
{
    "detect_threshold": 5,
    "detect_sign": -1,  # -1 - 1 - 0
    "feature_type": "wav",
    "scales": 4,
    "min_clus": 20,
    "maxtemp": 0.251,
    "template_sdnum": 3,
    "enable_detect_filter": True,
    "enable_sort_filter": True,
    "detect_filter_fmin": 300,
    "detect_filter_fmax": 3000,
    "detect_filter_order": 4,
    "sort_filter_fmin": 300,
    "sort_filter_fmax": 3000,
    "sort_filter_order": 2,
    "mintemp": 0,
    "w_pre": 20,
    "w_post": 44,
    "alignment_window": 10,
    "stdmax": 50,
    "max_spk": 40000,
    "ref_ms": 1.5,
    "interpolation": True,
    "keep_good_only": True,
    "chunk_memory": "500M",
}
```

`detect_sign` enumerated values: `-1`, `1`, `0`. `feature_type` observed default: `"wav"`.

## `waveclus_snippets` — `WaveClusSnippetsSorter`

`external/waveclus_snippets.py`. `sorter_name: str = "waveclus_snippets"`,
`compiled_name: str = "waveclus_snippets_compiled"`, `requires_locations = False`.
`sorter_description`: same wording as waveclus. `installation_mesg`: clone
https://github.com/csn-le/wave_clus and set `WAVECLUS_PATH` or call
`WaveClusSnippetsSorter.set_waveclus_path()`.

`_default_params`:

```python
{
    "feature_type": "wav",
    "scales": 4,
    "min_clus": 20,
    "maxtemp": 0.251,
    "template_sdnum": 3,
    "mintemp": 0,
    "stdmax": 50,
    "max_spk": 40000,
    "keep_good_only": True,
    "chunk_memory": "500M",
}
```

`feature_type` observed default: `"wav"`.
