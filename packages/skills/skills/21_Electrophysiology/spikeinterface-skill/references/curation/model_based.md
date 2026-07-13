# Model-based curation
Source in repo: `spikeinterface/src/spikeinterface/curation/model_based_curation.py`
Parent index: [INDEX.md](INDEX.md)
---

## Model-based curation

### model_based_label_units

Verbatim signature from `model_based_curation.py`:

```python
def model_based_label_units(
    sorting_analyzer: SortingAnalyzer,
    model_folder=None,
    repo_id=None,
    model_name=None,
    label_conversion=None,
    trust_model=False,
    trusted=None,
    export_to_phy=False,
    enforce_metric_params=False,
)
```

Parameters:

- `sorting_analyzer` (`SortingAnalyzer`) - analyzer whose metrics are fed to the model.
- `model_folder` (`str | Path | None`, default `None`) - local folder containing the
  `.skops` model file(s). Mutually exclusive with `repo_id`.
- `repo_id` (`str | None`, default `None`) - HuggingFace repo id (e.g., `"user/model"`)
  containing the model. Mutually exclusive with `model_folder`.
- `model_name` (`str | None`, default `None`) - filename to select when the folder holds
  multiple `.skops` files.
- `label_conversion` (`dict | None`, default `None`) - `{int_label: str_label}` mapping.
  If `None`, tries `model_info["label_conversion"]`.
- `trust_model` (`bool`, default `False`) - if True, auto-derive the `trusted` list for
  `skops.io.load` from any `UntrustedTypesFoundException`.
- `trusted` (`list[str] | None`, default `None`) - explicit list of trusted objects for
  `skops.io.load`.
- `export_to_phy` (`bool`, default `False`) - if True, writes
  `cluster_prediction.tsv` next to the sorting's `phy_folder` annotation.
- `enforce_metric_params` (`bool`, default `False`) - if True, mismatched metric
  parameters between analyzer and model raise; otherwise emit a warning.

Loads an sklearn `Pipeline` via `load_model`, wraps it in `ModelBasedClassification`, and
runs `predict_labels`. Sets `classifier_label` and `classifier_probability` sorting
properties, and returns a DataFrame with `prediction` and `probability` columns indexed
by `unit_ids`.


### auto_label_units (deprecated)

Verbatim signature from `model_based_curation.py`:

```python
def auto_label_units(*args, **kwargs)
```

Deprecated shim that emits a `DeprecationWarning` and forwards all arguments to
`model_based_label_units`. Scheduled for removal in v0.105.0.


### load_model

Verbatim signature from `model_based_curation.py`:

```python
def load_model(model_folder=None, repo_id=None, model_name=None, trust_model=False, trusted=None)
```

Parameters (same-name parameters relative to `model_based_label_units` are listed here in
their own function context per the task requirements):

- `model_folder` (`str | Path | None`, default `None`) - local folder holding `.skops`
  files. Mutually exclusive with `repo_id`; one must be provided.
- `repo_id` (`str | None`, default `None`) - HuggingFace repo id.
- `model_name` (`str | None`, default `None`) - specific `.skops` filename to load when
  the folder has more than one.
- `trust_model` (`bool`, default `False`) - if True, auto-derive `trusted` from the
  first `UntrustedTypesFoundException` raised by `skops.io.load`.
- `trusted` (`list[str] | None`, default `None`) - explicit `trusted` list passed to
  `skops.io.load`.

Returns `(model, model_info)` where `model` is an sklearn `Pipeline` and `model_info` is
the dict parsed from `model_info.json` (or `None` if the file is missing; a warning is
issued in that case). Backward-compatibility fix-ups on `model_info` are applied via
`handle_backwards_compatibility_metric_params`.

Related private helpers in the same module:

- `_load_model_from_folder(model_folder=None, model_name=None, trust_model=False, trusted=None)`
- `_load_model_from_huggingface(repo_id=None, model_name=None, trust_model=False, trusted=None)`
- `handle_backwards_compatibility_metric_params(model_info)`

They are not part of the public re-exports but are what `load_model` dispatches to.


### ModelBasedClassification

Class in `model_based_curation.py`.

```python
class ModelBasedClassification:
    def __init__(self, sorting_analyzer: SortingAnalyzer, pipeline)
```

Constructor parameters:

- `sorting_analyzer` (`SortingAnalyzer`) - analyzer used to fetch metrics.
- `pipeline` (`sklearn.pipeline.Pipeline`) - a fitted sklearn `Pipeline`. Raises
  `ValueError` if not a `Pipeline` instance.

Attributes:

- `sorting_analyzer` - the analyzer.
- `pipeline` - the sklearn pipeline.
- `required_metrics` - `pipeline.feature_names_in_`; column names required from the
  metrics DataFrame.

Methods:

- `predict_labels(label_conversion=None, input_data=None, export_to_phy=False, model_info=None, enforce_metric_params=False)`
  - `label_conversion` (`dict | None`, default `None`) - int->str label map. If `None`,
    tries `model_info["label_conversion"]`.
  - `input_data` (`pd.DataFrame | None`, default `None`) - metrics DataFrame. If `None`,
    pulled from `sorting_analyzer.get_metrics_extension_data()`.
  - `export_to_phy` (`bool`, default `False`) - if True, write `cluster_prediction.tsv`
    to the sorting's `phy_folder` annotation.
  - `model_info` (`dict | None`, default `None`) - model provenance dict.
  - `enforce_metric_params` (`bool`, default `False`) - if True and analyzer metric
    parameters differ from those in `model_info["metric_params"]`, raise instead of warn.

  Sets `classifier_label` and `classifier_probability` sorting properties and returns a
  DataFrame with columns `prediction` and `probability` indexed by `sorting_analyzer.unit_ids`.
- `handle_backwards_compatibility_in_metrics(calculated_metrics, model_info)` - renames
  legacy metric columns (`peak_to_trough_duration` -> `peak_to_valley`,
  `peak_after_to_trough_ratio` -> `peak_trough_ratio` with sign flip, `trough_half_width`
  -> `half_width`) for models trained under SpikeInterface < 0.103.2.
- Private helpers: `_check_required_metrics_are_present(calculated_metrics)`,
  `_check_params_for_classification(enforce_metric_params=False, model_info=None)`,
  `_export_to_phy(classified_df)`.
