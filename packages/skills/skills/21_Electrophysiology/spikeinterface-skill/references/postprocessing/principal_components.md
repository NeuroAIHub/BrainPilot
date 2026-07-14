# principal_components — ComputePrincipalComponents
Source in repo: `spikeinterface/src/spikeinterface/postprocessing/principal_component.py`
Parent index: [INDEX.md](INDEX.md)
---

## principal_components — ComputePrincipalComponents

- extension name: `"principal_components"`
- Compute class: `ComputePrincipalComponents(AnalyzerExtension)`
- depends on: `["random_spikes", "waveforms"]`, `need_recording=False`, `use_nodepipeline=False`, `need_job_kwargs=True`
- Source: `src/spikeinterface/postprocessing/principal_component.py`
- Possible modes: `_possible_modes = ["by_channel_local", "by_channel_global", "concatenated"]`

Parameters (from `_set_params`):

```python
def _set_params(
    self,
    n_components=5,
    mode="by_channel_local",
    whiten=True,
    dtype="float32",
):
    assert mode in _possible_modes, "Invalid mode!"
```

- `n_components`: `int`, default `5`.
- `mode`: `"by_channel_local" | "by_channel_global" | "concatenated"`, default `"by_channel_local"`.
    - `"by_channel_local"`: one `sklearn.decomposition.IncrementalPCA` per channel.
    - `"by_channel_global"`: single PCA fitted on data pooled across channels; projection is still per channel.
    - `"concatenated"`: channels concatenated (requires **dense** waveforms, i.e. `sorting_analyzer.sparsity is None`).
- `whiten`: `bool`, default `True` (passed to `IncrementalPCA`).
- `dtype`: dtype spec, default `"float32"` (stored as `np.dtype(dtype)`).

Note: sparsity is *inherited* from the `SortingAnalyzer` — it is **not** a `_set_params` argument in the current implementation. There is no `tmp_folder` parameter; internal chunk processing is driven by the global `job_kwargs`.

Public API on the extension instance:
```python
ext.get_pca_model()
ext.get_projections_one_unit(unit_id, sparse=False)
ext.get_some_projections(channel_ids=None, unit_ids=None)
ext.project_new(new_spikes, new_waveforms, progress_bar=True)
ext.run_for_all_spikes(file_path=None, verbose=False, **job_kwargs)
```

Public convenience function:
```python
compute_principal_components = ComputePrincipalComponents.function_factory()
```

Recommended usage:

```python
analyzer.compute(["random_spikes", "waveforms"])
analyzer.compute("principal_components", n_components=3, mode="by_channel_local", whiten=True)

ext = analyzer.get_extension("principal_components")
proj = ext.get_data()                              # (n_random_spikes, n_components, n_channels)
model = ext.get_pca_model()                        # list of PCA per channel, or single model
unit_proj = ext.get_projections_one_unit(unit_id=1)
some_proj, spike_unit_indices = ext.get_some_projections()
ext.run_for_all_spikes(file_path="all_pca_projections.npy")
```
