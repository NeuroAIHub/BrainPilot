# SpikeInterface `sortingcomponents` reference — INDEX

The `spikeinterface.sortingcomponents` package exposes the low-level building
blocks that internal sorters (e.g. `spykingcircus2`, `tridesclous2`, `lupin`)
compose to build a full sorting pipeline. Nothing is imported from
`spikeinterface.sortingcomponents` itself — every component has to be imported
explicitly from its subpackage (see the very brief `__init__.py`).

Note on the pipeline base classes: the node-graph engine lives in
`spikeinterface.core.node_pipeline` and defines `PipelineNode`, `PeakSource`,
and `PeakDetector`. There is **no** class named `PeakLocalizer` or
`PeakSelector` in the codebase — peak localization is provided by concrete
`LocalizeBase` subclasses driven by `localize_peaks`, and peak selection is
a pure function `select_peaks` (no class hierarchy). The public clustering
entry point is `find_clusters_from_peaks` (plural).

## Leaf files

### Peak detection — `peak_detection/`

- [peak_detection/overview.md](peak_detection/overview.md) — `detect_peaks` + method registry
- [peak_detection/by_channel.md](peak_detection/by_channel.md) — `ByChannelPeakDetector`, `ByChannelTorchPeakDetector`
- [peak_detection/locally_exclusive.md](peak_detection/locally_exclusive.md) — `LocallyExclusivePeakDetector`, torch and OpenCL variants
- [peak_detection/matched_filtering.md](peak_detection/matched_filtering.md) — `MatchedFilteringPeakDetector`
- [peak_detection/iterative.md](peak_detection/iterative.md) — `IterativePeakDetector` (not in registry)

### Peak localization — `peak_localization/`

- [peak_localization/overview.md](peak_localization/overview.md) — `localize_peaks`, `get_localization_pipeline_nodes`, method registry
- [peak_localization/center_of_mass.md](peak_localization/center_of_mass.md) — `LocalizeCenterOfMass`
- [peak_localization/monopolar_triangulation.md](peak_localization/monopolar_triangulation.md) — `LocalizeMonopolarTriangulation`
- [peak_localization/grid_convolution.md](peak_localization/grid_convolution.md) — `LocalizeGridConvolution`

### Peak selection (root)

- [peak_selection.md](peak_selection.md) — `select_peaks` + method options

### Clustering — `clustering/`

- [clustering/overview.md](clustering/overview.md) — `find_clusters_from_peaks` + method registry
- [clustering/dummy_and_hdbscan.md](clustering/dummy_and_hdbscan.md) — `DummyClustering`, `PositionsClustering`
- [clustering/random_projections.md](clustering/random_projections.md) — `RandomProjectionClustering`
- [clustering/iterative_hdbscan.md](clustering/iterative_hdbscan.md) — `IterativeHDBSCANClustering`
- [clustering/iterative_isosplit.md](clustering/iterative_isosplit.md) — `IterativeISOSPLITClustering`
- [clustering/graph_clustering.md](clustering/graph_clustering.md) — `GraphClustering`
- [clustering/kilosort_clustering.md](clustering/kilosort_clustering.md) — external `KiloSortClustering`

### Template matching — `matching/`

- [matching/overview.md](matching/overview.md) — `find_spikes_from_templates` + registry
- [matching/nearest.md](matching/nearest.md) — `NearestTemplatesPeeler`, `NearestTemplatesSVDPeeler`
- [matching/tdc_peeler.md](matching/tdc_peeler.md) — `TridesclousPeeler`
- [matching/circus_omp.md](matching/circus_omp.md) — `CircusOMPPeeler`
- [matching/wobble.md](matching/wobble.md) — `WobbleMatch`

### Motion — `motion/`

- [motion/estimate_a.md](motion/estimate_a.md) — `estimate_motion` overview + `decentralized` + `iterative_template`
- [motion/estimate_b.md](motion/estimate_b.md) — `dredge_ap` + `dredge_lfp`
- [motion/estimate_c.md](motion/estimate_c.md) — `medicine`
- [motion/interpolate.md](motion/interpolate.md) — `interpolate_motion`, `InterpolateMotionRecording`, `interpolate_motion_on_traces`
- [motion/peak_helpers.md](motion/peak_helpers.md) — `compute_peak_displacements`, `correct_motion_on_peaks`, `clean_motion_vector`, `motion_utils`

### Features (root)

- [features.md](features.md) — `compute_features_from_peaks` + `AmplitudeFeature` / `PeakToPeakFeature` / `RandomProjectionsFeature`

### Waveforms (root)

- [waveforms.md](waveforms.md) — `extract_peaks_svd`, `WaveformsNode` subclasses (`HanningFilter`, `SavGolDenoiser`, `WaveformThresholder`, `SingleChannelToyDenoiser`, `TemporalPC*`)

### Node pipeline framework (root)

- [node_pipeline.md](node_pipeline.md) — `PipelineNode`, `PeakSource`, `PeakDetector`, `PeakRetriever`, `SpikeRetriever`, `run_node_pipeline`, gather engines, helpers

### Utility tools (root)

- [tools.md](tools.md) — helpers in `spikeinterface.sortingcomponents.tools`

### Modular pipeline example (root)

- [modular_pipeline_example.md](modular_pipeline_example.md) — end-to-end simplified pipeline
