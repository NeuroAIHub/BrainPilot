# SpikeInterface `sorters` module — overview

Source in repo: `spikeinterface/src/spikeinterface/sorters/__init__.py`
Parent index: [INDEX.md](INDEX.md)
---

Reference for `spikeinterface.sorters`, the module responsible for running spike sorting algorithms
(internal or wrapped external ones), managing default parameters, dispatching to containers, and
launching many jobs at once.

Source: `src/spikeinterface/sorters/`

See [helper_signatures.md](helper_signatures.md) for verbatim signatures of every top-level
helper exposed from `spikeinterface.sorters.__init__.py`.

## Quick start

```python
from spikeinterface.sorters import (
    run_sorter,
    get_default_sorter_params,
    get_sorter_params_description,
    available_sorters,
    installed_sorters,
    print_sorter_versions,
    read_sorter_folder,
    run_sorter_by_property,
    run_sorter_jobs,
)

print(available_sorters())
print(installed_sorters())
print_sorter_versions()

params = get_default_sorter_params("spykingcircus2")
desc   = get_sorter_params_description("spykingcircus2")

sorting = run_sorter(
    sorter_name="tridesclous2",
    recording=recording,
    folder="/tmp/tdc2_out",
    remove_existing_folder=True,
    verbose=True,
    detect_threshold=6.0,
)

sorting = run_sorter(
    sorter_name="kilosort4",
    recording=recording,
    folder="/tmp/ks4_out",
    docker_image=True,
    verbose=True,
)

sorting = read_sorter_folder("/tmp/tdc2_out")

sorting_by_group = run_sorter_by_property(
    sorter_name="tridesclous2",
    recording=recording,
    grouping_property="group",
    folder="/tmp/sort_by_group",
    engine="joblib",
    engine_kwargs={"n_jobs": 4},
)

job_list = [
    dict(sorter_name="tridesclous2", recording=rec_a, folder="/tmp/a"),
    dict(sorter_name="spykingcircus2", recording=rec_b, folder="/tmp/b"),
]
sortings = run_sorter_jobs(job_list, engine="loop", return_output=True)
```

`run_sorter` docstring example:

```python
>>> sorting = run_sorter("tridesclous", recording)
```

Note: there is no `run_sorters` function in the current API. Batch execution is exposed as
`run_sorter_jobs`.

---

## Public API surface

`src/spikeinterface/sorters/__init__.py` re-exports:

```python
from .basesorter import BaseSorter
from .sorterlist import *
from .container_tools import ContainerClient, install_package_in_container
from .runsorter import run_sorter, run_sorter_local, run_sorter_container, read_sorter_folder
from .launcher import run_sorter_jobs, run_sorter_by_property
```

Names brought in through `sorterlist` (star import):

- Functions: `available_sorters`, `archived_sorters`, `installed_sorters`,
  `print_sorter_versions`, `get_default_sorter_params`, `get_sorter_params_description`,
  `get_sorter_description`.
- Module-level lists / dicts: `sorter_full_list`, `archived_sorter_list`, `sorter_dict`.
- Every concrete sorter class listed in the supported sorter classes section (see leaf files
  under this index).

Names in the original task prompt that do NOT exist in this repo:

- `run_sorters` — not defined; use `run_sorter_jobs`.
- `medicine` — no `MedicineSorter` or `medicine` file exists under `sorters/`.
- `kilosort1` — the wrapper for the original Kilosort is called `kilosort` (class
  `KilosortSorter`), not `kilosort1`.
