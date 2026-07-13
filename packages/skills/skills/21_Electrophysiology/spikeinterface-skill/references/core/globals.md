# Globals — globals.py
Source in repo: `spikeinterface/src/spikeinterface/core/globals.py`
Parent index: [INDEX.md](INDEX.md)
Related: [job_tools.md](job_tools.md), [datasets.md](datasets.md)
---

## 6. Globals — `globals.py`

Temp folder:

```python
def get_global_tmp_folder():
def set_global_tmp_folder(folder):
def is_set_global_tmp_folder() -> bool:
def reset_global_tmp_folder():
```
Default base: `Path(tempfile.gettempdir()) / "spikeinterface_cache"`.

Dataset folder:

```python
def get_global_dataset_folder():
def set_global_dataset_folder(folder):
def is_set_global_dataset_folder() -> bool:
```
Default: `Path.home() / "spikeinterface_datasets"`.

Job kwargs (also listed in job_tools.md):

```python
def get_global_job_kwargs():
def set_global_job_kwargs(**job_kwargs):
def reset_global_job_kwargs():
def is_set_global_job_kwargs_set() -> bool:
```

Note: there is no `set_global_zarr_folder` in this file.
