# External sorters — mountainsort4, mountainsort5, spykingcircus, tridesclous

Source in repo: `spikeinterface/src/spikeinterface/sorters/external/`
Parent index: [INDEX.md](INDEX.md)
---

Files under `src/spikeinterface/sorters/external/`.

## `mountainsort4` — `Mountainsort4Sorter`

`external/mountainsort4.py`. `sorter_name = "mountainsort4"`, `requires_locations = False`,
`compatible_with_parallel = {"loky": True, "multiprocessing": False, "threading": False}`.
`sorter_description`: "Mountainsort4 is a fully automatic density-based spike sorter using the
isosplit clustering method and automatic curation procedures. ... See
https://doi.org/10.1016/j.neuron.2017.08.030".
`installation_mesg`: `pip install mountainsort4`.

`_default_params`:

```python
{
    "detect_sign": -1,  # Use -1, 0, or 1, depending on the sign of the spikes in the recording
    "adjacency_radius": -1,  # Use -1 to include all channels in every neighborhood
    "freq_min": 300,  # Use None for no bandpass filtering
    "freq_max": 6000,
    "filter": True,
    "whiten": True,  # Whether to do channel whitening as part of preprocessing
    "num_workers": 1,
    "clip_size": 50,
    "detect_threshold": 3,
    "detect_interval": 10,  # Minimum number of timepoints between events detected on the same channel
    "tempdir": None,
}
```

`detect_sign` enumerated values: `-1`, `0`, `1`.

## `mountainsort5` — `Mountainsort5Sorter`

`external/mountainsort5.py`. `sorter_name = "mountainsort5"`, `requires_locations = False`,
`requires_binary_data = True`,
`compatible_with_parallel = {"loky": False, "multiprocessing": False, "threading": False}`.
`sorter_description`: "MountainSort5 uses Isosplit clustering. It is an updated version of
MountainSort4. See https://doi.org/10.1016/j.neuron.2017.08.030".
`installation_mesg`: `pip install mountainsort5`.

`_default_params`:

```python
{
    "scheme": "2",  # '1', '2', '3'
    "detect_threshold": 5.5,  # this is the recommended detection threshold
    "detect_sign": -1,
    "detect_time_radius_msec": 0.5,
    "snippet_T1": 20,
    "snippet_T2": 20,
    "npca_per_channel": 3,
    "npca_per_subdivision": 10,
    "snippet_mask_radius": 250,
    "scheme1_detect_channel_radius": 150,
    "scheme2_phase1_detect_channel_radius": 200,
    "scheme2_detect_channel_radius": 50,
    "scheme2_max_num_snippets_per_training_batch": 200,
    "scheme2_training_duration_sec": 60 * 5,
    "scheme2_training_recording_sampling_mode": "uniform",
    "scheme3_block_duration_sec": 60 * 30,
    "freq_min": 300,
    "freq_max": 6000,
    "filter": True,
    "whiten": True,  # Important to do whitening
    "whitening_seed": None,  # seed for whitening's random chunk selection (None = nondeterministic)
    "delete_temporary_recording": True,
}
```

String-Literal enumerations: `scheme`: `"1"`, `"2"` (default), `"3"`.
`scheme2_training_recording_sampling_mode` observed default: `"uniform"`.

## `spykingcircus` — `SpykingcircusSorter`

`external/spyking_circus.py`. `sorter_name = "spykingcircus"`, `requires_locations = False`,
`handle_multi_segment = False`.
`sorter_description`: "Spyking Circus is a python-based template-matching spike sorter. ... See
https://doi.org/10.7554/eLife.34518".
`installation_mesg`: `pip install spyking-circus`; needs MPICH (ubuntu:
`sudo apt install libmpich-dev mpich`).

`_default_params`:

```python
{
    "detect_sign": -1,  # -1 - 1 - 0
    "adjacency_radius": 100,  # Channel neighborhood adjacency radius corresponding to geom file
    "detect_threshold": 6,  # Threshold for detection
    "template_width_ms": 3,  # Spyking circus parameter
    "filter": True,
    "merge_spikes": True,
    "auto_merge": 0.75,
    "num_workers": None,
    "whitening_max_elts": 1000,  # I believe it relates to subsampling and affects compute time
    "clustering_max_elts": 10000,  # I believe it relates to subsampling and affects compute time
}
```

`detect_sign` enumerated values: `-1`, `1`, `0`.

## `tridesclous` — `TridesclousSorter`

`external/tridesclous.py`. `sorter_name = "tridesclous"`, `requires_locations = False`,
`requires_binary_data = True`, `handle_multi_segment = True`,
`compatible_with_parallel = {"loky": True, "multiprocessing": False, "threading": False}`.
`sorter_description`: "Tridesclous is a template-matching spike sorter with a real-time engine.
See https://tridesclous.readthedocs.io".
`installation_mesg`: `pip install tridesclous`.

`_default_params`:

```python
{
    "freq_min": 400.0,
    "freq_max": 5000.0,
    "detect_sign": -1,
    "detect_threshold": 5,
    "common_ref_removal": False,
    "nested_params": None,
}
```
