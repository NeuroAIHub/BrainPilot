# SortingAnalyzer class — Part A: init, attrs, extension management
Source in repo: `spikeinterface/src/spikeinterface/core/sortinganalyzer.py`
Parent index: [INDEX.md](INDEX.md)
Related: [sorting_analyzer_constructors.md](sorting_analyzer_constructors.md), [sorting_analyzer_class_b.md](sorting_analyzer_class_b.md), [analyzer_extensions.md](analyzer_extensions.md), [extension_registry.md](extension_registry.md)
---

## 2. SortingAnalyzer class

Constructor is not called directly by users:

```python
class SortingAnalyzer:
    def __init__(
        self,
        sorting: BaseSorting,
        recording: BaseRecording | None = None,
        rec_attributes: dict | None = None,
        format: str | None = None,
        sparsity: ChannelSparsity | None = None,
        return_in_uV: bool = True,
        peak_sign: Literal["both", "neg", "pos"] = "both",
        peak_mode: Literal["extremum", "at_index", "peak_to_peak"] = "extremum",
        backend_options: dict | None = None,
    ):
```

The alternate (classmethod) factory used internally by `create_sorting_analyzer`:

```python
@classmethod
def create(
    cls,
    sorting: BaseSorting,
    recording: BaseRecording,
    format: Literal[
        "memory",
        "binary_folder",
        "zarr",
    ] = "memory",
    folder=None,
    main_channel_indices=None,
    sparsity=None,
    return_scaled=None,
    return_in_uV=True,
    peak_sign="both",
    peak_mode="extremum",
    backend_options=None,
):
```

### 2.1 Attributes / properties

- `sorting: BaseSorting` — set in `__init__`.
- `recording: BaseRecording` — property; returns `self._temporary_recording or self._recording`. Raises `ValueError` if neither present.
- `rec_attributes: dict` — mirror of recording attributes; keys include `"channel_ids"`, `"num_samples"`, `"num_channels"`, `"is_filtered"`, `"probegroup"`, `"properties"`, `"dtype"`.
- `format: str` — `"memory"`, `"binary_folder"`, or `"zarr"`.
- `sparsity: ChannelSparsity | None`.
- `return_in_uV: bool`.
- `return_scaled: bool` — backward-compatible alias, initialized from `return_in_uV`.
- `peak_sign: Literal["both", "neg", "pos"]`.
- `peak_mode: Literal["extremum", "at_index", "peak_to_peak"]`.
- `folder: str | Path | None`.
- `extensions: dict` — mapping `extension_name -> AnalyzerExtension` (populated at load / compute time).
- `channel_ids: np.ndarray` — property (returns `np.array(rec_attributes["channel_ids"])`).
- `unit_ids: np.ndarray` — property (returns `self.sorting.unit_ids`).
- `sampling_frequency: float` — property (returns `self.sorting.get_sampling_frequency()`).
- `main_channel_indices: np.ndarray` — property (lazily computed / restored from sorting property `"main_channel_id"`).

### 2.2 Extension-management methods

```python
def compute(self, input, save=True, extension_params=None, verbose=False, **kwargs) -> "AnalyzerExtension | None":
```
Dispatches to `compute_one_extension` (if `input` is `str`) or `compute_several_extensions` (if `input` is `dict` or `list`).
- `input`: `str | dict | list`.
- `save` (`bool`, default `True`).
- `extension_params` (`dict | None`, default `None`): only used when `input` is a list.
- `verbose` (`bool`, default `False`).
- `**kwargs`: forwarded to `extension.set_params()` (str input) or `job_kwargs`.

```python
def compute_one_extension(self, extension_name, save=True, verbose=False, **kwargs) -> "AnalyzerExtension":
```
- `extension_name` (`str`).
- `save` (`bool`, default `True`).
- `verbose` (`bool`, default `False`).
- `**kwargs`: forwarded to `extension.set_params()` or job kwargs.

```python
def compute_several_extensions(self, extensions, save=True, verbose=False, **job_kwargs):
```
- `extensions` (`dict`): keys are extension names, values are parameter dicts.
- `save` (`bool`, default `True`).
- `verbose` (`bool`, default `False`).
- `**job_kwargs`.

```python
def get_extension(self, extension_name: str):
```
Returns the extension instance, auto-loading from disk if needed. Returns `None` if not computed.

```python
def load_extension(self, extension_name: str):
```
Explicit load from folder/zarr; raises for `format="memory"`.

```python
def load_all_saved_extension(self):
```
Load every saved extension.

```python
def has_extension(self, extension_name: str) -> bool:
```

```python
def delete_extension(self, extension_name) -> None:
```
Remove from memory and from disk.

```python
def get_saved_extension_names(self):
```
Extensions available on disk (only for `binary_folder`/`zarr`; raises otherwise).

```python
def get_loaded_extension_names(self):
```
Currently in `self.extensions`.

```python
def get_computable_extensions(self):
```
Returns `get_available_analyzer_extensions()`, the list of registered names.

```python
def get_default_extension_params(self, extension_name: str) -> dict:
```
Introspects the extension's `_set_params` signature.

```python
def get_metrics_extension_data(self):
```
Returns a concatenated `pandas.DataFrame` of all `BaseMetricExtension` extension data (duplicated columns removed).
