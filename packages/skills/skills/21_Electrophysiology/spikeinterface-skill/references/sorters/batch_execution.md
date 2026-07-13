# Batch and grouped execution

Source in repo: `spikeinterface/src/spikeinterface/sorters/launcher.py`
Parent index: [INDEX.md](INDEX.md)
---

Defined in `src/spikeinterface/sorters/launcher.py`.

Blocking engines: `"loop"`, `"joblib"`, `"processpoolexecutor"`, `"dask"`.
Asynchronous engine: `"slurm"` — returns `None` immediately.

Default engine kwargs (from `_default_engine_kwargs`):

```python
loop=dict(),
joblib=dict(n_jobs=-1, backend="loky"),
processpoolexecutor=dict(max_workers=2, mp_context=None),
dask=dict(client=None),
slurm={"tmp_script_folder": None, "sbatch_args": {"cpus-per-task": 1, "mem": "1G"}},
```

- `return_output=True` is only allowed for engines `"loop"`, `"joblib"`,
  `"processpoolexecutor"`; forces `with_output=True` on each job.
- If `return_output=False`, `with_output` is forced `False`.
- `dask` requires `engine_kwargs["client"]`.
- `slurm` writes one Python script per job into `tmp_script_folder` (temp dir if `None`),
  submits via `sbatch --<key> <value>`, using the internal `_slurm_script` template.
- The keyword `cpus_per_task` is rejected: use `cpus-per-task` (Slurm-style).

`run_sorter_by_property` splits `recording` by `grouping_property`
(`recording.split_by(grouping_property)`), builds one job per group under `folder/<group_key>`,
runs them via `run_sorter_jobs(..., return_output=True)`, aggregates via
`aggregate_units(sorting_list)`, sets `grouping_property` as a property on the resulting
`UnitsAggregationSorting`, and calls `register_recording(recording)` on the aggregate.
