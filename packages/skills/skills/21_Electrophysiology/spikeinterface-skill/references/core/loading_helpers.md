# Loading / backend helpers (core.loading + zarrextractors)
Source in repo: `spikeinterface/src/spikeinterface/core/loading.py`, `zarrextractors.py`
Parent index: [INDEX.md](INDEX.md)
Related: [loading.md](loading.md), [sorting_analyzer_constructors.md](sorting_analyzer_constructors.md), [io_extractors.md](io_extractors.md)
---

## 7. Loading / backend helpers

### `load`

Location: `loading.py` (line 15).

```python
def load(
    file_or_folder_or_dict,
    **kwargs,
    # load_extensions=True, backend_options=None
) -> "BaseExtractor | SortingAnalyzer | Motion | Template":
```

Supports (per docstring):
- `Recording` / `Sorting` from: dict, JSON, pickle, binary folder, zarr folder, remote zarr.
- `SortingAnalyzer` from: binary folder, zarr folder, remote zarr folder, WaveformExtractor folder (backward compatibility for v<0.101).
- `Motion` from: folder.
- `Templates` from: zarr folder, dict.

Recognized kwargs:
- `base_folder: str | Path | bool` — used to resolve relative paths for `Recording`/`Sorting`. If `True` and input is a file, the parent directory is used.
- `load_extensions: bool = True` — only used for `SortingAnalyzer`.
- `storage_options: dict | None = None` — for remote `Recording`/`Sorting`.
- `backend_options: dict | None = None` — for `SortingAnalyzer`. Keys: `storage_options`, `saving_options`.

### `get_default_zarr_compressor`

Location: `zarrextractors.py` (line 460).

```python
def get_default_zarr_compressor(clevel: int = 5):
```

Returns a `numcodecs.Blosc` compressor with `cname="zstd"`, `shuffle=Blosc.BITSHUFFLE`. `clevel` in `[1, 9]`, default `5`. Suitable for int16 electrophysiology data.
