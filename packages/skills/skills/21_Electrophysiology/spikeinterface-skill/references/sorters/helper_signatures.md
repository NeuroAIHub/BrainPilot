# Top-level helper signatures

Source in repo: `spikeinterface/src/spikeinterface/sorters/__init__.py`
Parent index: [INDEX.md](INDEX.md)
---

Verbatim signatures for every helper exposed from `spikeinterface.sorters.__init__.py`.

## `run_sorter` (from `runsorter.py`)

```python
def run_sorter(
    sorter_name: str,
    recording: BaseRecording | dict,
    folder: str | None = None,
    remove_existing_folder: bool = False,
    delete_output_folder: bool = False,
    verbose: bool = False,
    raise_error: bool = True,
    docker_image: bool | str | None = False,
    singularity_image: bool | str | None = False,
    delete_container_files: bool = True,
    with_output: bool = True,
    **sorter_params,
):
```

## `run_sorter_local` (from `runsorter.py`)

```python
def run_sorter_local(
    sorter_name,
    recording,
    folder=None,
    remove_existing_folder=True,
    delete_output_folder=False,
    verbose=False,
    raise_error=True,
    with_output=True,
    **sorter_params,
):
```

## `run_sorter_container` (from `runsorter.py`)

```python
def run_sorter_container(
    sorter_name: str,
    recording: BaseRecording,
    mode: str,
    container_image: str | None = None,
    folder: str | None = None,
    remove_existing_folder: bool = True,
    delete_output_folder: bool = False,
    verbose: bool = False,
    raise_error: bool = True,
    with_output: bool = True,
    delete_container_files: bool = True,
    extra_requirements=None,
    installation_mode="auto",
    spikeinterface_version=None,
    spikeinterface_folder_source=None,
    **sorter_params,
):
```

`mode` string-Literal values: `"docker"`, `"singularity"`.
`installation_mode` string-Literal values (asserted in source):
`"auto"`, `"pypi"`, `"github"`, `"folder"`, `"dev"`, `"no-install"`.

## `read_sorter_folder` (from `runsorter.py`)

```python
def read_sorter_folder(folder, register_recording=True, sorting_info=True, raise_error=True):
```

## `run_sorter_by_property` (from `launcher.py`)

```python
def run_sorter_by_property(
    sorter_name,
    recording,
    grouping_property,
    folder,
    engine="loop",
    engine_kwargs=None,
    verbose=False,
    docker_image=None,
    singularity_image=None,
    **sorter_params,
):
```

`engine` string-Literal values: `"loop"`, `"joblib"`, `"processpoolexecutor"`, `"dask"`,
`"slurm"` (any key present in `launcher._default_engine_kwargs`).

## `run_sorter_jobs` (from `launcher.py`)

```python
def run_sorter_jobs(job_list, engine="loop", engine_kwargs=None, return_output=False):
```

`engine` string-Literal values (from `launcher._implemented_engine`): `"loop"`, `"joblib"`,
`"processpoolexecutor"`, `"dask"`, `"slurm"`. `return_output=True` is allowed only for
`"loop"`, `"joblib"`, `"processpoolexecutor"`.

## `get_default_sorter_params` (from `sorterlist.py`)

```python
def get_default_sorter_params(sorter_name_or_class) -> dict:
    """Returns default parameters for the specified sorter.

    Parameters
    ----------
    sorter_name_or_class : str or SorterClass
        The sorter to retrieve default parameters from.

    Returns
    -------
    default_params : dict
        Dictionary with default params for the specified sorter.
    """
```

## `get_sorter_params_description` (from `sorterlist.py`)

```python
def get_sorter_params_description(sorter_name_or_class) -> dict:
    """Returns a description of the parameters for the specified sorter.

    Parameters
    ----------
    sorter_name_or_class : str or SorterClass
        The sorter to retrieve parameters description from.

    Returns
    -------
    params_description : dict
        Dictionary with parameter description
    """
```

## `get_sorter_description` (from `sorterlist.py`)

```python
def get_sorter_description(sorter_name_or_class) -> dict:
    """Returns a brief description for the specified sorter.

    Parameters
    ----------
    sorter_name_or_class : str or SorterClass
        The sorter to retrieve description from.

    Returns
    -------
    params_description : dict
        Dictionary with parameter description.
    """
```

## `print_sorter_versions` (from `sorterlist.py`)

```python
def print_sorter_versions():
    """ "Prints the versions of the installed sorters."""
```

## `installed_sorters` (from `sorterlist.py`)

```python
def installed_sorters():
    """Lists installed sorters."""
```

## `available_sorters` (from `sorterlist.py`)

```python
def available_sorters():
    """Lists available sorters."""
```

## `archived_sorters` (from `sorterlist.py`)

```python
def archived_sorters():
    """Lists archived sorters."""
```

## Module-level attributes (from `sorterlist.py`)

- `sorter_full_list` — list of every registered sorter class (external first, internal last,
  optionally with `Kilosort4LikeSorter` appended if `spikeinterface_kilosort_components` is
  importable).
- `sorter_dict` — `{s.sorter_name: s for s in sorter_full_list}`.
- `archived_sorter_list = [KlustaSorter, YassSorter]`.
