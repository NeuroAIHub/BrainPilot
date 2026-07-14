# External Kilosort family (part A: kilosort, kilosort2, kilosort2_5)

Source in repo: `spikeinterface/src/spikeinterface/sorters/external/`
Parent index: [INDEX.md](INDEX.md)
---

Files under `src/spikeinterface/sorters/external/`.

## `kilosort` — `KilosortSorter`

`external/kilosort.py`. `sorter_name: str = "kilosort"`,
`compiled_name: str = "ks_compiled"`, `requires_locations = False`,
`requires_gpu = "nvidia-optional"` (note: this class uses `requires_gpu`, not the newer
`gpu_capability`; base default `gpu_capability = "not-supported"` still applies unless
overridden — this is an inconsistency in the source), `handle_multi_segment = False`.
`sorter_description`: "Kilosort is a GPU-accelerated and efficient template-matching spike
sorter. See https://papers.nips.cc/paper/6326-fast-and-accurate-spike-sorting-of-high-channel-count-probes-with-kilosort".
`installation_mesg`: clone https://github.com/cortex-lab/KiloSort and set `KILOSORT_PATH` or
call `KilosortSorter.set_kilosort_path()`.

`_default_params`:

```python
{
    "detect_threshold": 6,
    "car": True,
    "useGPU": True,
    "freq_min": 300,
    "freq_max": 6000,
    "ntbuff": 64,
    "Nfilt": None,
    "NT": None,
    "wave_length": 61,
    "delete_tmp_files": ("matlab_files",),
    "delete_recording_dat": False,
    "parfor": 0.0,
    "nNeighPC": None,
    "nNeigh": 16.0,
    "whitening": "full",
    "nSkipCov": 1.0,
    "whiteningRange": 32.0,
    "Nrank": 3.0,
    "nfullpasses": 6.0,
    "maxFR": 20000,
    "Th": [4.0, 10.0, 10.0],
    "lam": [5.0, 5.0, 5.0],
    "nannealpasses": 4.0,
    "momentum": [1 / 20, 1 / 400],
    "shuffle_clusters": 1.0,
    "mergeT": 0.1,
    "splitT": 0.1,
    "initialize": "fromData",
    "loc_range": [3.0, 1.0],
    "long_range": [30.0, 6.0],
    "maskMaxChannels": 5.0,
    "crit": 0.65,
    "nFiltMax": 10000.0,
    "fracse": 0.1,
    "epu": np.inf,
    "ForceMaxRAMforDat": 20e9,
}
```

String-Literal defaults: `whitening = "full"`, `initialize = "fromData"`,
`delete_tmp_files` tuple element `"matlab_files"`.

## `kilosort2` — `Kilosort2Sorter`

`external/kilosort2.py`. `sorter_name: str = "kilosort2"`,
`compiled_name: str = "ks2_compiled"`, `requires_locations = False`,
`handle_multi_segment = False`.
`sorter_description`: "Kilosort2 is a GPU-accelerated and efficient template-matching spike
sorter. On top of its predecessor Kilosort, it implements a drift-correction strategy. See
https://github.com/MouseLand/Kilosort2".
`installation_mesg`: clone https://github.com/MouseLand/Kilosort2 and set `KILOSORT2_PATH` or
call `Kilosort2Sorter.set_kilosort2_path()`.

`_default_params`:

```python
{
    "detect_threshold": 6,
    "projection_threshold": [10, 4],
    "preclust_threshold": 8,
    "whiteningRange": 32,  # samples of the template to use for whitening "spatial" dimension
    "momentum": [20.0, 400.0],
    "car": True,
    "minFR": 0.1,
    "minfr_goodchannels": 0.1,
    "freq_min": 150,
    "sigmaMask": 30,
    "lam": 10.0,
    "nPCs": 3,
    "ntbuff": 64,
    "nfilt_factor": 4,
    "NT": None,
    "AUCsplit": 0.9,
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

## `kilosort2_5` — `Kilosort2_5Sorter`

`external/kilosort2_5.py`. `sorter_name: str = "kilosort2_5"`,
`compiled_name: str = "ks2_5_compiled"`, `requires_locations = False`,
`handle_multi_segment = False`.
`sorter_description`: "Kilosort2_5 is a GPU-accelerated ... uses sub-pixel registration for
drift correction. Expected to work on Neuropixels 1.0/2.0 and probes with vertical pitch <=40um.
See https://github.com/MouseLand/Kilosort".
`installation_mesg`: clone https://github.com/MouseLand/Kilosort and set `KILOSORT2_5_PATH` or
call `Kilosort2_5Sorter.set_kilosort2_5_path()`.

`_default_params`:

```python
{
    "detect_threshold": 6,
    "projection_threshold": [10, 4],
    "preclust_threshold": 8,
    "whiteningRange": 32.0,
    "momentum": [20.0, 400.0],
    "car": True,
    "minFR": 0.1,
    "minfr_goodchannels": 0.1,
    "nblocks": 5,
    "sig": 20,
    "freq_min": 150,
    "sigmaMask": 30,
    "lam": 10.0,
    "nPCs": 3,
    "ntbuff": 64,
    "nfilt_factor": 4,
    "NT": None,
    "AUCsplit": 0.9,
    "do_correction": True,
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
