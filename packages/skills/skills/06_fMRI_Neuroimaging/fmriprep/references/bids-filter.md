# BIDS Filter File Reference

`--bids-filter-file FILE` lets you pass fMRIPrep a JSON file with custom
PyBIDS queries — the way to select input data on any BIDS entity that isn't
covered by `--participant-label`, `--session-label`, `--task-id`, or
`--echo-idx`.

## Table of Contents
1. [Syntax overview](#syntax-overview)
2. [Default filters (what fMRIPrep queries by default)](#default-filters-what-fmriprep-queries-by-default)
3. [Filter entity reference](#filter-entity-reference)
4. [Special values: `null` and `"*"`](#special-values-null-and-)
5. [Worked examples](#worked-examples)
6. [Combining with other flags](#combining-with-other-flags)
7. [Validating your filter](#validating-your-filter)

---

## Syntax overview

A single JSON object with a well-known set of top-level keys (the "query
names") — each maps to an entity-value dict. Only entries whose top-level
key matches a fMRIPrep query take effect.

```json
{
    "<query_name>": {
        "<bids_entity>": "<filter_value>",
        ...
    },
    ...
}
```

Common `query_name`s: `t1w`, `t2w`, `bold`, `flair`, `fmap`, `sbref`, `roi`.

Entity keys are PyBIDS entity names: `datatype`, `suffix`, `session`,
`acquisition`, `run`, `direction`, `reconstruction`, `subject`, `task`,
`echo`, `part`, etc. See the PyBIDS config:
https://github.com/bids-standard/pybids/blob/main/src/bids/layout/config/bids.json

---

## Default filters (what fMRIPrep queries by default)

If you don't pass a filter file, these are the built-in queries used by
fMRIPrep (from the official FAQ):

```json
{
    "fmap":  {"datatype": "fmap"},
    "bold":  {"datatype": "func", "suffix": "bold"},
    "sbref": {"datatype": "func", "suffix": "sbref"},
    "flair": {"datatype": "anat", "suffix": "FLAIR"},
    "t2w":   {"datatype": "anat", "suffix": "T2w"},
    "t1w":   {"datatype": "anat", "suffix": "T1w"},
    "roi":   {"datatype": "anat", "suffix": "roi"}
}
```

Note: fMRIPrep delegates data collection to
`niworkflows.utils.bids.collect_data`, which in current niworkflows versions
adds `"part": ["mag", None]` to `t1w`/`t2w`/`bold`/`sbref`/`flair` so complex
`part-phase` images are excluded automatically. If you need to keep `part-phase`
data (rare), override the query explicitly with your own filter file.

Any query you include in your file OVERRIDES the matching default entirely
(the merge is per-query, not per-entity). Only the queries you override change
— unspecified queries keep their defaults.

---

## Filter entity reference

Values are compared to file entity values (all strings). Supports:

| Value | Meaning |
|-------|---------|
| `"01"`, `"rest"`, `"AP"`, ... | Literal string match |
| `["01", "02"]` | Match any of these values |
| `null` | Match files that have NO value for this entity |
| `"*"` | Match files with ANY non-empty value for this entity |

---

## Special values: `null` and `"*"`

`null` → PyBIDS `Query.NONE`: matches files without that entity in their name/metadata.

Use case: select the T1w that has no `acquisition-` tag when the dataset has
both `acq-original` and `acq-clean` variants.

```json
{"t1w": {"datatype": "anat", "suffix": "T1w", "acquisition": null}}
```

`"*"` → PyBIDS `Query.ANY`: matches files where the entity is present with any value.

Use case: only include BOLD runs that have an explicit `run-` entity.

```json
{"bold": {"datatype": "func", "suffix": "bold", "run": "*"}}
```

---

## Worked examples

### Session 02 T1w, session 02 BOLD (from the fMRIPrep docs FAQ)

```json
{
    "t1w": {
        "datatype": "anat",
        "session": "02",
        "acquisition": null,
        "suffix": "T1w"
    },
    "bold": {
        "datatype": "func",
        "session": "02",
        "suffix": "bold"
    }
}
```

Note: `--session-label 02` is a simpler equivalent for the same result when
you don't need entity-level nuances.

### Only rest-task BOLD runs

```json
{
    "bold": {"datatype": "func", "suffix": "bold", "task": "rest"}
}
```

Equivalent to `--task-id rest`.

### Multiple acquisitions, but not "hurried"

```json
{
    "bold": {
        "datatype": "func",
        "suffix": "bold",
        "acquisition": ["mb4", "mb8"]
    }
}
```

Or exclude a specific value — PyBIDS doesn't have a "not equal" match; use
`--force-index`/`--ignore` or `.bidsignore` for exclusion patterns.

### Preferred T1w by reconstruction

Dataset has `rec-defaced` and `rec-original` T1w — pick original:

```json
{
    "t1w": {
        "datatype": "anat",
        "suffix": "T1w",
        "reconstruction": "original"
    }
}
```

### AP-direction PEPOLAR EPIs only (both dirs would confuse SDC selection)

```json
{
    "fmap": {"datatype": "fmap", "direction": "AP"}
}
```

### Multi-echo dataset, restrict to echo 2 for tests

```json
{
    "bold": {"datatype": "func", "suffix": "bold", "echo": "2"}
}
```

(Or use `--echo-idx 2`.)

### Only runs with a matching sbref

Two-query filter: require BOTH BOLD and its sbref to have `run` entity.

```json
{
    "bold":  {"datatype": "func", "suffix": "bold",  "run": "*"},
    "sbref": {"datatype": "func", "suffix": "sbref", "run": "*"}
}
```

### Only session that DOESN'T have `acq-` tag on the T1w

```json
{
    "t1w": {
        "datatype": "anat",
        "suffix": "T1w",
        "acquisition": null
    }
}
```

---

## Combining with other flags

The filter file is applied on top of `--participant-label` / `--session-label`
/ `--task-id` / `--echo-idx`. Order of operations:

1. `--participant-label` restricts the subjects that get processed.
2. Within each subject, PyBIDS queries (default OR overridden by your filter)
   run against the subject's files.
3. `--task-id`, `--session-label`, `--echo-idx` further filter the BOLD query
   *after* the filter file is applied.

So `--task-id rest --bids-filter-file f.json` with a filter of
`{"bold": {"acquisition": "mb4"}}` yields BOLD files with
`task-rest AND acq-mb4`.

Also consider:

- `--bids-database-dir /path/to/db` — pre-computed PyBIDS SQLite index.
  Speeds up filtering for large datasets. Create with:
  ```bash
  pybids layout <bids_root> <db_dir> --no-validate --index-metadata
  ```
- `--ignore` (fMRIPrep-level, disables aspects of processing) or
  `.bidsignore` at the dataset root (excludes files from PyBIDS/bids-validator
  altogether) — for finer control over what files reach the pipeline. Note:
  the `--force-index` PyBIDS flag is *not* exposed by fMRIPrep's CLI despite
  older docs referencing it; use `.bidsignore` instead.

---

## Validating your filter

Before running fMRIPrep, test the filter with PyBIDS in Python:

```python
from bids import BIDSLayout
from bids.layout import Query
import json

layout = BIDSLayout("/data/bids", validate=False)

with open("my_filter.json") as f:
    filters = json.load(f)

# Replace None → Query.NONE, "*" → Query.ANY
def clean(d):
    return {k: (Query.NONE if v is None else Query.ANY if v == "*" else v)
            for k, v in d.items()}

for query_name, query in filters.items():
    print(f"\n=== {query_name} ===")
    files = layout.get(**clean(query))
    for f in files[:5]:
        print(f.path)
    print(f"... ({len(files)} total)")
```

Iterate on your filter until the file lists look right, THEN pass it to fMRIPrep.

---

## Common pitfalls

1. **Wrong query key** — a top-level key that isn't in `{t1w, t2w, bold, flair, fmap, sbref, roi}` is silently ignored. Watch spelling.
2. **`suffix` vs `datatype`** — `suffix` is the final `_bold`/`_T1w` label; `datatype` is the folder (`func`/`anat`/`fmap`). Provide both when overriding.
3. **PyBIDS entity vs metadata key** — `session`, `acquisition`, etc. are entities (folder/filename); metadata (e.g., `RepetitionTime`) is NOT filterable via `--bids-filter-file` — use `--force-index`/`--ignore` or `.bidsignore`.
4. **JSON quoting** — `null` is unquoted; `"*"` is a quoted string.
5. **Path separator** — On Windows, use forward slashes in your JSON paths.

---

## Reference

- fMRIPrep FAQ on filter files: https://fmriprep.readthedocs.io/en/latest/faq.html#how-do-I-select-only-certain-files-to-be-input-to-fMRIPrep
- PyBIDS entity dictionary: https://github.com/bids-standard/pybids/blob/main/src/bids/layout/config/bids.json
- BIDS entity table: https://bids-specification.readthedocs.io/en/stable/appendices/entity-table.html
