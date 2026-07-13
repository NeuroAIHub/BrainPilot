# SHYBRID recording extractor
Source in repo: `spikeinterface/src/spikeinterface/extractors/shybridextractors.py`
Parent index: [INDEX.md](INDEX.md)
---

Source: `extractors/shybridextractors.py`. Reads a SHYBRID hybrid ground-truth `.yml` recording. Requires `shybrid` (i.e. `hybridizer`) + `pyyaml`.

```python
class SHYBRIDRecordingExtractor(BinaryRecordingExtractor):
    installation_mesg = ("To use the SHYBRID extractors, install SHYBRID and pyyaml: "
                         "\n\n pip install shybrid pyyaml\n\n")
    def __init__(self, file_path): ...    # .yml/.yaml file with SHYBRID params

    @staticmethod
    def write_recording(recording, save_path, initial_sorting_fn, dtype="float32", **job_kwargs): ...

read_shybrid_recording = define_function_from_class(
    source_class=SHYBRIDRecordingExtractor, name="read_shybrid_recording"
)
```

Return type: `SHYBRIDRecordingExtractor` (subclass of `BinaryRecordingExtractor`). Probe loaded from the SHYBRID `.prb` file via `probeinterface.read_prb`.

Sorting counterpart (Part B): `SHYBRIDSortingExtractor(file_path, sampling_frequency, delimiter=",")`.
