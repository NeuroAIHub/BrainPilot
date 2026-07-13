# isi_histograms — ComputeISIHistograms
Source in repo: `spikeinterface/src/spikeinterface/postprocessing/isi.py`
Parent index: [INDEX.md](INDEX.md)
---

## isi_histograms — ComputeISIHistograms

- extension name: `"isi_histograms"`
- Compute class: `ComputeISIHistograms(AnalyzerExtension)`
- depends on: `[]`, `need_recording=False`, `use_nodepipeline=False`, `need_job_kwargs=False`
- Source: `src/spikeinterface/postprocessing/isi.py`

Parameters (from `_set_params`):

```python
def _set_params(self, window_ms: float = 50.0, bin_ms: float = 1.0, method: str = "auto"):
```

- `window_ms`: `float`, default `50.0`.
- `bin_ms`: `float`, default `1.0`.
- `method`: `"auto" | "numpy" | "numba"`, default `"auto"` (currently `"auto"` picks `"numpy"` because it is faster for ISI).

Return: `isi_histograms.shape == (num_units, num_bins)`, `bins` are bin edges in ms.

Public convenience function:
```python
compute_isi_histograms = ComputeISIHistograms.function_factory()
```

Low-level implementations (also exposed by `postprocessing/__init__.py`):
```python
def compute_isi_histograms_numpy(sorting, window_ms: float = 50.0, bin_ms: float = 1.0)
def compute_isi_histograms_numba(sorting, window_ms: float = 50.0, bin_ms: float = 1.0)
```

Recommended usage:

```python
analyzer.compute("isi_histograms", window_ms=100.0, bin_ms=1.0)
isi, bins = analyzer.get_extension("isi_histograms").get_data()
```
