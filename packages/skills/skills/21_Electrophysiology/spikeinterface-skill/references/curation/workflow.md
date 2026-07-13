# Recommended curation workflow
Source in repo: `spikeinterface/src/spikeinterface/curation/__init__.py`
Parent index: [INDEX.md](INDEX.md)
---

## Recommended curation workflow

A common end-to-end workflow (compose the pieces that apply to your data):

1. Get a `SortingAnalyzer` and compute basic extensions
   (`random_spikes`, `templates`, `correlograms`, `template_similarity`,
   `spike_locations`, `spike_amplitudes`, `unit_locations`,
   `noise_levels`, `quality_metrics`, `template_metrics`).

2. Clean the spike trains:

   ```python
   from spikeinterface.curation import remove_excess_spikes, remove_duplicated_spikes

   sorting = remove_excess_spikes(sorting, recording)
   sorting = remove_duplicated_spikes(sorting, censored_period_ms=0.3, method="keep_first")
   ```

3. Remove redundant / near-duplicate units:

   ```python
   from spikeinterface.curation import remove_redundant_units

   sorting = remove_redundant_units(
       sorting_analyzer,          # analyzer preferred for align/amp strategies
       align=True,
       remove_strategy="minimum_shift",
   )
   ```

4. Auto-merge over-split units:

   ```python
   from spikeinterface.curation import auto_merge_units

   analyzer = auto_merge_units(
       sorting_analyzer,
       presets=["similarity_correlograms", "temporal_splits"],
       recursive=True,
       merging_mode="soft",
   )
   ```

5. Automated labeling (choose one or combine):

   - Threshold-based (bespoke rules):
     `threshold_metrics_label_units(metrics, thresholds)`.
   - Bombcell defaults:
     `bombcell_label_units(sorting_analyzer=analyzer)`.
   - Trained-model / UnitRefine:
     `model_based_label_units(analyzer, repo_id="...")` or
     `unitrefine_label_units(analyzer, noise_neural_classifier=..., sua_mua_classifier=...)`.

6. Manual review (optional): open in SortingView / spikeinterface-gui, save curation JSON, and
   apply it back:

   ```python
   from spikeinterface.curation import apply_sortingview_curation, apply_curation, load_curation

   analyzer = apply_sortingview_curation(analyzer, uri_or_json="curation.json",
                                         exclude_labels=["noise"])
   # or with the native curation format:
   curation = load_curation("curation.json")
   analyzer = apply_curation(analyzer, curation, merging_mode="soft")
   ```

7. If you need a stage-based script with undo/redo, use `CurationSorting` and its
   `merge` / `split` / `remove_units` methods instead of maintaining a curation dict by hand.

8. To train your own classifier on curated data:

   ```python
   from spikeinterface.curation import train_model

   trainer = train_model(
       mode="analyzers",
       analyzers=[analyzer_1, analyzer_2],
       labels=[labels_1, labels_2],
       folder="my_model_folder",
       overwrite=True,
   )
   ```

   Then use `model_based_label_units(analyzer, model_folder="my_model_folder")` to apply it.
