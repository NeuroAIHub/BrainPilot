# template_similarity — ComputeTemplateSimilarity
Source in repo: `spikeinterface/src/spikeinterface/postprocessing/template_similarity.py`
Parent index: [INDEX.md](INDEX.md)
---

## template_similarity — ComputeTemplateSimilarity

- extension name: `"template_similarity"`
- Compute class: `ComputeTemplateSimilarity(AnalyzerExtension)`
- depends on: `["templates"]`, `need_recording=False`, `use_nodepipeline=False`, `need_job_kwargs=False`
- `need_backward_compatibility_on_load = True` (analyzers created before adding `max_lag_ms` are patched to `max_lag_ms=0.0`, `support="union"`)
- Source: `src/spikeinterface/postprocessing/template_similarity.py`

Parameters (from `_set_params`):

```python
def _set_params(self, method="cosine", max_lag_ms=0, support="union"):
    params = dict(method=method, max_lag_ms=max_lag_ms, support=support)
    return params
```

- `method`: `"cosine" | "l1" | "l2"`, default `"cosine"`. The alias `"cosine_similarity"` is accepted by the lower-level `compute_similarity_with_templates_array` and remapped to `"cosine"`.
- `max_lag_ms`: `float`, default `0`. Best similarity across shifts within ±`max_lag_ms` is kept.
- `support`: `"dense" | "union" | "intersection"`, default `"union"`. Which channels contribute to the pairwise metric given the templates' sparsities.

Similarity is defined as `1 - distance(T_1, T_2)`.

Public convenience function:
```python
compute_template_similarity = ComputeTemplateSimilarity.function_factory()
```

Related module-level helpers (also re-exported from `postprocessing/__init__.py`):

```python
def compute_similarity_with_templates_array(
    templates_array,
    other_templates_array,
    method,
    support="union",
    num_shifts=0,
    sparsity=None,
    other_sparsity=None,
)
```

- `method`: `"cosine" | "l1" | "l2"` (accepts alias `"cosine_similarity"`, remapped to `"cosine"`); required positional (no default).
- `support`: `"dense" | "union" | "intersection"`, default `"union"`.
- `num_shifts`: `int`, default `0`.

```python
def compute_template_similarity_by_pair(
    sorting_analyzer_1, sorting_analyzer_2, method="cosine", support="union", num_shifts=0
)
```

- `method`: `"cosine" | "l1" | "l2"`, default `"cosine"`.
- `support`: `"dense" | "union" | "intersection"`, default `"union"`.
- `num_shifts`: `int`, default `0`.

```python
def check_equal_template_with_distribution_overlap(
    waveforms0, waveforms1, template0=None, template1=None, num_shift=2, quantile_limit=0.8, return_shift=False
)
```

- `num_shift`: `int`, default `2`.
- `quantile_limit`: `float`, default `0.8`.
- `return_shift`: `bool`, default `False`.

Recommended usage:

```python
analyzer.compute("template_similarity", method="cosine", max_lag_ms=0.2, support="union")
sim = analyzer.get_extension("template_similarity").get_data()   # (num_units, num_units)
```
