# NWB (HDF5 / Zarr) recording extractors
Source in repo: `spikeinterface/src/spikeinterface/extractors/nwbextractors.py`
Parent index: [INDEX.md](INDEX.md)
---

Source: `extractors/nwbextractors.py`. Reads NWB files with either `pynwb` or a low-level `h5py`/`zarr` reader. Requires one of: `pynwb`, `h5py`, `hdmf-zarr`, plus optionally `fsspec` / `remfile` for streaming.

Streaming modes: `stream_mode ∈ {"fsspec", "remfile", "zarr", None}`.

## `NwbRecordingExtractor` — reads an `ElectricalSeries`

```python
class NwbRecordingExtractor(BaseRecording):
    installation_mesg = "To use the Nwb extractors, install pynwb: \n\n pip install pynwb\n\n"

    def __init__(
        self,
        file_path: str | Path | None = None,   # provide either this or `file`
        load_time_vector: bool = False,
        samples_for_rate_estimation: int = 1_000,
        stream_mode: Optional[Literal["fsspec", "remfile", "zarr"]] = None,
        stream_cache_path: str | Path | None = None,
        electrical_series_path: str | None = None,
        load_channel_properties: bool = True,
        *,
        file: BinaryIO | None = None,          # file-like alternative to file_path
        cache: bool = False,
        storage_options: dict | None = None,   # only used with stream_mode="zarr"
        use_pynwb: bool = False,               # default: use direct h5py / zarr reads
    ): ...

    @staticmethod
    def fetch_available_electrical_series_paths(
        file_path: str | Path,
        stream_mode: Optional[Literal["fsspec", "remfile", "zarr"]] = None,
        storage_options: dict | None = None,
    ) -> list[str]: ...

read_nwb_recording = define_function_from_class(source_class=NwbRecordingExtractor, name="read_nwb_recording")
```

Return type: `NwbRecordingExtractor`.

Examples (from the class docstring):

```python
# Local file
from spikeinterface.extractors.nwbextractors import NwbRecordingExtractor
rec = NwbRecordingExtractor(filepath)

# s3 URL from the DANDI Archive
from dandi.dandiapi import DandiAPIClient

dandiset_id = "001054"
filepath = "sub-Dory/sub-Dory_ses-2020-09-14-004_ecephys.nwb"
with DandiAPIClient() as client:
    asset = client.get_dandiset(dandiset_id).get_asset_by_path(filepath)
    s3_url = asset.get_content_url(follow_redirects=1, strip_query=True)
rec = NwbRecordingExtractor(s3_url, stream_mode="remfile")
```

## `NwbSortingExtractor` — reads a Units table  **[Part B]**

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
    ): ...

    @staticmethod
    def fetch_available_units_tables(
        file_path: str | Path,
        stream_mode: Optional[Literal["fsspec", "remfile", "zarr"]] = None,
        storage_options: dict | None = None,
    ) -> list[str]: ...

read_nwb_sorting = define_function_from_class(source_class=NwbSortingExtractor, name="read_nwb_sorting")
```

## `NwbTimeSeriesExtractor` — reads a generic `TimeSeries`

```python
class NwbTimeSeriesExtractor(BaseRecording):
    installation_mesg = "To use the Nwb extractors, install pynwb: \n\n pip install pynwb\n\n"

    def __init__(
        self,
        file_path: str | Path | None = None,
        timeseries_path: str | None = None,
        load_time_vector: bool = False,
        samples_for_rate_estimation: int = 1_000,
        stream_mode: Optional[Literal["fsspec", "remfile", "zarr"]] = None,
        stream_cache_path: str | Path | None = None,
        *,
        file: BinaryIO | None = None,
        cache: bool = False,
        storage_options: dict | None = None,
        use_pynwb: bool = False,
    ): ...

    @staticmethod
    def fetch_available_timeseries_paths(
        file_path: str | Path,
        stream_mode: Optional[Literal["fsspec", "remfile", "zarr"]] = None,
        storage_options: dict | None = None,
    ) -> list[str]: ...

read_nwb_timeseries = define_function_from_class(source_class=NwbTimeSeriesExtractor, name="read_nwb_timeseries")
```

Return type: `NwbTimeSeriesExtractor`.

## Convenience combined reader

```python
def read_nwb(file_path, load_recording=True, load_sorting=False, electrical_series_path=None):
    """
    Returns
    -------
    Single RecordingExtractor / SortingExtractor, or a tuple (recording, sorting)
    depending on `load_recording` / `load_sorting`.
    """
```

## Low-level helpers (also in `nwbextractors.py`)

```python
def read_file_from_backend(
    *,
    file_path: str | Path | None,
    file: BinaryIO | None = None,
    stream_mode: Literal["ffspec", "remfile"] | None = None,   # NOTE: typo "ffspec" in the annotation;
                                                               # the runtime check uses "fsspec". "zarr" is
                                                               # also accepted at runtime.
    cache: bool = False,
    stream_cache_path: str | Path | None = None,
    storage_options: dict | None = None,
): ...

def read_nwbfile(
    *,
    backend: Literal["hdf5", "zarr"],
    file_path: str | Path | None,
    file: BinaryIO | None = None,
    stream_mode: Literal["ffspec", "remfile", "zarr"] | None = None,   # same typo caveat
    cache: bool = False,
    stream_cache_path: str | Path | None = None,
    storage_options: dict | None = None,
) -> "NWBFile": ...
```
