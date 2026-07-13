# Registry dicts (format → wrapper)
Source in repo: `spikeinterface/src/spikeinterface/extractors/extractor_classes.py`
Parent index: [INDEX.md](INDEX.md)
---

Defined at the end of `extractor_classes.py`. Each maps a lowercase format key (class name with `Recording`/`Sorting`/`Event`/`Snippets` and `Extractor` stripped, then lowercased) to the wrapper class or `read_*` function.

- `recording_extractor_full_dict` — recording formats (e.g. `"intan"`, `"spikeglx"`, `"nwb"`).
- `sorting_extractor_full_dict` — sorting formats: keys include `"npz"`, `"zarr"`, `"numpy"`, `"mda"`, `"shybrid"`, `"alf"`, `"klusta"`, `"hdsort"`, `"mclust"`, `"xclust"`, `"waveclus"`, `"yass"`, `"combinato"`, `"tridesclous"`, `"spykingcircus"`, `"herdingspikes"`, `"kilosort"`, `"phy"`, `"nwb"`, `"ibl"`, `"cellexplorer"`, `"blackrock"`, `"mearec"`, `"neuralynx"`, `"plexon"`, `"plexon2"`, `"neuroscope"`.
- `event_extractor_full_dict` — event formats: `"alphaomega"`, `"openephysbinary"`, `"plexon2"`, `"spikeglx"`, `"maxwell"`.
- `snippets_extractor_full_dict` — snippet formats: `"npy"`, `"waveclus"`.

Example usage:

```python
import spikeinterface.extractors as se
recording = se.recording_extractor_full_dict["intan"](file_path="path/to/data.rhd")
sorting = se.sorting_extractor_full_dict["kilosort"](folder_path="path/to/kilosort_output")
```

Deprecation (per `__init__.py`): importing classes directly from `spikeinterface.extractors` still works but emits a `DeprecationWarning`; the class-form imports are slated for removal in v0.105.0. Use the function wrappers, or import classes from `spikeinterface.extractors.extractor_classes`.
