# Automated merging - functions
Source in repo: `spikeinterface/src/spikeinterface/curation/auto_merge.py`
Parent index: [INDEX.md](INDEX.md)
---

## Automated merging

The unified entry points for auto-merge live in `auto_merge.py`. `compute_merge_unit_groups`
identifies candidate merge groups; `auto_merge_units` runs it (potentially across multiple
presets) and applies the merges to the analyzer. `get_potential_auto_merge` is deprecated and
now dispatches to `compute_merge_unit_groups`.

### compute_merge_unit_groups

Verbatim signature from `auto_merge.py`:

```python
def compute_merge_unit_groups(
    sorting_analyzer: SortingAnalyzer,
    preset: str | None = "similarity_correlograms",
    resolve_graph: bool = True,
    steps_params: dict = None,
    compute_needed_extensions: bool = True,
    extra_outputs: bool = False,
    steps: list[str] | None = None,
    force_copy: bool = True,
    **job_kwargs,
) -> list[tuple[int | str, int | str]] | Tuple[list[tuple[int | str, int | str]], dict]
```

Parameters:

- `sorting_analyzer` (`SortingAnalyzer`) - the analyzer to work on.
- `preset` (`str | None`, default `"similarity_correlograms"`) - one of the presets
  documented in the docstring:
  `"similarity_correlograms"`, `"x_contaminations"`, `"temporal_splits"`,
  `"feature_neighbors"`, `"slay"`, or `None`. If `None`, `steps` must be given. Note:
  the type hint in the source lists only the first four presets, but `"slay"` is a valid
  registered preset (see `_compute_merge_presets`).
- `resolve_graph` (`bool`, default `True`) - if True, resolves pairs into multi-unit groups
  via connected components; if False, returns raw pairs of length 2.
- `steps_params` (`dict`, default `None`) - override step parameters. Keys are step names
  (see the step list); values are dicts of parameter overrides.
- `compute_needed_extensions` (`bool`, default `True`) - if True, missing analyzer
  extensions are computed on the fly; if False, missing extensions raise `ValueError`.
- `extra_outputs` (`bool`, default `False`) - if True, also returns an `outs` debug dict.
- `steps` (`list[str] | None`, default `None`) - explicit list of step names, mutually
  exclusive with `preset`. Allowed keys: any of `"num_spikes"`, `"snr"`,
  `"remove_contaminated"`, `"unit_locations"`, `"correlogram"`, `"template_similarity"`,
  `"presence_distance"`, `"cross_contamination"`, `"knn"`, `"quality_score"`,
  `"slay_score"`.
- `force_copy` (`bool`, default `True`) - if True, copies the analyzer before computing
  new extensions so existing ones are not overwritten.
- `**job_kwargs` - forwarded to any newly computed extension.

Returns `merge_unit_groups` (list of tuples of unit ids); if `extra_outputs=True`, returns
`(merge_unit_groups, outs)`.


### auto_merge_units

Verbatim signature from `auto_merge.py`:

```python
def auto_merge_units(
    sorting_analyzer: SortingAnalyzer,
    presets: list | None = ["similarity_correlograms"],
    steps_params: dict = None,
    steps: list[str] | None = None,
    recursive: bool = False,
    censor_ms=None,
    sparsity_overlap=0.75,
    merging_mode="soft",
    new_id_strategy="append",
    raise_error: bool = False,
    extra_outputs: bool = False,
    force_copy: bool = True,
    **job_kwargs,
) -> SortingAnalyzer
```

Parameters:

- `sorting_analyzer` (`SortingAnalyzer`) - analyzer to auto-merge.
- `presets` (`str | list | None`, default `["similarity_correlograms"]`) - one or more
  presets to apply in sequence (a string is auto-wrapped in a list). Allowed values are
  `"similarity_correlograms"`, `"x_contaminations"`, `"temporal_splits"`,
  `"feature_neighbors"`, `"slay"`. Mutually exclusive with `steps`.
- `steps_params` (`dict | list of dict`, default `None`) - per-preset/per-steps parameter
  overrides. Must be the same length as `presets`/`steps`, or `None`.
- `steps` (`list[str] | list[list[str]] | None`, default `None`) - explicit list(s) of
  step names, mutually exclusive with `presets`. Same allowed step names as
  `compute_merge_unit_groups`.
- `recursive` (`bool`, default `False`) - if True, re-runs each preset/steps set until no
  further merges are proposed before moving on.
- `censor_ms` (`float | None`, default `None`) - refractory-like window; consecutive
  spikes closer than this after a merge are discarded. `None` keeps all spikes.
- `sparsity_overlap` (`float`, default `0.75`) - minimum sparsity overlap required to
  accept a soft merge.
- `merging_mode` (`"soft" | "hard"`, default `"soft"`) - `"soft"` approximates the
  extension data without reloading waveforms; `"hard"` reloads/recomputes them.
- `new_id_strategy` (`"append" | "take_first"`, default `"append"`) - id strategy for
  merged units. `"append"` allocates ids past `max(sorting.unit_ids)`; `"take_first"`
  reuses the first unit_id of each merge group.
- `raise_error` (`bool`, default `False`) - if True, unmergeable groups raise
  `ValueError`; otherwise a warning is issued and the group is skipped.
- `extra_outputs` (`bool`, default `False`) - if True, returns
  `(analyzer, resolved_merges, merge_unit_groups, all_outs)`.
- `force_copy` (`bool`, default `True`) - if True, copies the analyzer first.
- `**job_kwargs` - forwarded to internal extension computations and `merge_units` calls.

Returns the merged `SortingAnalyzer` (or the extended tuple when `extra_outputs=True`).


### get_potential_auto_merge (deprecated)

Verbatim signature from `auto_merge.py`:

```python
def get_potential_auto_merge(
    sorting_analyzer: SortingAnalyzer,
    preset: str | None = "similarity_correlograms",
    resolve_graph: bool = False,
    min_spikes: int = 100,
    min_snr: float = 2,
    max_distance_um: float = 150.0,
    corr_diff_thresh: float = 0.16,
    template_diff_thresh: float = 0.25,
    contamination_thresh: float = 0.2,
    presence_distance_thresh: float = 100.0,
    p_value: float = 0.2,
    cc_thresh: float = 0.1,
    censored_period_ms: float = 0.3,
    refractory_period_ms: float = 1.0,
    sigma_smooth_ms: float = 0.6,
    adaptative_window_thresh: float = 0.5,
    censor_correlograms_ms: float = 0.15,
    firing_contamination_balance: float = 1.5,
    k_nn: int = 10,
    knn_kwargs: dict | None = None,
    presence_distance_kwargs: dict | None = None,
    extra_outputs: bool = False,
    steps: list[str] | None = None,
) -> list[tuple[int | str, int | str]] | Tuple[tuple[int | str, int | str], dict]
```

Emits a `DeprecationWarning` and internally calls `compute_merge_unit_groups` with an
appropriate `steps_params` dict. `preset` accepts the same five presets:
`"similarity_correlograms"`, `"x_contaminations"`, `"temporal_splits"`,
`"feature_neighbors"`, `"slay"`, or `None`. Scheduled for removal in v0.105.0.
