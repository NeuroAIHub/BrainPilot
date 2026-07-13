# SpikeInterface Core Reference

The `spikeinterface.core` submodule defines the foundational data-structure classes (`BaseExtractor`, `BaseRecording`, `BaseSorting`, `BaseEvent`, `BaseSnippets`), the `SortingAnalyzer` + extension system for waveforms/templates/sparsity, in-memory / on-disk IO extractors (binary, zarr, npz, numpy), lazy slicing and aggregation wrappers (`FrameSlice*`, `ChannelSlice*`, `aggregate_channels/units`, `concatenate/append_recordings`), synthetic data generators, loading dispatch (`load`, `load_sorting_analyzer`, `load_waveforms`), the parallel-job kwargs vocabulary and executor, global folder/state helpers, dataset download, per-recording tool helpers (noise levels, channel distances), core JSON/path utilities, and the `Motion` object used by drift correction.

## Leaf files

| Leaf file | Scope (one line) | When to read |
|---|---|---|
| [base_extractor_a.md](base_extractor_a.md) | BaseExtractor init, ids, annotations, properties, appendix dtypes | Understanding the top-level abstract class shared by all extractors |
| [base_extractor_b.md](base_extractor_b.md) | BaseExtractor dict/json/pickle serialization, save-to-memory/folder/zarr, BaseSegment | Serializing or persisting any extractor to disk |
| [base_recording_a.md](base_recording_a.md) | BaseRecordingSnippets: probe attachment, channel gains/offsets/groups | Working with probes, channel locations, and channel-level metadata |
| [base_recording_b.md](base_recording_b.md) | BaseRecording: traces, get_traces, time series methods, BaseRecordingSegment | Reading trace data, converting sample↔time, sub-classing a recording |
| [base_sorting.md](base_sorting.md) | BaseSorting / BaseSortingSegment: spike trains, spike vector, unit ops | Handling spike sortings, spike vectors, and unit selection/merge/split |
| [base_event.md](base_event.md) | BaseEvent / BaseEventSegment: event channels and structured event arrays | Working with digital events / triggers |
| [base_snippets.md](base_snippets.md) | BaseSnippets / BaseSnippetsSegment: fixed-length spike snippets | Working with cutout snippets extracted around spikes |
| [channel_slice.md](channel_slice.md) | ChannelSliceRecording / ChannelSliceSnippets lazy wrappers | Behind-the-scenes classes for `recording.select_channels(...)` |
| [frame_slice.md](frame_slice.md) | FrameSliceRecording lazy wrapper | Behind-the-scenes class for `recording.frame_slice(...)` |
| [numpy_extractors.md](numpy_extractors.md) | NumpyRecording/Sorting/Event/Snippets and SharedMemory variants | Building in-memory extractors, sharing arrays across processes |
| [sorting_analyzer_constructors.md](sorting_analyzer_constructors.md) | `create_sorting_analyzer`, `load_sorting_analyzer` signatures | Creating or loading a SortingAnalyzer (entry point for waveform pipeline) |
| [sorting_analyzer_class_a.md](sorting_analyzer_class_a.md) | SortingAnalyzer attributes/properties and extension management API | Computing, loading, and managing analyzer extensions |
| [sorting_analyzer_class_b.md](sorting_analyzer_class_b.md) | SortingAnalyzer geometry, copy/select/merge/split, state, examples | Reshaping, merging, splitting units within an analyzer |
| [channel_sparsity.md](channel_sparsity.md) | ChannelSparsity class + `compute_sparsity` / `estimate_sparsity` | Configuring or inspecting per-unit channel sparsity masks |
| [analyzer_extensions.md](analyzer_extensions.md) | ComputeRandomSpikes / Waveforms / Templates / NoiseLevels defaults | Looking up default params for core analyzer extensions |
| [templates_class.md](templates_class.md) | Templates dataclass (fields, methods, IO) | Working with the standalone Templates object independently of an analyzer |
| [loading_helpers.md](loading_helpers.md) | `load` (loading.py) + `get_default_zarr_compressor` | Quick reference for the generic loader signature and zarr compressor |
| [extension_registry.md](extension_registry.md) | `_builtin_extensions` name→module table and registry helpers | Looking up which module provides which analyzer extension |
| [generate.md](generate.md) | Synthetic recording/sorting/templates/ground-truth generation | Producing demo or test data (`generate_recording`, `generate_ground_truth_recording`, ...) |
| [aggregation_slicing.md](aggregation_slicing.md) | `aggregate_channels`, `aggregate_units`, `concatenate/append_recordings`, slicing classes | Combining, splitting, or slicing recordings/sortings across segments/channels/units |
| [io_extractors.md](io_extractors.md) | Binary/Zarr/Npz/Numpy IO extractors and write helpers | Reading or writing on-disk recording/sorting formats |
| [loading.md](loading.md) | Full `load` reference + `load_sorting_analyzer`, `load_waveforms`, old-API adapters | Auto-detecting formats and dispatching to the right loader |
| [job_tools.md](job_tools.md) | Job kwargs vocabulary, `fix_job_kwargs`, `TimeSeriesChunkExecutor` | Configuring parallelism, chunking, and multiprocessing |
| [globals.md](globals.md) | Global tmp folder, dataset folder, job-kwarg getters/setters | Reading/setting session-wide defaults |
| [datasets.md](datasets.md) | `download_dataset` for GIN test datasets | Downloading example ephys data for demos/tests |
| [recording_tools.md](recording_tools.md) | Channel distances, noise levels, random chunks, chunk with margin | Numeric helpers that operate on a `BaseRecording` |
| [core_tools.md](core_tools.md) | JSON check, path relative/absolute, `read_python`/`write_python`, misc utils | Low-level plumbing (path handling, JSON encoding, memory helpers) |
| [motion.md](motion.md) | `Motion` class for drift/motion estimation, save/load, module helpers | Building or persisting a motion estimate for drift correction |
