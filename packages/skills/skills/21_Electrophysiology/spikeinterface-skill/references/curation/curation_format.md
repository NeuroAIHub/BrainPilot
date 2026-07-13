# Curation format
Source in repo: `spikeinterface/src/spikeinterface/curation/curation_format.py`
Parent index: [INDEX.md](INDEX.md)
---

## Curation format

### Curation format schema (v2)

Defined in `curation_model.py` via Pydantic. The `Curation` model has these fields:

- `supported_versions: tuple[Literal["1"], Literal["2"]]` - fixed as `("1", "2")`.
- `format_version: str` - must be one of the supported versions. Older `"0"` (sortingview)
  format and `"1"` fields (`merge_unit_groups`, `removed_units`) are auto-migrated to the
  v2 shape (`merges`, `removed`).
- `unit_ids: list[int | str]` - the unit id universe.
- `label_definitions: dict[str, LabelDefinition] | None` - see nested schema below.
- `manual_labels: list[ManualLabel] | None` - see nested schema below.
- `removed: list[int | str] | None` - unit ids to drop (also accessible in old format as
  `removed_units`).
- `merges: list[Merge] | None` - merge groups (also accessible in old format as
  `merge_unit_groups` / `merged_unit_groups` / `mergeGroups`).
- `splits: list[Split] | None` - unit splits.

Nested schemas (verbatim from `curation_model.py`):

- `LabelDefinition`:
  - `name: str`
  - `label_options: list[str]` (min length 2)
  - `exclusive: bool` (whether at most one option applies per unit)
- `ManualLabel`:
  - `unit_id: int | str`
  - `labels: dict[str, list[str]]` (label category name -> selected options)
- `Merge`:
  - `unit_ids: list[int | str]` (>=2 elements enforced by validator)
  - `new_unit_id: int | str | None` (optional target id)
- `Split`:
  - `unit_id: int | str`
  - `mode: Literal["indices", "labels"]` (default `"indices"`) - allowed values are
    exactly `"indices"` and `"labels"`.
  - `indices: list[list[int]] | None` - required in `"indices"` mode.
  - `labels: list[int] | None` - required in `"labels"` mode.
  - `new_unit_ids: list[int | str] | None`
  - Method: `get_full_spike_indices(sorting: BaseSorting)` - for `mode="indices"` fills
    remainder from the full spike range if the supplied indices do not cover all spikes;
    for `mode="labels"` groups spike indices by label.

A `SequentialCuration` model wraps `curation_steps: List[Curation]` for chained curations;
every step (except the last) must specify explicit `new_unit_id`s / `new_unit_ids` so that
the next step's `unit_ids` line up.

Root-model validators enforce: labeled/merged/split/removed unit sets are subsets of
`unit_ids`; no unit belongs to multiple merge groups; no overlap between merged, split,
and removed sets; exclusive labels have at most one selected option per unit.

Example dict:

```python
curation_dict = {
    "format_version": "2",
    "unit_ids": [0, 1, 2, 3, 4],
    "label_definitions": {
        "quality": {
            "label_options": ["good", "mua", "noise"],
            "exclusive": True,
        }
    },
    "manual_labels": [
        {"unit_id": 0, "labels": {"quality": ["good"]}},
        {"unit_id": 1, "labels": {"quality": ["mua"]}},
    ],
    "merges": [{"unit_ids": [2, 3], "new_unit_id": 100}],
    "splits": [],
    "removed": [4],
}
```


### apply_curation

Verbatim signature from `curation_format.py`:

```python
def apply_curation(
    sorting_or_analyzer: BaseSorting | SortingAnalyzer,
    curation_dict_or_model: dict | list | Curation | SequentialCuration,
    censor_ms: float | None = None,
    new_id_strategy: str = "append",
    merging_mode: str = "soft",
    sparsity_overlap: float = 0.75,
    raise_error_if_overlap_fails: bool = True,
    verbose: bool = False,
    **job_kwargs,
)
```

Parameters (note: `new_id_strategy` values differ from `auto_merge_units` because
`"join"` is additionally allowed here):

- `sorting_or_analyzer` (`BaseSorting | SortingAnalyzer`) - target to curate.
- `curation_dict_or_model` (`dict | list | Curation | SequentialCuration`) - the curation.
  A `list` is auto-wrapped as `SequentialCuration(curation_steps=...)`, and the function
  recurses per step.
- `censor_ms` (`float | None`, default `None`) - refractory-like window applied when
  merging; consecutive spikes within `censor_ms` are removed. `None` keeps all spikes.
- `new_id_strategy` (`"append" | "take_first" | "join"`, default `"append"`) - id
  allocation for merged units:
  - `"append"` - new ids appended past `max(sorting.unit_ids)`.
  - `"take_first"` - use the first unit id of every merge group.
  - `"join"` - concatenation of all unit ids in each merge group.
- `merging_mode` (`"soft" | "hard"`, default `"soft"`) - `"soft"` approximates merged
  waveform extensions; `"hard"` reloads/recomputes waveforms accurately.
- `sparsity_overlap` (`float`, default `0.75`) - fractional overlap required to accept a
  soft merge on an analyzer.
- `raise_error_if_overlap_fails` (`bool`, default `True`) - if True, failure raises; if
  False, the failing merge is skipped.
- `verbose` (`bool`, default `False`) - prints progress for sequential curations.
- `**job_kwargs` - forwarded to `merge_units`.

Applies steps in fixed order:

1. Set manual-label unit properties via `apply_curation_labels`.
2. Remove units in `curation.removed`.
3. Merge groups in `curation.merges` (using `apply_merges_to_sorting` for a Sorting, or
   `SortingAnalyzer.merge_units` for an analyzer).
4. Apply splits in `curation.splits` (using `apply_splits_to_sorting` /
   `SortingAnalyzer.split_units`).


### validate_curation_dict

Verbatim signature from `curation_format.py`:

```python
def validate_curation_dict(curation_dict: dict)
```

Parameters:

- `curation_dict` (`dict`) - dict to validate.

Instantiates `Curation(**curation_dict)`. Raises `ValueError`/`ValidationError` on invalid
schema; returns `None` on success.


### load_curation

Verbatim signature from `curation_format.py`:

```python
def load_curation(curation_path: str | Path) -> Curation
```

Parameters:

- `curation_path` (`str | Path`) - path to a JSON file.

Returns a `Curation` model built from the JSON contents.


### curation_label_to_dataframe

Verbatim signature from `curation_format.py`:

```python
def curation_label_to_dataframe(curation_dict_or_model: dict | Curation)
```

Parameters:

- `curation_dict_or_model` (`dict | Curation`) - curation to convert.

Returns a pandas DataFrame indexed by `unit_ids`. Exclusive label categories become one
column whose values are the selected option strings; non-exclusive categories become one
boolean column per option.


### curation_label_to_vectors

Verbatim signature from `curation_format.py`:

```python
def curation_label_to_vectors(curation_dict_or_model: dict | Curation)
```

Parameters:

- `curation_dict_or_model` (`dict | Curation`) - curation to convert.

Returns a `dict` of numpy vectors, one per label category/option. For exclusive
categories, the value at each unit is the selected option string (or `""`); for
non-exclusive categories, one boolean vector per option is produced.
