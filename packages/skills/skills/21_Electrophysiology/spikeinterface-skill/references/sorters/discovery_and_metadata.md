# Discovery and metadata helpers

Source in repo: `spikeinterface/src/spikeinterface/sorters/sorterlist.py`
Parent index: [INDEX.md](INDEX.md)
---

Defined in `src/spikeinterface/sorters/sorterlist.py`.

- `available_sorters()` — sorted list of `sorter_name` keys registered in `sorter_full_list`.
- `installed_sorters()` — sorted list of `sorter_name` values for sorters whose
  `is_installed()` returns True.
- `archived_sorters()` — sorted `sorter_name` values in `archived_sorter_list` (`klusta`, `yass`).
- `get_default_sorter_params(sorter_name_or_class)` — calls `SorterClass.default_params()`, which
  returns a deep-copied `_default_params` (augmented with global job kwargs when
  `requires_binary_data` is True).
- `get_sorter_params_description(sorter_name_or_class)` — wraps
  `SorterClass.params_description()`.
- `get_sorter_description(sorter_name_or_class)` — returns the class attribute
  `sorter_description`.
- `print_sorter_versions()` — prints `"<name>: <version>"` per installed sorter.
