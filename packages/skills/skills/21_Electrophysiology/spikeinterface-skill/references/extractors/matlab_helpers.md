# MATLAB helpers
Source in repo: `spikeinterface/src/spikeinterface/extractors/matlabhelpers.py`
Parent index: [INDEX.md](INDEX.md)
---

File: `extractors/matlabhelpers.py`. Utility base class used by `HDSortSortingExtractor`, `WaveClusSortingExtractor`, `WaveClusSnippetsExtractor`.

## `class MatlabHelper`

```python
class MatlabHelper:
    installation_mesg = (
        "To use the MATSortingExtractor install h5py and scipy: " "\n\n pip install h5py scipy\n\n"
    )

    def __init__(self, file_path):
        # loads via scipy.io.matlab.loadmat first (old-style .mat, up to 7.2);
        # falls back to h5py.File(file_path, "r+") for 7.3 HDF5-based .mat files.
        # Sets self._data and self._old_style_mat.

    def __del__(self):
        # closes self._data if HDF5-backed.

    def _getfield(self, fieldname: str):
        # For old-style: recursively drills through nested dicts using "/" as separator.
        # For HDF5-based: returns self._data[fieldname][()].

    @classmethod
    def write_dict_to_mat(cls, mat_file_path, dict_to_write, version="7.3"):
        # version "7.3"  -> uses hdf5storage.write(..., matlab_compatible=True, options="w")
        # 4 < version < "7.3"  -> uses scipy.io.matlab.savemat
        # Requires hdf5storage for v7.3.
```

Module-level capability flags (based on `importlib.util.find_spec`):

- `HAVE_MATLAB_HELPERS`: `True` iff both `h5py` and `scipy.io.matlab` are importable.
- `HAVE_HDF5STORAGE`: `True` iff `hdf5storage` is importable.

There is no free-function `read_matlab_data` / `get_matlab_data` — use `MatlabHelper(...)._getfield(...)` or the format-specific extractors above.
