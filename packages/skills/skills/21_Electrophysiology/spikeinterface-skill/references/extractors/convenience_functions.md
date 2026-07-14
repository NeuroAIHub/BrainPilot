# Convenience functions
Source in repo: `spikeinterface/src/spikeinterface/extractors/` (toy_example.py, nwbextractors.py, neoextractors/mearec.py, neoextractors/neuroscope.py, neoextractors/neo_utils.py)
Parent index: [INDEX.md](INDEX.md)
---

## `toy_example(...)`

Defined in `extractors/toy_example.py`. Rewrite of the historical `spikeinterface.extractor.toy_example()` with a fully lazy backend (`NoiseGeneratorRecording` + `generate_templates` + `InjectTemplatesRecording`). Not deprecated; the docstring recommends `generate_ground_truth_recording()` for finer control.

Full signature (verbatim):

```python
def toy_example(
    duration=10,
    num_channels=4,
    num_units=10,
    sampling_frequency=30000.0,
    num_segments=2,
    average_peak_amplitude=-100,
    upsample_factor=None,
    contact_spacing_um=40.0,
    num_columns=1,
    spike_times=None,
    spike_labels=None,
    # score_detection=1,
    firing_rate=3.0,
    seed=None,
):
```

Returns a `(recording, sorting)` tuple. Notes:

- `duration`: float (broadcast across segments) or `list[float]` (one entry per segment).
- `num_segments` must match `len(duration)` when a list is passed.
- `spike_times` / `spike_labels`: if provided, each is a list of `num_segments` numpy arrays and `NumpySorting.from_samples_and_labels(...)` is used.
- Hard-coded template shape: `ms_before=1.5`, `ms_after=3.0`. Unit z-locations sampled in `[minimum_z=5.0, maximum_z=50.0]`, `margin_um=15.0`.
- Probe generated internally: `Probe(ndim=2)` with `shapes="circle"`, `shape_params={"radius": 5}`, `probe_type="rect"`, `margin=20.0`.
- Noise: `noise_kwargs=dict(noise_levels=10.0, strategy="on_the_fly")`.
- `upsample_factor` currently raises `NotImplementedError` if set.
- `firing_rate` (Hz), used only when `spike_times` is `None`; default `refractory_period_ms=4.0`.

## `read_mearec(file_path)`

Convenience function in `neoextractors/mearec.py`.

Full signature (verbatim):

```python
def read_mearec(file_path):
    """returns (recording, sorting)"""
    recording = MEArecRecordingExtractor(file_path)
    sorting = MEArecSortingExtractor(file_path)
    return recording, sorting
```

Returns a `(MEArecRecordingExtractor, MEArecSortingExtractor)` tuple.

## `read_nwb(file_path, load_recording=True, load_sorting=False, electrical_series_path=None)`

Convenience wrapper in `nwbextractors.py` that dispatches to `read_nwb_recording` and/or `read_nwb_sorting`.

Full signature (verbatim):

```python
def read_nwb(file_path, load_recording=True, load_sorting=False, electrical_series_path=None):
```

Returns a single extractor when only one flag is `True`, otherwise a tuple in order `(recording, sorting)`.

## `read_neuroscope(file_path, stream_id=None, keep_mua_units=False, exclude_shanks=None, load_recording=True, load_sorting=False)`

Convenience wrapper in `neoextractors/neuroscope.py`.

Full signature (verbatim):

```python
def read_neuroscope(
    file_path, stream_id=None, keep_mua_units=False, exclude_shanks=None, load_recording=True, load_sorting=False
):
```

Returns a single extractor or a `(recording, sorting)` tuple depending on flags. Note: `keep_mua_units` default here is `False` (differs from `NeuroScopeSortingExtractor` default `True`).

## `get_neo_streams(extractor_name, *args, **kwargs)`

Utility in `neoextractors/neo_utils.py`. Returns the NEO stream names and stream ids for a given format.

Full signature (verbatim):

```python
def get_neo_streams(extractor_name, *args, **kwargs):
    ...
    neo_extractor = get_neo_extractor(extractor_name)
    return neo_extractor.get_streams(*args, **kwargs)
```

- `extractor_name`: lowercase format key from `neoextractors.neo_recording_class_dict` (Neo-based recording formats only). Available keys: `"alphaomega"`, `"axon"`, `"axona"`, `"biocam"`, `"blackrock"`, `"ced"`, `"edf"`, `"intan"`, `"maxwell"`, `"mcsraw"`, `"mearec"`, `"neuralynx"`, `"neuroexplorer"`, `"neuronexus"`, `"neuroscope"`, `"nix"`, `"openephysbinary"`, `"openephyslegacy"`, `"plexon"`, `"plexon2"`, `"spike2"`, `"spikegadgets"`, `"spikeglx"`, `"tdt"`. Extra positional/keyword arguments are forwarded to the extractor's `get_streams` classmethod (typically the same `folder_path` / `file_path` you would pass to `read_*`).
- Returns `(stream_names, stream_ids)`, both lists of strings.

## `get_neo_num_blocks(extractor_name, *args, **kwargs) -> int`

Utility in `neoextractors/neo_utils.py`. Returns the number of NEO blocks for a given format.

Full signature (verbatim):

```python
def get_neo_num_blocks(extractor_name, *args, **kwargs) -> int:
    ...
    neo_extractor = get_neo_extractor(extractor_name)
    return neo_extractor.get_num_blocks(*args, **kwargs)
```

Most datasets contain a single block; use `block_index=` on the `read_*` function to select a different block.

## Other convenience re-exports

Exposed via `spikeinterface.extractors.__all__` in `extractor_classes.py` and `extractors/__init__.py`:

- `read_binary` — from `spikeinterface.core` (binary file format).
- `read_zarr` — from `spikeinterface.core` (Zarr format).
- `read_npz_sorting` — from `spikeinterface.core` (`NpzSortingExtractor`).
- `read_npy_snippets` — from `spikeinterface.core` (`NpySnippetsExtractor`).
- `read_neuroscope` — convenience across `read_neuroscope_recording` / `read_neuroscope_sorting`.
- `read_split_intan_files` — from `neoextractors.intan` (segmented Intan files).
- `read_kilosort_as_analyzer` — see Section 1.
- `read_bids` — from `bids.py`.
- `get_neo_num_blocks`, `get_neo_streams` — from `neoextractors.neo_utils`.

No `get_matlab_data` / `read_matlab_data` function is defined in this subpackage; the MATLAB entry points are the `MatlabHelper` methods below.
