# Utility functions (`sorters/utils/`)

Source in repo: `spikeinterface/src/spikeinterface/sorters/utils/`
Parent index: [INDEX.md](INDEX.md)
---

Re-exported by `spikeinterface.sorters.utils.__init__`:

- `ShellScript` (from `shellscript.py`) — helper class used by MATLAB and CLI-based sorters to
  write and run shell scripts with logging.
- `SpikeSortingError` — `RuntimeError` subclass raised on sorter failure.
- `get_git_commit(git_folder, shorten=True)` — current commit hash of a git repo folder.
- `has_nvidia()` — detect an NVIDIA GPU on the host.
- `get_matlab_shell_name()` — the shell used to invoke MATLAB on the current platform.
- `get_bash_path()` — path to bash on the current platform.
- `has_docker()` / `has_docker_python()` — check the Docker CLI / the `docker` Python package.
- `has_singularity()` / `has_spython()` — check singularity CLI / the `spython` Python package.
- `has_docker_nvidia_installed()` — check for `nvidia-container-toolkit` prerequisites.
- `get_nvidia_docker_dependencies()` — list the NVIDIA-related packages
  `run_sorter_container` looks for when a sorter has `gpu_capability = "nvidia-required"`.

`container_tools.py` (re-exported at the package top level) provides:

- `ContainerClient(mode, container_image, volumes, py_user_base_unix, extra_kwargs)` — abstracts
  starting/stopping Docker and Singularity containers, running commands inside.
- `install_package_in_container(container_client, package_name, installation_mode, ...)` — used
  by `run_sorter_container` to install SpikeInterface / neo / extras into the container.
- `find_recording_folders(rec_dict)` — walks a serialized recording dict to determine which host
  folders to bind-mount into the container.
- `path_to_unix(path)`, `windows_extractor_dict_to_unix(rec_dict)` — path translation helpers
  for Windows hosts running Linux containers.
