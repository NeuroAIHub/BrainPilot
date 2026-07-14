# SpikeInterface Curation Reference - Index

The `spikeinterface.curation` module provides tools for manual and automated curation of spike
sorting results. Curation includes merging split units, splitting mixed units, removing
noisy/duplicate units, applying labels (good, MUA, noise), and cleaning spike trains.

Import path:

```python
from spikeinterface import curation
# or
from spikeinterface.curation import <name>
```

## Leaf files

- [overview.md](overview.md) - Public API listing (re-exports of `spikeinterface.curation.__init__`)
  and names available only from submodules.
- [manual_curation.md](manual_curation.md) - `CurationSorting`, `MergeUnitsSorting`,
  `SplitUnitSorting` classes (stage-based manual curation with undo/redo, merge and split
  Sorting wrappers).
- [auto_merge_functions.md](auto_merge_functions.md) - Automated merging entry points:
  `compute_merge_unit_groups`, `auto_merge_units`, and the deprecated
  `get_potential_auto_merge`.
- [auto_merge_presets.md](auto_merge_presets.md) - Auto-merge preset details, step tables,
  default step parameters, required extensions, and the SLAy preset description.
- [auto_split.md](auto_split.md) - Automated splitting status (no public function; use
  manual/curation-dict alternatives).
- [spike_train_cleaning.md](spike_train_cleaning.md) - `remove_duplicated_spikes`,
  `remove_excess_spikes`, `find_duplicated_spikes`.
- [redundant_units.md](redundant_units.md) - `remove_redundant_units`, `find_redundant_units`.
- [sortingview_curation.md](sortingview_curation.md) - `apply_sortingview_curation` for
  applying SortingView / kachery / gh JSON curation.
- [curation_format.md](curation_format.md) - Curation format schema v2 (`Curation`,
  `LabelDefinition`, `ManualLabel`, `Merge`, `Split`, `SequentialCuration`), plus
  `apply_curation`, `validate_curation_dict`, `load_curation`, `curation_label_to_dataframe`,
  and `curation_label_to_vectors`.
- [curation_model_classes.md](curation_model_classes.md) - Pydantic model classes exposed by
  `spikeinterface.curation.curation_model`.
- [threshold_labeling.md](threshold_labeling.md) - `threshold_metrics_label_units`.
- [bombcell.md](bombcell.md) - Bombcell curation: `bombcell_get_default_thresholds`,
  `bombcell_label_units`, `save_bombcell_results`.
- [model_based.md](model_based.md) - `model_based_label_units`, `auto_label_units`
  (deprecated), `load_model`, and the `ModelBasedClassification` class.
- [train_model.md](train_model.md) - `train_model`, `get_default_classifier_search_spaces`,
  and the `CurationTrainer` class.
- [unitrefine.md](unitrefine.md) - `unitrefine_label_units` cascade.
- [utilities.md](utilities.md) - `get_labeling_summary`.
- [workflow.md](workflow.md) - Recommended end-to-end curation workflow with code snippets.

## Quick topic map

- Manual / programmatic edits: `manual_curation.md`
- Auto-merge: `auto_merge_functions.md` (functions), `auto_merge_presets.md` (presets, steps,
  SLAy)
- Cleaning spike trains: `spike_train_cleaning.md`
- Detecting/removing redundant units: `redundant_units.md`
- Applying externally produced curation JSON: `sortingview_curation.md`, `curation_format.md`
- Native curation dict schema: `curation_format.md`, `curation_model_classes.md`
- Threshold-based labeling: `threshold_labeling.md`
- Bombcell labeling: `bombcell.md`
- ML-model labeling: `model_based.md`, `unitrefine.md`
- Training your own model: `train_model.md`
- Reporting label counts: `utilities.md`
- Overall pipeline recipe: `workflow.md`
