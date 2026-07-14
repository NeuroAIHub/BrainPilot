# export_to_phy
Source in repo: `spikeinterface/src/spikeinterface/exporters/to_phy.py`
Parent index: [INDEX.md](INDEX.md)
---

Exports a `SortingAnalyzer` to the Phy template-gui format. Source: `spikeinterface/exporters/to_phy.py`.

Note on parameter surface: the current signature uses `add_quality_metrics`, `add_template_metrics`, and `additional_properties`. There is no `add_pc_features` or `add_amplitudes` parameter — PC and amplitude export is controlled by `compute_pc_features` / `compute_amplitudes`.

### Signature (verbatim from source)

```python
def export_to_phy(
    sorting_analyzer: SortingAnalyzer,
    output_folder: str | Path,
    compute_pc_features: bool = True,
    compute_amplitudes: bool = True,
    sparsity: Optional[ChannelSparsity] = None,
    copy_binary: bool = True,
    remove_if_exists: bool = False,
    template_mode: str = "average",
    add_quality_metrics: bool = True,
    add_template_metrics: bool = True,
    additional_properties: list | None = None,
    dtype: Optional[npt.DTypeLike] = None,
    verbose: bool = True,
    use_relative_path: bool = False,
    **job_kwargs,
):
```

### Parameters (verbatim from docstring)

- `sorting_analyzer : SortingAnalyzer` — A SortingAnalyzer object.
- `output_folder : str | Path` — The output folder where the phy template-gui files are saved.
- `compute_pc_features : bool, default: True` — If True, pc features are computed.
- `compute_amplitudes : bool, default: True` — If True, waveforms amplitudes are computed.
- `sparsity : ChannelSparsity or None, default: None` — The sparsity object.
- `copy_binary : bool, default: True` — If True, the recording is copied and saved in the phy `"output_folder"`.
- `remove_if_exists : bool, default: False` — If True and `"output_folder"` exists, it is removed and overwritten.
- `template_mode : str, default: "average"` — Parameter `"mode"` to be given to `SortingAnalyzer.get_template()`. See [template_mode enum values](helpers_and_enums.md#template_mode-in-export_to_phy).
- `add_quality_metrics : bool, default: True` — If True, quality metrics (if computed) are saved as Phy tsv and will appear in the ClusterView.
- `add_template_metrics : bool, default: True` — If True, template metrics (if computed) are saved as Phy tsv and will appear in the ClusterView.
- `additional_properties : list | None, default: None` — List of additional properties to be saved as Phy tsv and will appear in the ClusterView.
- `dtype : dtype or None, default: None` — Dtype to save binary data.
- `verbose : bool, default: True` — If True, output is verbose.
- `use_relative_path : bool, default: False` — If True and `copy_binary=True` saves the binary file `dat_path` in the `params.py` relative to `output_folder` (ie `dat_path=r"recording.dat"`). If `copy_binary=False`, then uses a path relative to the `output_folder`. If False, uses an absolute path in the `params.py` (ie `dat_path=r"path/to/the/recording.dat"`).
- `**job_kwargs` — Shared job kwargs (`n_jobs`, `chunk_duration`, `progress_bar`, `mp_context`, `max_threads_per_worker`, etc.).

### Required SortingAnalyzer extensions

Verified from source:

- **Always required**: `"templates"` — asserted at the point of use with
  `assert templates_ext is not None, "export_to_phy requires a SortingAnalyzer with the extension 'templates'"`.
- **Auto-computed if missing**: `"template_similarity"` — code path is
  `if not sorting_analyzer.has_extension("template_similarity"): sorting_analyzer.compute("template_similarity")`.
- **Conditionally required (auto-computed if missing)**:
  - `"spike_amplitudes"` — required when `compute_amplitudes=True`.
  - `"principal_components"` — required when `compute_pc_features=True`. Auto-computed with `n_components=5, mode="by_channel_local"` if missing.
- **Optional (written as `cluster_*.tsv` if present)**:
  - `"quality_metrics"` — used when `add_quality_metrics=True`. Columns `"num_spikes"` and `"firing_rate"` are skipped (already computed by Phy).
  - `"template_metrics"` — used when `add_template_metrics=True`.

### Files written to `output_folder`

- `params.py` (Phy config; contains `dat_path`, `n_channels_dat`, `dtype`, `offset`, `sample_rate`, `hp_filtered`).
- `recording.dat` (only when `copy_binary=True` and the analyzer has a recording).
- `spike_times.npy`, `spike_templates.npy`, `spike_clusters.npy`.
- `templates.npy`, `similar_templates.npy`, `template_ind.npy` (last only when the analyzer is sparse or a `sparsity` is provided).
- `channel_map.npy`, `channel_map_si.npy`, `channel_positions.npy`, `channel_groups.npy`.
- `amplitudes.npy` (when `compute_amplitudes=True`).
- `pc_features.npy`, `pc_feature_ind.npy` (when `compute_pc_features=True`).
- `cluster_group.tsv`, `cluster_si_unit_ids.tsv`, `cluster_channel_group.tsv`.
- `cluster_<metric>.tsv` per quality-metric / template-metric column and per entry in `additional_properties`.

### Constraints

- Only single-segment analyzers are supported: `sorting_analyzer.get_num_segments() == 1` is asserted.
- If the analyzer is dense and has more than 64 channels and no `sparsity` is provided, a warning is emitted recommending a sparse analyzer.
- If the analyzer is sparse and `sparsity` is also provided, the `sparsity` argument is ignored (warning emitted).
- Empty units are removed before export (warning emitted); if all units are empty, an `Exception` is raised (`"No non-empty units in the sorting result, can't save to Phy."`).
- If `output_folder` exists and `remove_if_exists=False`, `FileExistsError` is raised.
- After export, run: `phy template-gui <output_folder>/params.py`.

### Usage

The docstring itself contains no example. Minimal usage (derived from source and tests):

```python
from spikeinterface.exporters import export_to_phy

export_to_phy(
    sorting_analyzer,
    output_folder="phy_folder",
    remove_if_exists=True,
    n_jobs=1,
    chunk_size=10000,
    progress_bar=True,
)
```
