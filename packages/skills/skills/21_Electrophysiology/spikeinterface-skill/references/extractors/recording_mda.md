# MDA (MountainSort) recording extractor
Source in repo: `spikeinterface/src/spikeinterface/extractors/mdaextractors.py`
Parent index: [INDEX.md](INDEX.md)
---

Source: `extractors/mdaextractors.py`. Reads a MountainSort MDA dataset (a folder holding `raw.mda`, `params.json`, `geom.csv`).

```python
class MdaRecordingExtractor(BaseRecording):
    def __init__(
        self,
        folder_path,
        raw_fname="raw.mda",
        params_fname="params.json",
        geom_fname="geom.csv",
    ): ...

    @staticmethod
    def write_recording(
        recording,
        save_path,
        params=dict(),
        raw_fname="raw.mda",
        params_fname="params.json",
        geom_fname="geom.csv",
        dtype=None,
        verbose=False,
        **job_kwargs,
    ): ...

read_mda_recording = define_function_from_class(source_class=MdaRecordingExtractor, name="read_mda_recording")
```

Return type: `MdaRecordingExtractor`.

Sorting counterpart (Part B): `MdaSortingExtractor(file_path, sampling_frequency)`.
