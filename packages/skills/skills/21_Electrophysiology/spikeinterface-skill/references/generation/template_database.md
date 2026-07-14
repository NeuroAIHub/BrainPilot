# Template database (`template_database.py`)
Source in repo: `spikeinterface/src/spikeinterface/generation/template_database.py`
Parent index: [INDEX.md](INDEX.md)
---

The database lives at `s3://spikeinterface-template-database/` and is accessed anonymously (`storage_options={"anon": True}`).

### `fetch_template_object_from_database`

```python
@functools.cache
def fetch_template_object_from_database(dataset="test_templates.zarr") -> Templates
```

Fetch a single Templates dataset (Zarr) from the database. The result is cached via `functools.cache`.

Parameters:
- `dataset` (str, default `"test_templates.zarr"`): Name of the dataset (Zarr store name) to fetch from the database.

### `fetch_templates_database_info`

```python
@functools.cache
def fetch_templates_database_info() -> "pandas.DataFrame"
```

Load `templates.csv` from the database into a `pandas.DataFrame` describing available templates. Result cached via `functools.cache`. The DataFrame includes at least a `dataset` column and a `template_index` column, plus additional metadata columns.

### `list_available_datasets_in_template_database`

```python
def list_available_datasets_in_template_database() -> list
```

Return the unique `dataset` values from the database info table (`np.unique(df["dataset"]).tolist()`).

### `query_templates_from_database`

```python
def query_templates_from_database(template_df: "pandas.DataFrame", verbose: bool = False) -> Templates
```

Given a (filtered) slice of the database info dataframe, load matching templates from each referenced dataset, verify their `nbefore`, `sampling_frequency`, and relative channel positions are consistent across datasets, then concatenate them into a single `Templates` object.

Parameters:
- `template_df` (pandas.DataFrame): Slice of the database info dataframe (must include `dataset` and `template_index` columns).
- `verbose` (bool, default False).
