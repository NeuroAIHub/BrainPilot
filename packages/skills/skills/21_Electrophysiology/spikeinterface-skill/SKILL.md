---
name: "spikeinterface-skill"
description: "Domain knowledge for building extracellular electrophysiology pipelines with SpikeInterface: loading data with extractors, preprocessing, running spike sorters, post-processing via SortingAnalyzer, quality metrics, curation, comparison, visualization, and export."
domain: "electrophysiology"
version: "1.0.0"
authors:
  - "Claude (AI-assisted)"
review_status: "ai-generated"
---

# SpikeInterface Skill

## 1. Purpose

This skill encodes practical knowledge of the [SpikeInterface](https://spikeinterface.readthedocs.io) Python framework — a unified API for extracellular electrophysiology spike sorting.

It captures, with verbatim signatures pulled from source, how to:

- Read raw recordings from ~40 acquisition formats and write results back out.
- Chain lazy preprocessors (filter, CMR, phase-shift, motion correction).
- Run internal and external spike sorters (Kilosort family, Mountainsort, SpykingCircus, Tridesclous, Lupin, HerdingSpikes, ...) either natively or inside Docker/Singularity containers.
- Build a `SortingAnalyzer` and populate it with postprocessing extensions (waveforms, templates, spike amplitudes, unit/spike locations, correlograms, PCA, template similarity).
- Compute quality metrics (misc + PCA-based + spiketrain + template) and use them for automated curation.
- Compare sortings pairwise, against ground truth, or across multiple sorters.
- Visualize with `plot_*` widgets across matplotlib, ipywidgets, ephyviewer, figpack, and spikeinterface_gui backends (sortingview is deprecated).
- Export to Phy, IBL alignment GUI, Pynapple, or a self-contained HTML report.
- Build custom pipelines out of the low-level `sortingcomponents` (peak detection, localization, selection, clustering, template matching).
- Generate synthetic ground-truth data and benchmark sorters/components.

## 2. When to Use This Skill

Trigger this skill when the user's task involves any of the following:

- Loading extracellular ephys files (`.bin`, `.dat`, Open Ephys, SpikeGLX, Neuropixels, Blackrock, Plexon, NWB, MEArec, Intan, `.h5`, `.nwb`, `.zarr`, ...).
- Preprocessing multichannel electrode traces (bandpass, notch, CMR, whitening, phase shift, drift/motion correction).
- Running a spike sorter or comparing sorters.
- Constructing a `SortingAnalyzer`, computing extensions, or asking about `analyzer.compute(...)`.
- Computing quality metrics (SNR, ISI violations, presence ratio, amplitude cutoff, drift, silhouette, nearest-neighbor isolation, ...) or PCA/template metrics.
- Curation — manual (Phy, sortingview) or automated (metrics thresholding, `auto_merge`, model-based cleaning).
- Ground-truth or cross-sorter comparison.
- Visualization of traces, rasters, waveforms, templates, unit summary, drift, motion, agreement matrices.
- Exporting to Phy / IBL / Pynapple / HTML report.
- Custom sorter development using `sortingcomponents` (peak detection, localization, clustering, matching).
- Simulating recordings (`generate_ground_truth_recording`, `generate_drifting_recording`, hybrid injection) or benchmarking with `SorterStudy` / `BenchmarkStudy`.

## 3. Reference Files (Progressive Disclosure)

References live under `references/` and are organized into **12 subdirectories**, one per SpikeInterface submodule. Each subdirectory has its own `INDEX.md` — a short table listing every leaf file, its scope, and when to read it. **Start by reading only the `INDEX.md` for the relevant submodule**, then open the specific leaf file(s) it points at. Every leaf file is kept under ~300 lines so you can load only what the current task needs.

| Path | Scope | When to open its INDEX |
| --- | --- | --- |
| `references/core/INDEX.md` | Base data-structure classes (`BaseExtractor`, `BaseRecording`, `BaseSorting`, `BaseEvent`, `BaseSnippets`, slicers, Numpy extractors), the `SortingAnalyzer` class + built-in analyzer extensions + `ChannelSparsity` + `Templates`, plus the core toolbelt (`generate`, aggregation/slicing, IO extractors, `loading`, `job_tools`, `globals`, `datasets`, `recording_tools`, `core_tools`, `Motion`). | You need method signatures on `BaseRecording` / `BaseSorting` / `SortingAnalyzer`, are picking a storage format (`memory` / `binary_folder` / `zarr`), configuring parallelism (`n_jobs`, `chunk_duration`), downloading test data, or handling `Motion` / drift objects. |
| `references/extractors/INDEX.md` | Every `read_*` recording extractor (SpikeGLX, Open Ephys, Blackrock, Intan, Neuralynx, Plexon/Plexon2, MEArec, NWB, IBL streaming, MDA, MCS, TDT, cbin, Zarr, ...), all sorting extractors (`read_kilosort`, `read_phy`, `read_klusta`, `read_mda_sorting`, `read_nwb_sorting`, ...), event extractors, snippets extractors, MATLAB / Neuropixels helpers, and registry dicts. | User wants to load a specific raw file format, needs the exact `read_<format>(...)` signature or required extras (e.g. `neo[ced]`, `pynwb`, `mtscomp`), or is reading a sorter's on-disk output / events / snippets. |
| `references/preprocessing/INDEX.md` | Lazy preprocessors organized by family: filtering (`bandpass_filter`, `notch_filter`, `highpass_filter`, `gaussian_filter`, `causal_filter`), referencing (`common_reference`, `phase_shift`), spatial filtering, bad-channel handling, artifact / silence handling, scaling & normalization, clipping, resampling, dtype conversion, whitening, channel padding, deep-learning denoising, motion correction, plus recipe pipelines. | Designing a preprocessing chain, verifying a signature, picking a reference / filter mode, or setting up drift correction. |
| `references/sorters/INDEX.md` | `run_sorter`, `run_sorter_jobs`, `run_sorter_by_property`, `available_sorters`, `installed_sorters`, `archived_sorters`, `get_default_sorter_params`, Docker/Singularity dispatch, per-sorter class list (internal `simple`/`spykingcircus2`/`tridesclous2`/`lupin`; external Kilosort family, Mountainsort, SpykingCircus, Tridesclous, HerdingSpikes, IronClust, WaveClus, HDSort, Combinato, RTSort; archived Klusta / Yass). | Running any sorter, choosing container fallback, or tweaking per-sorter parameters. |
| `references/postprocessing/INDEX.md` | Each `analyzer.compute("<name>")` extension in its own leaf: `amplitude_scalings`, `correlograms` (+ auto / ACG3D), `isi_histograms`, `spike_amplitudes`, `spike_locations`, `unit_locations`, `principal_components`, `template_metrics` (deprecated re-export), `template_similarity`, `noise_levels`, `valid_unit_periods`, plus localization tools, align-sorting, and the extension dependency graph. | Choosing which extensions to compute, tuning per-extension parameters, or debugging the dependency chain. |
| `references/metrics/INDEX.md` | `spikeinterface.metrics.quality` (misc + PCA metrics; `ComputeQualityMetrics`, `compute_quality_metrics`, `get_quality_metric_list`, `get_default_quality_metrics_params` — the deprecated alias `get_default_qm_params` is scheduled for removal in 0.105.0), `spikeinterface.metrics.spiketrain`, `spikeinterface.metrics.template` (peak-to-valley, half-width, ...), plus package-level exports and utility helpers. | Computing quality / template / spike-train metrics, understanding defaults, or picking a recommended metric set. |
| `references/curation/INDEX.md` | Manual (`CurationSorting`, `MergeUnitsSorting`, `SplitUnitSorting`) + automated curation: `auto_merge_units`, spike-train cleaning (`remove_duplicated_spikes`, `remove_excess_spikes`), redundant-unit removal, the **modern curation-format entry points** (`apply_curation`, `load_curation`, `validate_curation_dict`), the **legacy** `apply_sortingview_curation`, threshold labeling, model-based cleaning (Bombcell, UnitRefine, SLAy), and a recommended workflow. | Merging/splitting units, applying curation from Phy / sortingview / JSON, or wiring up automated cleanup. |
| `references/comparison/INDEX.md` | Pair (`compare_two_sorters`), multi-sorter (`compare_multiple_sorters`), ground-truth (`compare_sorter_to_ground_truth`) and template comparisons, agreement / matching strategies, performance metrics, `comparisontools` utilities, and a note on the removed `GroundTruthStudy` (now `SorterStudy` under `benchmark`). | Comparing sortings, computing performance metrics vs. ground truth, or cross-session unit matching. |
| `references/widgets/INDEX.md` | `spikeinterface.widgets` — every `plot_*` alias and its `*Widget` class, split into recording / sorting / analyzer / bombcell / comparison / motion plot groups, plus backend selection (`matplotlib` / `ipywidgets` / `figpack` / `ephyviewer` / `spikeinterface_gui`; `sortingview` is a legacy alias of `figpack`) and helper utilities. | Building any visualization or picking the right backend for notebooks vs. shared links. |
| `references/exporters/INDEX.md` | `export_to_phy`, `export_report`, `export_to_ibl_gui`, `to_pynapple_tsgroup`, plus module-level helpers, enum/literal parameter values, and the "required SortingAnalyzer extensions" summary. | Exporting a `SortingAnalyzer` to Phy for manual curation, generating an HTML/image report, or handing data to IBL or Pynapple. |
| `references/generation/INDEX.md` | Synthetic data + template database: drifting generator, drift tools, hybrid injection, noise tools, splitting tools, `template_database` queries, plus the core `generate_*` re-exports (`generate_recording`, `generate_ground_truth_recording`, `generate_drifting_recording`, ...). | Creating simulated recordings for tests/benchmarks or injecting hybrid ground truth into a real recording. |
| `references/benchmark/INDEX.md` | `spikeinterface.benchmark` — `Benchmark` / `BenchmarkStudy` base classes, `SorterStudy`, `SorterStudyWithoutGroundTruth`, component benchmark studies (peak detection, localization, selection, clustering, matching), motion / merging benchmarks, plot helpers, residual analysis, and cheatsheets. | Setting up a systematic sorter or component comparison, replaying benchmarks on-disk, or plotting benchmark results. |
| `references/sortingcomponents/INDEX.md` | Low-level building blocks organized by subpackage: `peak_detection/` (7 methods), `peak_localization/` (center_of_mass, monopolar_triangulation, grid_convolution), `peak_selection`, `clustering/` (7 methods including graph, iterative-hdbscan, iterative-isosplit), `matching/` (nearest, tdc_peeler, circus_omp, wobble), `motion/` (estimation, interpolation, peak helpers), `features`, `waveforms`, `node_pipeline`, `tools`, and a modular pipeline example. | Writing a custom sorter, integrating a new component, or investigating what `spykingcircus2` / `tridesclous2` / `lupin` do internally. |

**How to navigate.** Every `INDEX.md` is short (≤ 100 lines) and contains a table of `leaf-file | scope | when-to-read`. Read the INDEX first, jump to one or two leaves, and only open more if the task requires them. This keeps your context small even for a broad task like "build a full pipeline" — the SKILL body plus 2–3 leaves is usually all you need loaded at once.

## 4. Pipeline Overview

The canonical SpikeInterface workflow:

```
Load                Preprocess              Sort                 Analyze                 Post-process           Metrics                Curate                Visualize / Export
----                ----------              ----                 -------                 ------------           -------                ------                -------------------
extractors      ->  preprocessing       ->  sorters          ->  create_              ->  postprocessing    ->  metrics.quality    ->  curation          ->  widgets
read_*(...)         bandpass_filter         run_sorter(          sorting_analyzer(       analyzer.compute(     compute_quality_        auto_merge_units      plot_*(analyzer,...)
                    common_reference        sorter_name,         sorting, recording,     "waveforms",          metrics(analyzer)       apply_sortingview_
                    phase_shift             recording,           format="binary_        "templates",                                   curation
                    whiten                  docker_image=,       folder", folder=)      "spike_amplitudes",                                                exporters
                    correct_motion          ...)                                        "unit_locations",                                                    export_to_phy
                                                                                        "correlograms",                                                      export_report
                                                                                        "template_similarity")                                               export_to_ibl_gui
                                                                                                                                                             to_pynapple_tsgroup
```

Rules of thumb:

- Preprocessors are **lazy** — chaining `bandpass_filter(...)` → `common_reference(...)` builds a graph; nothing is computed until `get_traces()` or `.save(...)` is called.
- Sorters expect a `BaseRecording`. For heavy sorters call `.save(format="binary", n_jobs=..., chunk_duration=...)` first so preprocessing is materialized once.
- The `SortingAnalyzer` is the central hub for everything after sorting. Extensions have a **dependency chain** (e.g. `waveforms` needs `random_spikes`; `template_similarity` needs `templates`; `spike_amplitudes` needs `templates`; drift quality metrics need `spike_locations`).
- Quality metrics, template metrics, spike-train metrics are themselves extensions of the `SortingAnalyzer`.
- Curation returns a new `BaseSorting` you can re-wrap in a fresh `SortingAnalyzer`.

## 5. Quick Start

Minimal end-to-end pipeline, based on `spikeinterface/doc/get_started/quickstart.rst`:

```python
import spikeinterface.full as si  # heavy but convenient one-shot import

# ---- 0. Parallelism defaults --------------------------------------------
si.set_global_job_kwargs(n_jobs=4, chunk_duration="1s")

# ---- 1. Load a recording (here, a bundled MEArec test file) -------------
local_path = si.download_dataset(remote_path="mearec/mearec_test_10s.h5")
recording, sorting_true = si.read_mearec(local_path)

# ---- 2. Lazy preprocessing chain ----------------------------------------
recording_f   = si.bandpass_filter(recording, freq_min=300, freq_max=6000)
recording_cmr = si.common_reference(recording_f, reference="global", operator="median")

# Materialize once so the sorter reads from disk quickly.
recording_preprocessed = recording_cmr.save(format="binary")

# ---- 3. Run a sorter ----------------------------------------------------
sorting = si.run_sorter(
    sorter_name="tridesclous2",
    recording=recording_preprocessed,
    folder="tdc2_output",
    remove_existing_folder=True,
    # docker_image=True,   # <- uncomment to run an external sorter in Docker
)

# ---- 4. Build a SortingAnalyzer and compute extensions ------------------
analyzer = si.create_sorting_analyzer(
    sorting=sorting,
    recording=recording_preprocessed,
    format="binary_folder",
    folder="analyzer_tdc2",
    sparse=True,
    return_in_uV=True,
)

extensions_to_compute = [
    "random_spikes",
    "waveforms",
    "noise_levels",
    "templates",
    "spike_amplitudes",
    "unit_locations",
    "spike_locations",
    "correlograms",
    "template_similarity",
]
extension_params = {
    "unit_locations":      {"method": "center_of_mass"},
    "spike_locations":     {"ms_before": 0.5},
    "correlograms":        {"bin_ms": 0.1},
    "template_similarity": {"method": "cosine"},
}
analyzer.compute(extensions_to_compute, extension_params=extension_params)

# ---- 5. Quality metrics --------------------------------------------------
qm_params = si.get_default_quality_metrics_params()
qm_params["presence_ratio"]["bin_duration_s"]  = 1
qm_params["amplitude_cutoff"]["num_histogram_bins"] = 5
analyzer.compute("quality_metrics", metric_params=qm_params)

qm_df = analyzer.get_extension("quality_metrics").get_data()

# ---- 6. Curate on metrics (simple threshold) ----------------------------
keep_mask = (qm_df["snr"] > 5) & (qm_df["isi_violations_ratio"] < 0.5)
sorting_curated = sorting.select_units(sorting.unit_ids[keep_mask.values])

# ---- 7. Export ----------------------------------------------------------
si.export_report(analyzer, output_folder="report_tdc2")
si.export_to_phy(analyzer, output_folder="phy_folder_tdc2")
```

Reload later with `analyzer_reloaded = si.load_sorting_analyzer("analyzer_tdc2")`.

## 6. Key Concepts

**BaseRecording** — the abstract multichannel voltage-trace object returned by every `read_*` extractor and every preprocessor. Segmented (`get_num_segments`) with per-segment sample access via `get_traces(segment_index, start_frame, end_frame, channel_ids, return_scaled=..., return_in_uV=...)`. Carries channel ids, sampling frequency, dtype, gain/offset, a `probeinterface.Probe`, and arbitrary properties/annotations. Serializable via `to_dict`/`from_dict`. Sliceable in time (`frame_slice`) and channels (`channel_slice`).

**BaseSorting** — the abstract spike-train container returned by every sorter and every `read_*_sorting`. Segmented like `BaseRecording`. Access via `get_unit_ids()`, `get_unit_spike_train(unit_id, segment_index)`, and vectorized `to_spike_vector()`. Supports `select_units`, `remove_units`, `rename_units`, plus arbitrary properties (`set_property` / `get_property`).

**SortingAnalyzer** — the post-sorting hub built by `create_sorting_analyzer(sorting, recording, format=..., folder=..., sparse=..., return_in_uV=...)`. Owns a `sorting`, a `recording`, a `ChannelSparsity`, and a dict of computed `AnalyzerExtension` results. Formats: `"memory"`, `"binary_folder"`, `"zarr"`. Persist with `.save_as(...)`, reload with `load_sorting_analyzer(folder)`.

**ChannelSparsity** — a per-unit boolean mask over channels (unit × channel). Reduces memory for waveform / template / PCA storage. Built with `estimate_sparsity(...)` (radius, snr, ptp, best_channels, ...). Extensions honor sparsity automatically. Toggle at analyzer creation with `sparse=True/False` or pass `sparsity=<ChannelSparsity>`. A dense analyzer can be sparsified with `analyzer.copy(sparsity=...)`; sparse cannot be trivially densified.

**Motion** — the drift/motion object living in `spikeinterface.core.motion`. Estimated by `estimate_motion(...)` (or `correct_motion(...)`) and applied to a recording with `InterpolateMotionRecording` under the hood. Carries `displacement`, `temporal_bins_s`, `spatial_bins_um`, direction. Serializable to disk.

**Extension registration** — every postprocessing/metric computation is an `AnalyzerExtension` subclass decorated with `register_result_extension(...)`. This means `analyzer.compute("<name>", **params)` dispatches to the registered class, records parameters, and persists results in the analyzer's folder under `extensions/<name>/`. `analyzer.get_extension("<name>").get_data()` returns the computed data. Extensions know their **dependencies**; SpikeInterface raises if you request one whose parents are missing.

**Lazy vs. computed** — preprocessors are **lazy**: they only wrap the graph and compute on demand. Extensions on a `SortingAnalyzer` are **computed** (and persisted) at `.compute(...)` time. To force a preprocessing chain to disk, call `recording.save(format="binary", folder=..., n_jobs=..., chunk_duration=...)` — this reads once and lets downstream operations reuse the cached traces.

## 7. Common Pitfalls

1. **`return_scaled` is deprecated in favor of `return_in_uV`.** Use `return_in_uV=True` on `create_sorting_analyzer(...)` and on `recording.get_traces(...)`. Setting `return_scaled=True` still works but prints a deprecation warning; setting both is an error.
2. **Sparse vs. dense.** `create_sorting_analyzer(..., sparse=True)` is the default and required by many extensions to stay memory-safe. Passing dense waveforms to a Neuropixels-scale recording will exhaust RAM. If you need dense outputs (e.g. for `plot_unit_templates` across all channels), either build a dense analyzer or estimate sparsity with a large radius.
3. **`n_jobs` and `chunk_duration` are cross-cutting.** They are read from `set_global_job_kwargs(...)` unless overridden per-call. Excess `n_jobs` combined with `mp_context="fork"` on Linux (default) can OOM. For Windows or notebook use, prefer `mp_context="spawn"`. For sorters that already parallelize internally (kilosort4, spykingcircus2) keep `n_jobs` moderate.
4. **Extension dependency chain.** Requesting `spike_amplitudes` without `templates`, `template_similarity` without `templates`, `waveforms` without `random_spikes`, or drift-based quality metrics without `spike_locations` will raise. Either compute in the right order or hand `analyzer.compute([...])` a list and let it resolve.
5. **Sorter installation.** `si.installed_sorters()` shows what actually resolves in your env; `si.available_sorters()` shows everything SpikeInterface knows about. Kilosort2/2.5/3/4 need a working GPU + MATLAB (2/2.5/3) or PyTorch (4). If a sorter is not natively installed, use `docker_image=True` or `singularity_image=True` — SpikeInterface pulls a prebuilt image from `spikeinterface/<sorter>-compiled-base` and runs it transparently.
6. **Docker/Singularity fallbacks require the host tool.** Docker requires the Docker daemon + `docker` Python bindings; Singularity requires the `singularity`/`apptainer` binary + `spython`. On HPC prefer Singularity. Container mode auto-installs the current spikeinterface version inside the container (`installation_mode='dev'` when running from a source checkout).
7. **Sorter output folders.** Passing `remove_existing_folder=False` (the default) into `run_sorter` on an existing folder raises. If you re-run, either set `remove_existing_folder=True`, delete the folder, or point to a new one.
8. **Time indexing.** `BaseRecording` and `BaseSorting` are segmented — always pass `segment_index` (default `0`) explicitly for multi-segment files; otherwise silent segment-0-only behavior can mask real bugs.
9. **Probe attachment.** Many extensions (unit locations, spike locations, sparsity by radius, motion correction) require a probe. If your extractor did not attach one, use `recording.set_probe(probe)` — the call is always in-place now (the `in_place` argument is deprecated). To attach a probe and simultaneously subset to matching channels, use `recording.select_channels_with_probe(probe)` or `recording.select_channels_with_probegroup(probegroup)`, which return a new recording.
10. **Import convenience vs. import cost.** `import spikeinterface.full as si` pulls in scipy/sklearn/networkx/matplotlib/h5py and all submodules — great for notebooks, slow for CLI scripts. In production code, import the submodules you need: `import spikeinterface as si; import spikeinterface.preprocessing as spre; import spikeinterface.sorters as ss; ...`.
11. **`spikeinterface.metrics.quality` replaces `spikeinterface.qualitymetrics`.** The old module path still exists as a shim but the canonical import is `import spikeinterface.metrics.quality as sqm`. Similarly, template metrics live under `spikeinterface.metrics.template`, spike-train metrics under `spikeinterface.metrics.spiketrain`.
12. **`sortingcomponents` exports nothing at package level.** Its `__init__.py` is empty by design — every peak detector, localizer, clusterer, or matcher must be imported from its subpackage (`from spikeinterface.sortingcomponents.peak_detection import detect_peaks`).
13. **Curation entry points: modern vs. legacy.** The general-purpose entry is `apply_curation(sorting_or_analyzer, curation_dict_or_json, ...)` from `spikeinterface.curation.curation_format`. It consumes the JSON-serializable **curation format** (labels + merges + splits + removals) that `CurationSorting`, Phy, sortingview, or the model-based curators can all produce, and can be paired with `load_curation` / `validate_curation_dict`. `apply_sortingview_curation(...)` still exists but is a **legacy shim** that first parses the sortingview-specific format and then delegates to the modern path — use it only when consuming a raw sortingview URI. New code (and any new tutorials the user writes) should use `apply_curation`.

## 8. Installation and Import Shortcuts

Install with extras for a full-featured environment (quotes required in zsh):

```bash
pip install "spikeinterface[full]"

# Add interactive widget backends (ipywidgets, figpack, ephyviewer, spikeinterface_gui, ...).
# `sortingview` is still installable but is a legacy alias for figpack — prefer figpack for new work.
pip install "spikeinterface[full,widgets]"

# Development install from source
git clone https://github.com/SpikeInterface/spikeinterface.git
cd spikeinterface
pip install -e .
```

Two supported import styles:

```python
# Style A: one flat namespace (heavy import, ideal for notebooks)
import spikeinterface.full as si
recording = si.read_spikeglx("/data/npx_run/")
recording = si.bandpass_filter(recording, freq_min=300, freq_max=6000)
sorting   = si.run_sorter("kilosort4", recording, docker_image=True)
analyzer  = si.create_sorting_analyzer(sorting, recording, format="binary_folder", folder="out")

# Style B: explicit per-submodule imports (lighter, preferred in production)
import spikeinterface           as si
import spikeinterface.extractors     as se
import spikeinterface.preprocessing  as spre
import spikeinterface.sorters        as ss
import spikeinterface.postprocessing as spost
import spikeinterface.metrics.quality as sqm
import spikeinterface.curation       as scur
import spikeinterface.comparison     as sc
import spikeinterface.widgets        as sw
import spikeinterface.exporters      as sexp
import spikeinterface.generation     as sgen
import spikeinterface.benchmark      as sbench
```

`spikeinterface.full` re-exports (in this order) `core`, `extractors`, `sorters`, `preprocessing`, `postprocessing`, `metrics`, `curation`, `comparison`, `widgets`, `exporters`, `generation`, `benchmark` — see `src/spikeinterface/full.py`.
