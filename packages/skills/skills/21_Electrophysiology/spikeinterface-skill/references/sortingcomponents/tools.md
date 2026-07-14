# Utility tools

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/tools.py`
Parent index: [INDEX.md](INDEX.md)

---

## Utility tools

Module: `spikeinterface.sortingcomponents.tools`.

- `make_multi_method_doc(methods, indent="    ")` — build the combined
  docstring shown by `detect_peaks`, `localize_peaks`,
  `find_spikes_from_templates`.
- `extract_waveform_at_max_channel(rec, peaks, ms_before=0.5, ms_after=1.5,
  job_name=None, job_kwargs=None)` — extract single-channel waveforms
  centered on each peak via `extract_waveforms_to_single_buffer`.
- `get_prototype_and_waveforms_from_peaks(recording, peaks, n_peaks=5000,
  ms_before=0.5, ms_after=0.5, seed=None, job_kwargs=None)` — extract a
  canonical action-potential prototype from an existing peak vector.
- `get_prototype_and_waveforms_from_recording(recording, n_peaks=5000,
  ms_before=0.5, ms_after=0.5, seed=None, job_kwargs=None,
  **detection_kwargs)` — same but detects peaks first (uses
  `LocallyExclusivePeakDetector`).
- `get_prototype_and_waveforms(recording, n_peaks=5000, peaks=None,
  ms_before=0.5, ms_after=0.5, seed=None, job_kwargs=None, **more_kwargs)`
  — dispatcher (peaks or recording).
- `check_probe_for_drift_correction(recording, dist_x_max=60)` — heuristic
  test whether the probe is suitable for drift correction.
- `_set_optimal_chunk_size(recording, job_kwargs, memory_limit=0.5,
  total_memory=None)`.
- `_get_optimal_n_jobs(job_kwargs, ram_requested, memory_limit=0.25)`.
- `cache_preprocessing(recording, mode="memory", memory_limit=0.5,
  total_memory=None, job_kwargs=None, folder=None)` — accepts
  `mode="memory" | "folder" | "zarr" | "no-cache" | "auto"`.
- `clean_cache_preprocessing(cache_info)` — delete folder eventually
  created by `cache_preprocessing()`.
- `remove_empty_templates(templates)`.
- `create_sorting_analyzer_with_existing_templates(sorting, recording,
  templates, remove_empty=True, noise_levels=None, amplitude_scalings=None,
  spike_amplitudes=None, spike_locations=None)`.
- `get_shuffled_recording_slices(recording, job_kwargs=None, seed=None)` —
  produce randomly-shuffled `(segment_index, start, stop)` slices for
  `run_node_pipeline`, used when `skip_after_n_peaks` is enabled.
- `clean_templates(templates, sparsify_threshold=0.25, noise_levels=None,
  min_snr=None, max_jitter_ms=None, remove_empty=True,
  mean_sd_ratio_threshold=3.0, max_std_per_channel=None, verbose=False)` —
  sparsify + filter templates after clustering.
- `compute_sparsity_from_peaks_and_label(peaks, unit_indices, unit_ids,
  recording, radius_um)` — build a `ChannelSparsity` around each unit's
  extremum channel; returns `(sparsity, unit_locations)`.
