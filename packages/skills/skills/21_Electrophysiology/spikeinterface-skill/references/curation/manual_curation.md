# Manual curation classes
Source in repo: `spikeinterface/src/spikeinterface/curation/curationsorting.py`
Parent index: [INDEX.md](INDEX.md)
---

## Manual curation classes

### CurationSorting

Programmatic (stage-based) manual curation with undo/redo. Wraps a base `Sorting` and applies
merges/splits/removals as a sequence of stages.

Constructor (verbatim from `curationsorting.py`):

```python
class CurationSorting:
    def __init__(self, sorting, make_graph=False, properties_policy="keep")
```

Parameters:

- `sorting` (`BaseSorting`) - the sorting object to curate.
- `make_graph` (`bool`, default `False`) - True to keep a NetworkX graph instance with the
  curation history.
- `properties_policy` (`"keep" | "remove"`, default `"keep"`) - policy used to propagate
  properties after split and merge operations. `"keep"` propagates values that match across
  the source units; `"remove"` clears them on the new units.

There is also a functional alias `curation_sorting(...)` equivalent to `CurationSorting(...)`
(created via `define_function_from_class(source_class=CurationSorting, name="curation_sorting")`).

Methods (verbatim signatures from `curationsorting.py`):

- `split(split_unit_id, indices_list, new_unit_ids=None)` - split one unit into multiple.
  `indices_list` is a list of index arrays (per segment) assigning each spike to a
  sub-group id; single-segment sortings accept a single array.
- `merge(units_to_merge, new_unit_id=None, delta_time_ms=0.4)` - merge unit ids into a new
  single unit. `delta_time_ms` deduplicates near-coincident spikes; `None` skips
  deduplication.
- `remove_units(unit_ids)` - remove a list of unit ids.
- `remove_unit(unit_id)` - remove a single unit id (calls `remove_units([unit_id])`).
- `select_units(unit_ids, renamed_unit_ids=None)` - keep only `unit_ids`, optionally
  renaming.
- `rename(renamed_unit_ids)` - rename all current units (delegates to `select_units`).
- `remove_empty_units()` - drop units with zero spikes.
- `redo_available() -> bool` - True if a redo step is available.
- `undo_available() -> bool` - True if an undo step is available.
- `undo()` - move one stage backward.
- `redo()` - move one stage forward.
- `draw_graph(**kwargs)` - draw the NetworkX curation graph (requires `make_graph=True`).
  `**kwargs` are keyword arguments for the NetworkX `draw` function.

Properties / attributes:

- `sorting` (property) - alias for `current_sorting`.
- `current_sorting` (property) - the sorting at the current stage.
- `graph` (property) - the NetworkX DiGraph at the current stage (requires
  `make_graph=True`; raises `AssertionError` otherwise).
- `max_used_id` - the largest numeric unit id seen so far (used to allocate new ids).

Example:

```python
from spikeinterface.curation import CurationSorting

cs = CurationSorting(sorting, make_graph=False, properties_policy="keep")
cs.merge([3, 5], new_unit_id=100)
cs.remove_units([7, 8])
curated_sorting = cs.sorting
```


### MergeUnitsSorting

Non-lazy Sorting wrapper that applies (possibly multiple) merge groups at once.

Constructor (verbatim from `mergeunitssorting.py`):

```python
class MergeUnitsSorting(BaseSorting):
    def __init__(self, sorting, units_to_merge, new_unit_ids=None, properties_policy="keep", delta_time_ms=0.4)
```

Parameters:

- `sorting` (`BaseSorting`) - the sorting object to be merged.
- `units_to_merge` (list/tuple of lists/tuples) - one inner list per merge group; each
  inner list must contain at least two unit ids. A flat list (single merge) is also
  accepted for backward compatibility and is wrapped into `[units_to_merge]`.
- `new_unit_ids` (`None | list`, default `None`) - explicit new unit ids for each merge
  group. If given, must have same length as `units_to_merge`. Otherwise ids are auto-generated
  using `new_id_strategy="append"` (see `generate_unit_ids_for_merge_group`).
- `properties_policy` (`"keep" | "remove"`, default `"keep"`) - `"keep"` propagates values
  when identical across merged units, else uses `NaN` (float), `""` (str), or `None`
  (object) fallbacks; `"remove"` drops properties on the new merged units.
- `delta_time_ms` (`float | None`, default `0.4`) - refractory-like guard for duplicate
  spikes across merged trains, in milliseconds. `None` disables deduplication.

Functional alias: `merge_units_sorting = define_function_from_class(source_class=MergeUnitsSorting, name="merge_units_sorting")`.


### SplitUnitSorting

Non-lazy Sorting wrapper that splits a single unit into multiple sub-units by spike-index
assignment.

Constructor (verbatim from `splitunitsorting.py`):

```python
class SplitUnitSorting(BaseSorting):
    def __init__(self, sorting, split_unit_id, indices_list, new_unit_ids=None, properties_policy="keep")
```

Parameters:

- `sorting` (`BaseSorting`) - the sorting object.
- `split_unit_id` (int/str) - the unit id to split.
- `indices_list` (list or np.ndarray) - one integer label array per segment; each entry
  assigns a spike to a sub-unit label. If the sorting has one segment, a single array is
  accepted.
- `new_unit_ids` (int | list | None, default `None`) - explicit new ids (must be unique
  and have length equal to the number of unique labels). If `None`, ids are picked one
  above the current max numeric id.
- `properties_policy` (`"keep" | "remove"`, default `"keep"`) - same semantics as
  `MergeUnitsSorting`: `"keep"` copies parent property values to all split children,
  `"remove"` drops them.

Functional alias: `split_unit_sorting = define_function_from_class(source_class=SplitUnitSorting, name="split_unit_sorting")`.
