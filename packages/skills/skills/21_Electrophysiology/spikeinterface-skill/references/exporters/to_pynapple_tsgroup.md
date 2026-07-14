# to_pynapple_tsgroup
Source in repo: `spikeinterface/src/spikeinterface/exporters/to_pynapple.py`
Parent index: [INDEX.md](INDEX.md)
---

Convert a `SortingAnalyzer` or `Sorting` into a `pynapple.TsGroup`. Source: `spikeinterface/exporters/to_pynapple.py`.

(Note: exported name is `to_pynapple_tsgroup`, not `export_to_pynapple`.)

### Signature (verbatim from source)

```python
def to_pynapple_tsgroup(
    sorting_analyzer_or_sorting: SortingAnalyzer | BaseSorting,
    attach_unit_metadata=True,
    attach_unit_properties=True,
    segment_index=None,
):
```

### Parameters (verbatim from docstring)

- `sorting_analyzer_or_sorting : SortingAnalyzer` — A SortingAnalyzer object. (Accepts a `BaseSorting` as well — see the signature annotation.)
- `attach_unit_metadata : bool, default: True` — If True, any relevant available metadata is attached to the TsGroup. Will attach `unit_locations`, `quality_metrics` and `template_metrics` if computed. If False, no metadata is included.
- `attach_unit_properties : bool, default: False` — If True, attach properties of the sorting. (Note: the docstring says `default: False`, but the actual signature default is `True`. The behaviour at runtime follows the signature.)
- `segment_index : int | None, default: None` — The segment index. Can be None if mono-segment sorting.

### Returns

- `spike_train_TsGroup : pynapple.TsGroup` — A TsGroup object from the pynapple package.

### Required SortingAnalyzer extensions

None strictly required — all metadata attachments are opportunistic:

- If `attach_unit_metadata=True` and the input is a `SortingAnalyzer`, the function reads (via `get_extension(...)` returning None if absent) the following extensions when already computed: `"unit_locations"`, `"quality_metrics"`, `"template_metrics"`. When `unit_locations` is present, its columns are named `["x", "y", "z"][:n_dims]` (where `n_dims` is the number of columns in the unit-locations array).
- If `attach_unit_properties=True`, all keys returned by `sorting.get_property_keys()` are added as columns of the TsGroup metadata DataFrame.

### Constraints

- Requires the `pynapple` package (raises `ImportError("`to_pynapple_tsgroup` requires the pynapple package to be installed. Please install with pip install pynapple")` otherwise).
- The `sorting_analyzer_or_sorting` argument must be a `SortingAnalyzer` or `BaseSorting`, otherwise a `TypeError` is raised.
- If `unit_ids` are not castable to `int`, the TsGroup index is `np.arange(len(unit_ids))` and the original ids are stored as a `"unit_id"` metadata column (warning is emitted).

### Usage

The docstring contains no example. Minimal usage:

```python
from spikeinterface.exporters import to_pynapple_tsgroup

tsgroup = to_pynapple_tsgroup(sorting_analyzer)
```
