# Module exports (`generation/__init__.py`)
Source in repo: `spikeinterface/src/spikeinterface/generation/__init__.py`
Parent index: [INDEX.md](INDEX.md)
---

From `drift_tools`:
- `move_dense_templates`
- `interpolate_templates`
- `DriftingTemplates`
- `InjectDriftingTemplatesRecording`
- `make_linear_displacement`

From `hybrid_tools`:
- `generate_hybrid_recording`
- `estimate_templates_from_recording`
- `select_templates`
- `scale_template_to_range`
- `relocate_templates`

From `noise_tools`:
- `generate_noise`
- `NoiseGeneratorRecording`
- `noise_generator_recording`

From `splitting_tools`:
- `split_sorting_by_amplitudes`
- `split_sorting_by_times`

From `drifting_generator`:
- `make_one_displacement_vector`
- `generate_displacement_vector`
- `generate_drifting_recording`

From `template_database`:
- `fetch_template_object_from_database`
- `fetch_templates_database_info`
- `list_available_datasets_in_template_database`
- `query_templates_from_database`

Re-exposed from `spikeinterface.core.generate`:
- `generate_recording`
- `generate_sorting`
- `generate_snippets`
- `generate_templates`
- `generate_recording_by_size`
- `generate_ground_truth_recording`
- `add_synchrony_to_sorting`
- `synthesize_random_firings`
- `inject_some_duplicate_units`
- `inject_some_split_units`
- `synthetize_spike_train_bad_isi`
- `MockRecording`
- `InjectTemplatesRecording`
- `inject_templates`

Also available (defined in `spikeinterface.core.generate`, imported by generation submodules):
- `generate_unit_locations`
