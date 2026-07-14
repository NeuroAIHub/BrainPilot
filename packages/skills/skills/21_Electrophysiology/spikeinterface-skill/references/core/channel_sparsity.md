# ChannelSparsity + compute_sparsity / estimate_sparsity
Source in repo: `spikeinterface/src/spikeinterface/core/sparsity.py`
Parent index: [INDEX.md](INDEX.md)
Related: [sorting_analyzer_constructors.md](sorting_analyzer_constructors.md), [sorting_analyzer_class_a.md](sorting_analyzer_class_a.md), [analyzer_extensions.md](analyzer_extensions.md), [templates_class.md](templates_class.md)
---

## 3. ChannelSparsity (`sparsity.py`)

### 3.1 Constructor & attributes

```python
class ChannelSparsity:
    def __init__(self, mask, unit_ids, channel_ids):
        ...
```

Attributes set at construction:
- `mask: np.ndarray` — boolean array of shape `(num_units, num_channels)`.
- `unit_ids: np.ndarray`.
- `channel_ids: np.ndarray`.
- `num_units: int` — `unit_ids.size`.
- `num_channels: int` — `channel_ids.size`.
- `max_num_active_channels: int` — `mask.sum(axis=1).max()` (`0` if no units).

Lazy properties:
- `unit_id_to_channel_ids: dict[unit_id -> np.ndarray of channel_ids]`.
- `unit_id_to_channel_indices: dict[unit_id -> np.ndarray of channel indices]`.

### 3.2 Factory classmethods

All return a `ChannelSparsity` object. Each signature is copied verbatim from `sparsity.py`.

```python
@classmethod
def from_unit_id_to_channel_ids(cls, unit_id_to_channel_ids, unit_ids, channel_ids):
```
- `unit_id_to_channel_ids` (`dict`).
- `unit_ids` (`list | np.ndarray`).
- `channel_ids` (`list | np.ndarray`).

```python
@classmethod
def from_best_channels(cls, templates_or_sorting_analyzer, num_channels, peak_sign=None, amplitude_mode="extremum"):
```
- `templates_or_sorting_analyzer` (`Templates | SortingAnalyzer`).
- `num_channels` (`int`).
- `peak_sign` (`"neg" | "pos" | "both" | None`).
- `amplitude_mode` (`"extremum" | "at_index" | "peak_to_peak"`, default `"extremum"`).

```python
@classmethod
def from_closest_channels(cls, templates_or_sorting_analyzer, num_channels, peak_sign=None, peak_mode=None):
```
- `templates_or_sorting_analyzer` (`Templates | SortingAnalyzer`).
- `num_channels` (`int`).
- `peak_sign` (`"neg" | "pos" | "both" | None`).
- `peak_mode` (`"extremum" | "at_index" | "peak_to_peak" | None`).

```python
@classmethod
def from_radius_and_main_channel(cls, unit_ids, channel_ids, main_channel_indices, channel_locations, radius_um):
```
- `unit_ids` (`np.ndarray`).
- `channel_ids` (`np.ndarray`).
- `main_channel_indices` (`np.array`): main channel index per unit.
- `channel_locations` (`np.array`).
- `radius_um` (`float`).

```python
@classmethod
def from_radius(cls, templates_or_sorting_analyzer, radius_um, peak_sign=None, peak_mode=None):
```
- `templates_or_sorting_analyzer` (`Templates | SortingAnalyzer`).
- `radius_um` (`float`).
- `peak_sign` (`"neg" | "pos" | "both" | None`).
- `peak_mode` (`"extremum" | "at_index" | "peak_to_peak" | None`).

```python
@classmethod
def from_snr(
    cls,
    templates_or_sorting_analyzer,
    threshold,
    amplitude_mode=None,
    peak_sign=None,
    noise_levels=None,
):
```
- `templates_or_sorting_analyzer` (`Templates | SortingAnalyzer`).
- `threshold` (`float`): SNR threshold in units of noise levels.
- `amplitude_mode` (`None | "extremum" | "at_index" | "peak_to_peak"`, default `None`).
- `peak_sign` (`"neg" | "pos" | "both" | None`).
- `noise_levels` (`np.ndarray | None`, default `None`): auto-retrieved from analyzer's `noise_levels` extension when input is a `SortingAnalyzer`.

```python
@classmethod
def from_amplitude(cls, templates_or_sorting_analyzer, threshold, amplitude_mode=None, peak_sign=None):
```
- `templates_or_sorting_analyzer` (`Templates | SortingAnalyzer`). Must have scaled templates (`return_in_uV=True` / `is_in_uV=True`).
- `threshold` (`float`): amplitude threshold in uV.
- `amplitude_mode` (`None | "extremum" | "at_index" | "peak_to_peak"`, default `None`).
- `peak_sign` (`"neg" | "pos" | "both" | None`).

```python
@classmethod
def from_energy(cls, sorting_analyzer, threshold):
```
- `sorting_analyzer` (`SortingAnalyzer`): requires the `"waveforms"` and `"noise_levels"` extensions.
- `threshold` (`float`): energy threshold in units of noise levels.

```python
@classmethod
def from_property(cls, sorting, recording, by_property):
```
- `sorting` (`Sorting`): must have the property.
- `recording` (`Recording`): must have the property.
- `by_property` (`str`).

```python
@classmethod
def create_dense(cls, sorting_analyzer):
```
- `sorting_analyzer` (`SortingAnalyzer`): produces an all-True mask.

Note: `from_ptp` and `from_peak_channel` do not exist as separate classmethods in this file; peak-to-peak behaviour is available via `amplitude_mode="peak_to_peak"` on the amplitude-based factories.

### 3.3 Serialization (`to_dict` / `from_dict`)

```python
def to_dict(self):
```
Returns `{"unit_id_to_channel_ids": {...}, "channel_ids": [...], "unit_ids": [...]}`.

```python
@classmethod
def from_dict(cls, dictionary: dict):
```
Inverse of `to_dict()` (handles str-key units).

### 3.4 Instance methods

```python
def sparsify_waveforms(self, waveforms: np.ndarray, unit_id: str | int) -> np.ndarray:
def densify_waveforms(self, waveforms: np.ndarray, unit_id: str | int) -> np.ndarray:
def sparsify_templates(self, templates_array: np.ndarray) -> np.ndarray:
def densify_templates(self, templates_array: np.ndarray) -> np.ndarray:
def are_waveforms_dense(self, waveforms: np.ndarray) -> bool:
def are_waveforms_sparse(self, waveforms: np.ndarray, unit_id: str | int) -> bool:
```

Note: task-requested names `get_unit_channels` and `are_units_sparse_of_same_size` are not defined in this file. To get channels for a unit use `sparsity.unit_id_to_channel_ids[unit_id]` (or `unit_id_to_channel_indices`). To check uniform sparsity size, compare `mask.sum(axis=1)`.

---

## 4. `compute_sparsity` / `estimate_sparsity`

### `compute_sparsity`

Location: `sparsity.py` line 654.

```python
def compute_sparsity(
    templates_or_sorting_analyzer: "Templates | SortingAnalyzer",
    noise_levels: np.ndarray | None = None,
    method: Literal[
        "radius", "best_channels", "closest_channels", "snr", "amplitude", "energy", "by_property"
    ] = "radius",
    peak_sign: None | Literal["neg", "pos", "both"] = None,
    amplitude_mode: None | Literal["extremum", "at_index", "peak_to_peak"] = None,
    num_channels: int | None = 5,
    radius_um: float | None = 100.0,
    threshold: float | None = 5,
    by_property: str | None = None,
) -> ChannelSparsity:
```

Parameters:
- `templates_or_sorting_analyzer` (`Templates | SortingAnalyzer`).
- `noise_levels` (`np.ndarray | None`, default `None`): required for `"snr"` when input is a `Templates`; auto-retrieved when input is a `SortingAnalyzer` with `noise_levels` extension.
- `method`: one of `"radius"` (default), `"best_channels"`, `"closest_channels"`, `"snr"`, `"amplitude"`, `"energy"`, `"by_property"`.
- `peak_sign` (`None | "neg" | "pos" | "both"`, default `None`).
- `amplitude_mode` (`None | "extremum" | "at_index" | "peak_to_peak"`, default `None`).
- `num_channels` (`int | None`, default `5`).
- `radius_um` (`float | None`, default `100.0`).
- `threshold` (`float | None`, default `5`).
- `by_property` (`str | None`, default `None`).

Method → required parameter mapping (as enforced in-source):
- `"best_channels"` and `"closest_channels"`: need `num_channels`.
- `"radius"`: needs `radius_um`.
- `"snr"`: needs `threshold`; needs `noise_levels` (or the `noise_levels` extension on the analyzer).
- `"amplitude"`: needs `threshold`; templates/analyzer must be in uV.
- `"energy"`: needs `threshold`; requires a `SortingAnalyzer` (needs `waveforms` and `noise_levels` extensions).
- `"by_property"`: needs `by_property`; requires a `SortingAnalyzer`.

When called with a `SortingAnalyzer`, `peak_sign` and `amplitude_mode` must be `None` (they are inherited from the analyzer).

### `estimate_sparsity`

Location: `sparsity.py` line 764.

```python
def estimate_sparsity(
    sorting: BaseSorting,
    recording: BaseRecording,
    num_spikes_for_sparsity: int = 100,
    ms_before: float = 1.0,
    ms_after: float = 2.5,
    method: Literal["radius", "best_channels", "closest_channels", "amplitude", "snr", "by_property"] = "radius",
    peak_sign: Literal["neg", "pos", "both"] = "both",
    radius_um: float = 100.0,
    num_channels: int = 5,
    threshold: float | None = 5,
    amplitude_mode: Literal["extremum", "peak_to_peak"] = "extremum",
    by_property: str | None = None,
    noise_levels: np.ndarray | list | None = None,
    main_channel_indices: np.ndarray | list | None = None,
    **job_kwargs,
):
```

Parameters:
- `sorting` (`BaseSorting`).
- `recording` (`BaseRecording`).
- `num_spikes_for_sparsity` (`int`, default `100`): spikes per unit to compute sparsity.
- `ms_before` (`float`, default `1.0`).
- `ms_after` (`float`, default `2.5`).
- `method`: one of `"radius"` (default), `"best_channels"`, `"closest_channels"`, `"amplitude"`, `"snr"`, `"by_property"`.
- `peak_sign` (`"neg" | "pos" | "both"`, default `"both"`).
- `radius_um` (`float`, default `100.0`).
- `num_channels` (`int`, default `5`).
- `threshold` (`float | None`, default `5`).
- `amplitude_mode` (`"extremum" | "peak_to_peak"`, default `"extremum"`).
- `by_property` (`str | None`, default `None`).
- `noise_levels` (`np.ndarray | list | None`, default `None`): required for `"snr"`.
- `main_channel_indices` (`np.ndarray | list | None`, default `None`): if given and `method="radius"`, skips template estimation.
- `**job_kwargs`: standard job kwargs.

The `"energy"` method is not supported here (it requires a `SortingAnalyzer`).
