# Template matching — overview

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/matching/`
Parent index: [../INDEX.md](../INDEX.md)

---

## Template matching

Module: `spikeinterface.sortingcomponents.matching`. The `__init__.py`
only re-exports `find_spikes_from_templates` (the registry is imported
lazily inside `main.py` via `from .method_list import *`).

### `find_spikes_from_templates`

```python
from spikeinterface.sortingcomponents.matching import find_spikes_from_templates

find_spikes_from_templates(
    recording,
    templates,
    method=None,
    method_kwargs={},
    extra_outputs=False,
    pipeline_kwargs=None,
    verbose=False,
    job_kwargs=None,
    **old_kwargs,
) -> np.ndarray | tuple[np.ndarray, dict]
```

- `templates` must be a `spikeinterface.core.Templates` object (asserted in
  `BaseTemplateMatching.__init__`).
- `method` — key of `matching_methods` (or embedded in `method_kwargs`).
- If `extra_outputs=True`, returns `(spikes, outputs)` where
  `outputs = method_class.get_extra_outputs()`.
- If `method_class.need_noise_levels` is `True`, `method_kwargs` must
  contain `"noise_levels"`.
- Base output dtype (`_base_matching_dtype`):
  `("sample_index", "int64"), ("channel_index", "int64"),
  ("cluster_index", "int64"), ("amplitude", "float64"),
  ("segment_index", "int64")`.

### Method registry (`matching/method_list.py::matching_methods`)

Exact registry keys:

- `"nearest"` → `NearestTemplatesPeeler`
- `"nearest-svd"` → `NearestTemplatesSVDPeeler`
- `"tdc-peeler"` → `TridesclousPeeler`
- `"circus-omp"` → `CircusOMPPeeler`
- `"wobble"` → `WobbleMatch`
- `"kilosort-matching"` → external
  `spikeinterface_kilosort_components.kilosort_matching.KiloSortMatching`
  (registered only when importable).

There is **no** `"naive"`, `"tridesclous"`, `"circus"` nor `"circus-omp-svd"`
method in the current codebase.

Every peeler inherits from
`spikeinterface.sortingcomponents.matching.base.BaseTemplateMatching`
(itself a `PeakDetector`).
