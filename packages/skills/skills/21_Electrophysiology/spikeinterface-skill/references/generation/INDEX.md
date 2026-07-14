# SpikeInterface `generation` Module Reference

The `spikeinterface.generation` module provides tools for generating synthetic recordings, sortings, templates, noise and drift patterns, as well as hybrid recordings that inject synthetic units into real recordings. It also exposes a set of "core generate" helpers (re-exported from `spikeinterface.core.generate`) and utilities to query the SpikeInterface template database.

Note on naming: some function names occasionally referenced with shortened forms do NOT exist in this codebase. The actual names must be used verbatim:

- `fetch_template_object_from_database` (not `fetch_template_dataset`)
- `list_available_datasets_in_template_database` (not `list_available_datasets`)
- There is no `list_templates`, `list_metrics`, `list_recording_types`. The DataFrame returned by `fetch_templates_database_info()` is the primary way to list templates and metadata columns.
- There is no `generate_lazy_recording`; the lazy-recording helper is `generate_recording` (or `MockRecording` / `NoiseGeneratorRecording` directly).
- There is no `generate_probe_from_num_electrodes`; probes are created with `probeinterface.generate_multi_columns_probe` (used inside `generate_ground_truth_recording` and `generate_drifting_recording`) or via `_make_probe_by_name` (internal, keyed by `probe_name` strings) inside `generate_drifting_recording`.

## Leaf files

- [module_exports.md](module_exports.md) — Contents of `generation/__init__.py` (which submodule each name comes from).
- [drifting_generator.md](drifting_generator.md) — `drifting_generator.py`:
  - `generate_drifting_recording`
  - `generate_displacement_vector`
  - `make_one_displacement_vector`
- [drift_tools.md](drift_tools.md) — `drift_tools.py`:
  - `interpolate_templates`
  - `move_dense_templates`
  - `DriftingTemplates`
  - `make_linear_displacement`
  - `InjectDriftingTemplatesRecording`
- [hybrid_tools.md](hybrid_tools.md) — `hybrid_tools.py`:
  - `generate_hybrid_recording`
  - `estimate_templates_from_recording`
  - `select_templates`
  - `scale_template_to_range`
  - `relocate_templates`
- [noise_tools.md](noise_tools.md) — `noise_tools.py`:
  - `generate_noise`
  - `NoiseGeneratorRecording`
  - `noise_generator_recording`
- [splitting_tools.md](splitting_tools.md) — `splitting_tools.py`:
  - `split_sorting_by_times`
  - `split_sorting_by_amplitudes`
- [template_database.md](template_database.md) — `template_database.py`:
  - `fetch_template_object_from_database`
  - `fetch_templates_database_info`
  - `list_available_datasets_in_template_database`
  - `query_templates_from_database`
- [core_generate_reexports_a.md](core_generate_reexports_a.md) — Re-exported from `spikeinterface.core.generate` (part A):
  - `generate_recording`
  - `generate_sorting`
  - `generate_snippets`
  - `generate_templates`
  - `generate_recording_by_size`
  - `generate_ground_truth_recording`
- [core_generate_reexports_b.md](core_generate_reexports_b.md) — Re-exported from `spikeinterface.core.generate` (part B):
  - `generate_unit_locations`
  - `add_synchrony_to_sorting`
  - `synthesize_random_firings`
  - `inject_some_duplicate_units`
  - `inject_some_split_units`
  - `synthetize_spike_train_bad_isi`
  - `MockRecording`
  - `InjectTemplatesRecording`
  - `inject_templates`
