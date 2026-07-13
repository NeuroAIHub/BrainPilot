# UnitRefine cascade
Source in repo: `spikeinterface/src/spikeinterface/curation/unitrefine_curation.py`
Parent index: [INDEX.md](INDEX.md)
---

## UnitRefine cascade

### unitrefine_label_units

Verbatim signature from `unitrefine_curation.py`:

```python
def unitrefine_label_units(
    sorting_analyzer: SortingAnalyzer,
    noise_neural_classifier: str | Path | None = None,
    sua_mua_classifier: str | Path | None = None,
)
```

Parameters:

- `sorting_analyzer` (`SortingAnalyzer`) - analyzer whose metrics feed the classifiers.
- `noise_neural_classifier` (`str | Path | None`, default `None`) - path to a folder
  containing the model, a full path to a `.skops` file, or a HuggingFace repo id. If
  `None`, this stage is skipped.
- `sua_mua_classifier` (`str | Path | None`, default `None`) - path to a folder, `.skops`
  file, or HuggingFace repo id for the SUA/MUA classifier. If `None`, this stage is
  skipped.

At least one classifier must be provided; otherwise `ValueError` is raised (with a
pointer to the pre-trained models). Both classifier calls internally use
`trust_model=True`.

Returns a DataFrame with columns `unitrefine_label` (expected values `"noise"`,
`"neural"`, `"sua"`, `"mua"` depending on which classifier produced them; the function
issues a warning if the noise/neural classifier returns anything other than
`{"noise", "neural"}` or the SUA/MUA classifier returns anything other than
`{"sua", "mua"}`) and `unitrefine_probability`.

Companion helper (private):

- `get_model_based_classification_kwargs(model)` - given a `str | Path`, returns
  `{"model_folder": ...}`, `{"model_folder": ..., "model_name": ...}`, or
  `{"repo_id": ...}` depending on whether the input is a directory, a file, or neither
  existing locally.

Pre-trained models:

- https://huggingface.co/collections/SpikeInterface/curation-models
- https://huggingface.co/AnoushkaJain3/models
