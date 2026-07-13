# Templates dataclass (core/template.py)
Source in repo: `spikeinterface/src/spikeinterface/core/template.py`
Parent index: [INDEX.md](INDEX.md)
Related: [channel_sparsity.md](channel_sparsity.md), [analyzer_extensions.md](analyzer_extensions.md), [loading_helpers.md](loading_helpers.md)
---

## 6. `Templates` dataclass (`core/template.py`)

```python
@dataclass
class Templates:
    templates_array: np.ndarray
    sampling_frequency: float
    nbefore: int
    is_in_uV: bool = True

    sparsity_mask: np.ndarray = None
    channel_ids: np.ndarray = None
    unit_ids: np.ndarray = None

    probe: Probe = None

    check_for_consistent_sparsity: bool = True

    num_units: int = field(init=False)
    num_samples: int = field(init=False)
    num_channels: int = field(init=False)

    nafter: int = field(init=False)
    ms_before: float = field(init=False)
    ms_after: float = field(init=False)
    sparsity: ChannelSparsity = field(init=False, default=None)
```

Constructor fields (init parameters):
- `templates_array: np.ndarray` — shape `(num_units, num_samples, num_channels_or_active)`.
- `sampling_frequency: float`.
- `nbefore: int`.
- `is_in_uV: bool = True`.
- `sparsity_mask: np.ndarray = None`.
- `channel_ids: np.ndarray = None`.
- `unit_ids: np.ndarray = None`.
- `probe: probeinterface.Probe = None`.
- `check_for_consistent_sparsity: bool = True`.

Auto-computed post-init attributes: `num_units`, `num_samples`, `num_channels`, `nafter`, `ms_before`, `ms_after`, `sparsity`.

Notes:
- The task specification listed an `is_scaled` attribute — the source uses `is_in_uV`. For backward compatibility, `from_zarr_group` reads `is_scaled` if present.
- There is no `ms_before` / `ms_after` constructor argument (they are derived from `nbefore` + `nafter`).

Public methods:
- `select_units(unit_ids) -> "Templates"`.
- `select_channels(channel_ids) -> "Templates"` — asserts dense templates.
- `to_sparse(sparsity) -> Templates` — `sparsity` may be a `ChannelSparsity` or a boolean mask.
- `to_dense() -> Templates`.
- `get_one_template_dense(unit_index) -> np.ndarray`.
- `get_dense_templates() -> np.ndarray`.
- `are_templates_sparse() -> bool`.
- `to_dict() -> dict`.
- `Templates.from_dict(data) -> Templates` (classmethod).
- `add_templates_to_zarr_group(zarr_group)`.
- `to_zarr(folder_path)`.
- `Templates.from_zarr_group(zarr_group) -> Templates` (classmethod).
- `Templates.from_zarr(folder_path) -> Templates` (staticmethod).
- `to_json() -> str`.
- `Templates.from_json(json_str) -> Templates` (classmethod).
- `get_channel_locations() -> np.ndarray` — requires `probe`.
- `get_main_channels(peak_sign="both", peak_mode="extremum", outputs="index", with_dict=False)` — `peak_sign: "neg" | "pos" | "both"`, `peak_mode: "extremum" | "at_index" | "peak_to_peak"`, `outputs: "index" | "id"`.
