# Motion — motion.py
Source in repo: `spikeinterface/src/spikeinterface/core/motion.py`
Parent index: [INDEX.md](INDEX.md)
Related: [loading.md](loading.md), [core_tools.md](core_tools.md)
---

## 10. Motion — `motion.py`

```python
class Motion:
    """
    Motion of the tissue relative the probe.

    Parameters
    ----------
    displacement : numpy array 2d or list of
        Motion estimate in um. List = one per segment; shape (temporal bins, spatial bins).
        spatial bins = 1 for rigid.
    temporal_bins_s : numpy.array 1d or list of
        Temporal bin centers.
    spatial_bins_um : numpy.array 1d
        Window centers. spatial_bins_um.shape[0] == displacement.shape[1]; 1 if rigid.
    direction : str, default: 'y'
        Direction of the motion.
    interpolation_method : str
        See scipy.interpolate.RegularGridInterpolator.
    """
    def __init__(self, displacement, temporal_bins_s, spatial_bins_um, direction="y", interpolation_method="linear"):
```

### Public attributes after `__init__`

- `self.displacement: list[np.ndarray]` (always a list — a passed 2-D array is wrapped as `[displacement]`).
- `self.temporal_bins_s: list[np.ndarray]` (wrapped identically).
- `self.spatial_bins_um: np.ndarray` (required to be an ndarray).
- `self.num_segments: int` — `len(self.displacement)`.
- `self.interpolators: list[RegularGridInterpolator] | None` — lazily built by `make_interpolators()`.
- `self.interpolation_method: str`.
- `self.direction: str` (`"x"`, `"y"`, or `"z"`).
- `self.dim: int` — `["x", "y", "z"].index(direction)`.
- `self.temporal_bin_edges_s: list[np.ndarray]` — filled via `ensure_time_bin_edges`.
- After `make_interpolators()`: `self.temporal_bounds: list[tuple]`, `self.spatial_bounds: tuple[float, float]`.

Note: `Motion` does NOT expose a `non_rigid_windows` attribute — non-rigid vs rigid is inferred from `spatial_bins_um.shape[0]` (1 = rigid).

### Methods

```python
def check_properties(self):
def __repr__(self):
def make_interpolators(self):
def get_displacement_at_time_and_depth(self, times_s, locations_um, segment_index=None, grid=False):
def to_dict(self):
@staticmethod
def from_dict(d):
def save(self, folder, overwrite=False):
@classmethod
def load(cls, folder):
def __eq__(self, other):
def copy(self):
def get_boundaries(self):
```

`to_dict()` returns:
```python
dict(
    object="Motion",
    displacement=self.displacement,
    temporal_bins_s=self.temporal_bins_s,
    spatial_bins_um=self.spatial_bins_um,
    interpolation_method=self.interpolation_method,
    direction=self.direction,
)
```

`save(folder, overwrite=False)` layout:
- `spikeinterface_info.json` — `{version, dev_mode, object: "Motion", num_segments, direction, interpolation_method}`
- `spatial_bins_um.npy`
- per segment: `displacement_seg{i}.npy`, `temporal_bins_s_seg{i}.npy`

`load(folder)` reconstructs from the same layout.

`get_displacement_at_time_and_depth(times_s, locations_um, segment_index=None, grid=False)`:
- `locations_um` may be 1-D (already a vector along `self.dim`) or 2-D (2 or 3 spatial dims; the `self.dim` column is used).
- `grid=False`: returns a displacement per input point with shape `times_s.shape`.
- `grid=True`: returns a 2-D grid of shape `(locations_um.size, times_s.size)`.

### Module-level helpers

```python
def ensure_time_bins(time_bin_centers_s=None, time_bin_edges_s=None):
def ensure_time_bin_edges(time_bin_centers_s=None, time_bin_edges_s=None):
```
Multi-segment aware (accept array or `list[array]`). `ensure_time_bin_edges` returns just the edges. `ensure_time_bins` returns `(time_bin_centers_s, time_bin_edges_s)` — reconstructing whichever one was missing (centers → midpoints between edges; edges → midpoints + first/last centers as endpoints).

### `direction` allowed values

`direction` must be one of `"x"`, `"y"`, `"z"` — this maps to `self.dim = ["x", "y", "z"].index(direction)` and drives which spatial column of `locations_um` is used in `get_displacement_at_time_and_depth`. There is no other accepted value.

### Example (round-trip save/load)

```python
import numpy as np
from spikeinterface.core.motion import Motion

# rigid, single segment: 1 spatial bin
displacement = np.zeros((100, 1))         # (temporal_bins, spatial_bins)
temporal_bins_s = np.linspace(0, 10, 100) # 1D
spatial_bins_um = np.array([0.0])         # 1 => rigid
motion = Motion(displacement, temporal_bins_s, spatial_bins_um, direction="y")

# evaluate
d = motion.get_displacement_at_time_and_depth(
    times_s=np.array([1.0, 2.0]),
    locations_um=np.array([10.0, 20.0]),
)

# save / load
motion.save("./my_motion", overwrite=True)
motion2 = Motion.load("./my_motion")
assert motion == motion2
```
