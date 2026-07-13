# Overview
Source in repo: `spikeinterface/src/spikeinterface/curation/__init__.py`
Parent index: [INDEX.md](INDEX.md)
---

## Public API

Names exported by `spikeinterface.curation.__init__` (verbatim from
`curation/__init__.py`):

- `find_duplicated_spikes` (re-export of `curation_tools.find_duplicated_spikes`)
- `remove_redundant_units`, `find_redundant_units`
- `remove_duplicated_spikes`
- `remove_excess_spikes`
- `compute_merge_unit_groups`, `auto_merge_units`, `get_potential_auto_merge`
- `CurationSorting`, `curation_sorting`
- `MergeUnitsSorting`, `merge_units_sorting`
- `SplitUnitSorting`, `split_unit_sorting`
- `validate_curation_dict`, `curation_label_to_dataframe`, `apply_curation`, `load_curation`
- `apply_sortingview_curation`
- `get_labeling_summary`
- `threshold_metrics_label_units`
- `model_based_label_units`, `load_model`, `auto_label_units`
- `train_model`, `get_default_classifier_search_spaces`
- `unitrefine_label_units`
- `bombcell_get_default_thresholds`, `bombcell_label_units`, `save_bombcell_results`

Names NOT re-exported at package level but available from their submodules
(useful references):

- `spikeinterface.curation.curation_format.curation_label_to_vectors`
- `spikeinterface.curation.curation_model.Curation`,
  `SequentialCuration`, `LabelDefinition`, `ManualLabel`, `Merge`, `Split`,
  and the deprecated shim `CurationModel`
- `spikeinterface.curation.model_based_curation.ModelBasedClassification`
- `spikeinterface.curation.train_manual_curation.CurationTrainer`
