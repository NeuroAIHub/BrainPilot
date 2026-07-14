# Multi comparisons
Source in repo: `spikeinterface/src/spikeinterface/comparison/multicomparisons.py`
Parent index: [INDEX.md](INDEX.md)
---

Defined in `multicomparisons.py`.

### `MultiSortingComparison` / `compare_multiple_sorters`

Compare more than two sorters via pair-wise `SymmetricSortingComparison`
combined into an agreement graph. `compare_multiple_sorters` is generated
from the class via
`define_function_from_class(source_class=MultiSortingComparison, name="compare_multiple_sorters")`.

Signature (verbatim from source):

```python
MultiSortingComparison(
    sorting_list,
    name_list=None,
    delta_time=0.4,           # sampling_frequency=None,
    match_score=0.5,
    chance_score=0.1,
    agreement_method="count", # "count" | "distance"
    n_jobs=-1,
    spiketrain_mode="union",  # "union" | "intersection"
    verbose=False,
    do_matching=True,
)
```

Parameters:
- `sorting_list` (`list`): list of sorting extractors.
- `name_list` (`list | None`, default `None`): if not given, sorters are
  named `"sorting0"`, `"sorting1"`, ....
- `delta_time` (`float`, default `0.4`): ms tolerance for coincident spikes.
- `match_score` (`float`, default `0.5`).
- `chance_score` (`float`, default `0.1`).
- `agreement_method` (`str`, default `"count"`): must be one of `"count"` or
  `"distance"`.
- `n_jobs` (`int`, default `-1`): number of cores for pair-wise comparisons
  (`-1` uses all).
- `spiketrain_mode` (`str`, default `"union"`): must be one of `"union"` or
  `"intersection"`. `"union"` = union of spike trains of the best matching
  two sorters. `"intersection"` = intersection.
- `verbose` (`bool`, default `False`).
- `do_matching` (`bool`, default `True`): if True, matching runs at init.

Key methods:
- `get_agreement_sorting(minimum_agreement_count=1, minimum_agreement_count_only=False)`
  → `AgreementSortingExtractor` — a consensus sorting whose units required a
  given number of sorter agreements.
- Internal helpers (defined on the class): `_compare_ij(i, j)`,
  `_populate_nodes()`, `_populate_spiketrains()`,
  `_do_agreement_matrix(minimum_agreement=1)`.
- Inherited from `BaseMultiComparison`: `compute_subgraphs()`,
  `_compute_all()`, `_do_comparison()`, `_do_graph()`, `_clean_graph()`,
  `_do_agreement()`, `units` (property).

Attributes populated by matching:
- `graph` — the agreement `networkx.Graph`.
- `clean_graph` — deduplicated version of `graph`.
- `subgraphs` — list of connected-component subgraphs.
- `_new_units` — dict of consensus units, each mapping to
  `{"avg_agreement": float, "unit_ids": OrderedDict, "agreement_number": int}`.
- `_spiketrains` — per-segment consensus spike trains
  (`list[dict[unit_id, np.ndarray]]`).
- `_num_segments`, `_spiketrain_mode`, `comparisons` (dict of pair-wise
  `SymmetricSortingComparison` keyed by `(name_i, name_j)`),
  `sampling_frequency`, `delta_frames`, `delta_time`, `agreement_method`,
  `n_jobs`, `match_score`, `chance_score`, `object_list`, `name_list`.

### `MultiTemplateComparison` / `compare_multiple_templates`

Multi-session template matching. `compare_multiple_templates` is generated
from the class via
`define_function_from_class(source_class=MultiTemplateComparison, name="compare_multiple_templates")`.

Signature (verbatim from source, keyword order preserved):

```python
MultiTemplateComparison(
    waveform_list,
    name_list=None,
    match_score=0.8,
    chance_score=0.3,
    verbose=False,
    similarity_method="cosine",  # "cosine" | "l1" | "l2"
    support="union",             # "dense" | "union" | "intersection"
    num_shifts=0,
    do_matching=True,
)
```

Parameters:
- `waveform_list` (`list`): waveform / analyzer objects to compare.
- `name_list` (`list | None`, default `None`): if not given, entries are
  named `"sess0"`, `"sess1"`, ....
- `match_score` (`float`, default `0.8`).
- `chance_score` (`float`, default `0.3`).
- `verbose` (`bool`, default `False`).
- `similarity_method` (`str`, default `"cosine"`): must be one of `"cosine"`,
  `"l1"`, `"l2"`.
- `support` (`str`, default `"union"`): must be one of `"dense"`, `"union"`,
  `"intersection"`.
- `num_shifts` (`int`, default `0`).
- `do_matching` (`bool`, default `True`).

Methods (defined on the class): `_compare_ij(i, j)` (builds a
`TemplateComparison`), `_populate_nodes()`. Inherited from
`BaseMultiComparison`: `compute_subgraphs()`, `units` (property), plus the
same graph/agreement pipeline as `MultiSortingComparison`.

Attributes: `graph`, `clean_graph`, `subgraphs`, `_new_units`, `comparisons`,
`similarity_method`, `support`, `num_shifts`, `match_score`, `chance_score`,
`object_list`, `name_list`.

### `AgreementSortingExtractor`

`BaseSorting` subclass returned by `MultiSortingComparison.get_agreement_sorting`.
Defined in `multicomparisons.py`; not directly re-exported from
`comparison/__init__.py`.

```python
AgreementSortingExtractor(
    sampling_frequency,
    multisortingcomparison,
    min_agreement_count=1,
    min_agreement_count_only=False,
)
```

Behaviour:
- Filters `multisortingcomparison._new_units` by `agreement_number`
  (`==` when `min_agreement_count_only=True`, else `>=`).
- Sets `_serializability["json"] = False`, `_serializability["pickle"] = True`.
- Adds one `AgreementSortingSegment` per segment.

Per-unit properties set on the sorting: `agreement_number`, `avg_agreement`,
`unit_ids` (mapping from sorter name to sorter-specific unit id).

Companion class in the same file: `AgreementSortingSegment(spiketrains_segment)`,
a `BaseSortingSegment` with attribute `spiketrains` and
`get_unit_spike_train(unit_id, start_frame, end_frame)` slicing.
