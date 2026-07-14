# External Kilosort family (part B: kilosort3, kilosort4, pykilosort)

Source in repo: `spikeinterface/src/spikeinterface/sorters/external/`
Parent index: [INDEX.md](INDEX.md)
---

Files under `src/spikeinterface/sorters/external/`.

## `kilosort3` — `Kilosort3Sorter`

`external/kilosort3.py`. `sorter_name: str = "kilosort3"`,
`compiled_name: str = "ks3_compiled"`, `requires_locations = False`,
`handle_multi_segment = False`.
`sorter_description`: "Kilosort3 is a GPU-accelerated ... See https://github.com/MouseLand/Kilosort".
`installation_mesg`: clone https://github.com/MouseLand/Kilosort and set `KILOSORT3_PATH` or
call `Kilosort3Sorter.set_kilosort3_path()`.

`_default_params`:

```python
{
    "detect_threshold": 6,
    "projection_threshold": [9, 9],
    "preclust_threshold": 8,
    "whiteningRange": 32,
    "car": True,
    "minFR": 0.2,
    "minfr_goodchannels": 0.2,
    "nblocks": 5,
    "sig": 20,
    "freq_min": 300,
    "sigmaMask": 30,
    "lam": 20.0,
    "nPCs": 3,
    "ntbuff": 64,
    "nfilt_factor": 4,
    "do_correction": True,
    "NT": None,
    "AUCsplit": 0.8,
    "wave_length": 61,
    "keep_good_only": False,
    "skip_kilosort_preprocessing": False,
    "scaleproc": None,
    "save_rez_to_mat": False,
    "delete_tmp_files": ("matlab_files",),
    "delete_recording_dat": False,
}
```

`delete_tmp_files` tuple element: `"matlab_files"`.

## `kilosort4` — `Kilosort4Sorter`

`external/kilosort4.py`. `sorter_name: str = "kilosort4"`, `requires_locations = True`,
`gpu_capability = "nvidia-optional"`, `requires_binary_data = True`,
`handle_multi_segment = False`.
`sorter_description`: "Kilosort4 is a Python package for spike sorting on GPUs with template
matching. ... For more information see https://github.com/MouseLand/Kilosort".
`installation_mesg`: `pip install kilosort --upgrade`.

Kilosort4 does NOT define `_default_params` directly. It defines `_si_default_params` and
implements `_dynamic_params()`, which merges `kilosort.parameters.MAIN_PARAMETERS` +
`kilosort.parameters.EXTRA_PARAMETERS` (minus `fs`, `n_chan_bin`, `tmin`, `tmax`) with the
SI-side overrides:

```python
_si_default_params = {
    "do_CAR": True,
    "invert_sign": False,
    "save_extra_vars": False,
    "save_preprocessed_copy": False,
    "torch_device": "auto",
    "bad_channels": None,
    "clear_cache": False,
    "do_correction": True,
    "skip_kilosort_preprocessing": False,
    "keep_good_only": False,
    "use_binary_file": True,
    "delete_recording_dat": True,
}
```

String-Literal values: `torch_device = "auto"` (with `"auto"`/`"cuda"`/`"cpu"` documented in
`_si_params_description`).

## `pykilosort` — `PyKilosortSorter`

`external/pykilosort.py`. `sorter_name = "pykilosort"`, `requires_locations = False`,
`requires_binary_data = True`, `gpu_capability = "nvidia-required"`,
`handle_multi_segment = False`,
`compatible_with_parallel = {"loky": True, "multiprocessing": False, "threading": False}`.
`sorter_description`: "pykilosort is a port of kilosort to python".
`installation_mesg`: `pip install cupy` + clone
https://github.com/MouseLand/pykilosort + `python setup.py install`.

`_default_params`:

```python
{
    "low_memory": False,
    "seed": 42,
    "preprocessing_function": "kilosort2",
    "save_drift_spike_detections": False,
    "perform_drift_registration": False,
    "do_whitening": True,
    "save_temp_files": True,
    "fshigh": 300.0,
    "fslow": None,
    "minfr_goodchannels": 0.1,
    "genericSpkTh": 8.0,
    "nblocks": 5,
    "sig_datashift": 20.0,
    "stable_mode": True,
    "deterministic_mode": True,
    "datashift": None,
    "Th": [10, 4],
    "ThPre": 8,
    "lam": 10,
    "minFR": 1.0 / 50,
    "momentum": [20, 400],
    "sigmaMask": 30,
    "spkTh": -6,
    "reorder": 1,
    "nSkipCov": 25,
    "ntbuff": 64,
    "whiteningRange": 32,
    "scaleproc": 200,
    "nPCs": 3,
    "nt0": 61,
    "nup": 10,
    "sig": 1,
    "gain": 1,
    "templateScaling": 20.0,
    "loc_range": [5, 4],
    "long_range": [30, 6],
    "keep_good_only": False,
}
```

`preprocessing_function` observed default: `"kilosort2"`.
