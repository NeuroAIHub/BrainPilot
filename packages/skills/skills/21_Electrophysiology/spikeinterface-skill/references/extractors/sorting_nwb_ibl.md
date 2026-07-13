# Sorting extractors (NWB/IBL)
Source in repo: `spikeinterface/src/spikeinterface/extractors/` (nwbextractors.py, iblextractors.py)
Parent index: [INDEX.md](INDEX.md)
---

## `read_nwb_sorting(file_path, electrical_series_path=None, sampling_frequency=None, samples_for_rate_estimation=1_000, stream_mode=None, stream_cache_path=None, load_unit_properties=True, unit_table_path="units", *, t_start=None, cache=False, storage_options=None, use_pynwb=False)`

Class: `NwbSortingExtractor` in `nwbextractors.py`. Reads spike times from an NWB `Units` table (either the main `nwbfile.units` or one in a processing module). Uses direct h5py/zarr access by default; PyNWB is used only if `use_pynwb=True`.

Full signature (verbatim):

```python
class NwbSortingExtractor(BaseSorting):
    installation_mesg = "To use the Nwb extractors, install pynwb: \n\n pip install pynwb\n\n"

    def __init__(
        self,
        file_path: str | Path,
        electrical_series_path: str | None = None,
        sampling_frequency: float | None = None,
        samples_for_rate_estimation: int = 1_000,
        stream_mode: str | None = None,
        stream_cache_path: str | Path | None = None,
        load_unit_properties: bool = True,
        unit_table_path: str = "units",
        *,
        t_start: float | None = None,
        cache: bool = False,
        storage_options: dict | None = None,
        use_pynwb: bool = False,
    ):
```

- `stream_mode`: `"fsspec" | "remfile" | "zarr" | None`.
- `unit_table_path`: path within the NWB file (default `"units"`).
- `sampling_frequency` and `t_start`: if either is missing they are looked up from the referenced `ElectricalSeries` (`electrical_series_path`); either the `starting_time` or the first entry of `timestamps` is used as `t_start`. Frame conversion is `frames = (times - t_start) * sampling_frequency`.
- `samples_for_rate_estimation`: number of timestamps used to estimate the rate when `rate` is missing on the `ElectricalSeries`.

Also provides:

```python
@staticmethod
def fetch_available_units_tables(
    file_path: str | Path,
    stream_mode: Optional[Literal["fsspec", "remfile", "zarr"]] = None,
    storage_options: dict | None = None,
) -> list[str]:
```

## `read_ibl_sorting(pid, good_clusters_only=False, load_unit_properties=True, one=None, **kwargs)`

Class: `IblSortingExtractor` in `iblextractors.py`. Uses `brainbox.io.one.SpikeSortingLoader` on an ONE-API instance.

Full signature (verbatim):

```python
class IblSortingExtractor(BaseSorting):
    installation_mesg = "IBL extractors require ibllib as a dependency. To install, run: \n\n pip install ibllib\n\n"

    def __init__(
        self, pid: str, good_clusters_only: bool = False, load_unit_properties: bool = True, one=None, **kwargs
    ):
```

- `pid`: probe insertion UUID in Alyx.
- `one`: ONE.api instance, or a dict of ONE.api kwargs, or `None` (uses `IblRecordingExtractor._get_default_one()` — the openalyx public server).
- `good_clusters_only`: keep only clusters whose `label == 1`.
- `**kwargs`: forwarded to `SpikeSortingLoader.load_spike_sorting` (e.g. `revision=`).

Unit properties: all cluster columns, with `acronym` renamed to `brain_area`.
