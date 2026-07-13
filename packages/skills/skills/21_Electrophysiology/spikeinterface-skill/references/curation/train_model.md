# Train manual-curation model
Source in repo: `spikeinterface/src/spikeinterface/curation/train_manual_curation.py`
Parent index: [INDEX.md](INDEX.md)
---

## Train manual-curation model

### train_model

Verbatim signature from `train_manual_curation.py`:

```python
def train_model(
    mode="analyzers",
    labels=None,
    analyzers=None,
    metrics_paths=None,
    folder=None,
    metric_names=None,
    imputation_strategies=None,
    scaling_techniques=None,
    classifiers=None,
    test_size=0.2,
    overwrite=False,
    seed=None,
    search_kwargs=None,
    verbose=True,
    enforce_metric_params=False,
    **job_kwargs,
)
```

Parameters (same-name arguments relative to `CurationTrainer` are listed here per the
task requirements):

- `mode` (`"analyzers" | "csv"`, default `"analyzers"`) - training-data source.
- `labels` (`list of list | None`, default `None`) - curated labels per analyzer/CSV.
  Required.
- `analyzers` (`list[SortingAnalyzer] | None`, default `None`) - required when
  `mode="analyzers"`.
- `metrics_paths` (`list[str] | None`, default `None`) - required when `mode="csv"`.
- `folder` (`str | Path | None`, default `None`) - output folder for the trained model,
  metrics CSVs, and `model_info.json`. Required (must be supplied).
- `metric_names` (`list[str] | None`, default `None`) - metrics to include; falls back to
  columns computed by the analyzers when `None`.
- `imputation_strategies` (`list[str] | None`, default `None`) - allowed values include
  `"knn"`, `"iterative"`, and any strategy accepted by `sklearn.SimpleImputer`
  (`"median"`, `"most_frequent"`, `"mean"`, `"constant"`). If `None`, defaults to
  `["median", "most_frequent", "knn", "iterative"]`.
- `scaling_techniques` (`list[str] | None`, default `None`) - allowed values are
  `"standard_scaler"`, `"min_max_scaler"`, `"robust_scaler"`. If `None`, all three are
  used.
- `classifiers` (`list[str] | dict | None`, default `None`) - list of classifier names,
  or a dict `{classifier_name: search_space}`. If `None`, `["RandomForestClassifier"]` is
  used. Recognised names match the keys of `get_default_classifier_search_spaces()`.
- `test_size` (`float`, default `0.2`) - fraction passed to `train_test_split`
  (must be in `[0.0, 1.0]`).
- `overwrite` (`bool`, default `False`) - if False and `folder` already exists, raises.
- `seed` (`int | None`, default `None`) - random seed; generated if `None`.
- `search_kwargs` (`dict | None`, default `None`) - forwarded to `BayesSearchCV` /
  `RandomizedSearchCV`. Defaults ultimately used: `{"cv": 5, "scoring": "balanced_accuracy", "n_iter": 25}` via `set_default_search_kwargs`.
- `verbose` (`bool`, default `True`) - prints progress.
- `enforce_metric_params` (`bool`, default `False`) - if True, metric-parameter
  mismatches across analyzers raise instead of warn.
- `**job_kwargs` - forwarded to `CurationTrainer` (which extracts `n_jobs`).

Requires `skops`. Returns the `CurationTrainer` instance used.


### get_default_classifier_search_spaces

Verbatim signature from `train_manual_curation.py`:

```python
def get_default_classifier_search_spaces()
```

Returns a dict of hyperparameter search spaces (using `scipy.stats.uniform`/`randint`
distributions and lists) for these classifier names, used by `train_model` when a
plain classifier name is supplied:

- `RandomForestClassifier`
- `AdaBoostClassifier`
- `GradientBoostingClassifier`
- `SVC`
- `LogisticRegression`
- `XGBClassifier`
- `CatBoostClassifier`
- `LGBMClassifier`
- `MLPClassifier`


### CurationTrainer

Class in `train_manual_curation.py`.

```python
class CurationTrainer:
    def __init__(
        self,
        labels=None,
        folder=None,
        metric_names=None,
        imputation_strategies=None,
        scaling_techniques=None,
        classifiers=None,
        test_size=0.2,
        seed=None,
        smote=False,
        verbose=True,
        search_kwargs=None,
        **job_kwargs,
    )
```

Constructor parameters (same-name parameters relative to `train_model` are listed again
here per the task requirements):

- `labels` (`list of list | None`, default `None`) - one list of labels per analyzer/CSV.
- `folder` (`str | Path | None`, default `None`) - output folder; created if missing.
- `metric_names` (`list[str] | None`, default `None`) - metrics to feed the model.
- `imputation_strategies` (`list[str] | None`, default `None`) - allowed strategies as
  in `train_model`. If `None`, defaults to `["median", "most_frequent", "knn", "iterative"]`.
- `scaling_techniques` (`list[str] | None`, default `None`) - allowed values are
  `"standard_scaler"`, `"min_max_scaler"`, `"robust_scaler"`. If `None`, all three are used.
- `classifiers` (`list[str] | dict | None`, default `None`) - as in `train_model`; else
  `["RandomForestClassifier"]`.
- `test_size` (`float`, default `0.2`) - split fraction.
- `seed` (`int | None`, default `None`) - random seed.
- `smote` (`bool`, default `False`) - if True, apply SMOTE oversampling from
  `imblearn.over_sampling.SMOTE` (requires `imbalanced-learn`).
- `verbose` (`bool`, default `True`) - prints progress.
- `search_kwargs` (`dict | None`, default `None`) - forwarded to `BayesSearchCV` /
  `RandomizedSearchCV`.
- `**job_kwargs` - job kwargs; `n_jobs` is extracted for `joblib.Parallel`.

Attributes (verified against source `__init__` and `evaluate_model_config`):

- `folder` - `Path(folder)` or `None`.
- `imputation_strategies`, `scaling_techniques` - as normalised (default lists filled in
  when `None`).
- `test_size` - the split fraction.
- `classifiers` - list of classifier name strings.
- `classifier_search_space` - dict of search spaces when a dict was passed, else `None`.
- `seed` - random seed.
- `metrics_params` - dict of stored `quality_metric_params` / `template_metric_params`
  (populated by `load_and_preprocess_analyzers` / `get_metric_params_csv`).
- `smote` - the smote flag.
- `label_conversion` - `None` at init, populated during
  `process_test_data_for_classification` with the int -> string mapping.
- `verbose` - the verbose flag.
- `search_kwargs` - as passed.
- `X` - preprocessed feature matrix (pandas DataFrame; `None` at init).
- `testing_metrics` - concatenated metrics DataFrame used for training (`None` at init).
- `requirements` - dict `{"spikeinterface": <version>}` at init; extended during
  training.
- `y` - preprocessed target vector (pandas Series).
- `metric_names` - as passed (may be filled in later from the analyzers).
- `n_jobs` - extracted from `**job_kwargs` after `fix_job_kwargs`.
- `test_accuracies_df` - DataFrame of per-configuration test accuracies (set by
  `evaluate_model_config`).
- `best_pipeline` - the winning `sklearn.pipeline.Pipeline` (set by
  `evaluate_model_config`).

Note: the class docstring also lists a `metrics_list` attribute, but the source does not
actually create `self.metrics_list`; the equivalent attribute is `self.metric_names`.

Key methods:

- `get_default_metrics_list()` - returns `get_quality_metric_list() + get_quality_pca_metric_list() + get_template_metric_list()`.
- `load_and_preprocess_analyzers(analyzers, enforce_metric_params)` - populates
  `testing_metrics`, `metrics_params`, and preprocesses.
- `load_and_preprocess_csv(paths)` - CSV loader; delegates to
  `_load_data_files(paths)` then `process_test_data_for_classification()` and
  `get_metric_params_csv()`.
- `get_metric_params_csv()` - splits metric names into quality/template lists based on
  registered metric columns.
- `process_test_data_for_classification()` - converts string labels to integer codes,
  reindexes features to `metric_names`, replaces inf with NaN via `_format_metric_dataframe`.
- `apply_scaling_imputation(imputation_strategy, scaling_technique, X_train, X_test, y_train, y_test)` -
  builds and fits the imputer/scaler; optionally applies SMOTE.
- `get_classifier_instance(classifier_name)` - returns an sklearn/xgboost/catboost/lightgbm
  classifier by name; validated against `get_default_classifier_search_spaces().keys()`.
- `get_classifier_search_space(classifier_name)` - returns `(model, param_space)`
  for hyperparameter search.
- `evaluate_model_config()` - splits data, runs `_evaluate` in parallel via
  `joblib.Parallel(n_jobs=self.n_jobs)`, and saves the winning pipeline.

Private helpers include `_check_metrics_parameters`, `_load_data_files`, `_evaluate`,
`_save` (writes `training_data.csv`, `labels.csv`, `best_model.skops`,
`model_accuracies.csv`, and `model_info.json`), and `_train_and_evaluate`.
