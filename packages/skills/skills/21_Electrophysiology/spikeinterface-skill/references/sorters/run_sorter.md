# Running a sorter

Source in repo: `spikeinterface/src/spikeinterface/sorters/runsorter.py`
Parent index: [INDEX.md](INDEX.md)
---

Defined in `src/spikeinterface/sorters/runsorter.py`. See the signatures section in
[overview.md](overview.md) for exact parameters. Notes:

- `run_sorter` returns `BaseSorting | dict[BaseSorting] | None`. Archived sorters raise
  `ValueError("The sorter {sorter_name} is archived and no longer supported. ...")`.
- Dispatch: dict `recording` -> per-key calls; docker/singularity truthy -> `run_sorter_container`;
  else `run_sorter_local`.
- `run_sorter_local` follows the class lifecycle:
  `initialize_folder` -> `set_params_to_folder` -> `setup_recording` -> `run_from_folder` ->
  `get_result_from_folder(register_recording=True, sorting_info=True)`.
- Passing a `list` as `recording` to `run_sorter_local` raises: use `run_sorter_jobs(...)`.
- `run_sorter_container`:
  - Chooses image from `SORTER_DOCKER_MAP` if `container_image` is None.
  - Serializes recording to `in_container_recording.{json,pickle}`, params to
    `in_container_params.json`, and writes `in_container_sorter_script.py`.
  - Mounts recording folders read-only and the parent folder read-write.
  - GPU: reads `SorterClass.use_gpu(sorter_params)` and `SorterClass.gpu_capability`
    (`"nvidia-required"` or `"nvidia-optional"`).
- `read_sorter_folder` reads `spikeinterface_log.json`, looks up
  `sorter_dict[log["sorter_name"]]`, and calls `SorterClass.get_result_from_folder(folder, ...)`.
