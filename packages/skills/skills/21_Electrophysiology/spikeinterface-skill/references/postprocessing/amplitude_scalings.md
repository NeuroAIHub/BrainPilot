# amplitude_scalings — ComputeAmplitudeScalings
Source in repo: `spikeinterface/src/spikeinterface/postprocessing/amplitude_scalings.py`
Parent index: [INDEX.md](INDEX.md)
---

## amplitude_scalings — ComputeAmplitudeScalings

- extension name: `"amplitude_scalings"`
- Compute class: `ComputeAmplitudeScalings` (subclasses `BaseSpikeVectorExtension`)
- depends on: `["templates"]`
- exposes `nodepipeline_variables = ["amplitude_scalings", "collision_mask"]`
- Source: `src/spikeinterface/postprocessing/amplitude_scalings.py`

Parameters (from `_set_params`):

```python
def _set_params(
    self,
    sparsity=None,
    max_dense_channels=16,
    ms_before=None,
    ms_after=None,
    handle_collisions=True,
    delta_collision_ms=2,
):
```

- `sparsity`: `ChannelSparsity | None`, default `None`. If waveforms are dense and the recording has more than `max_dense_channels`, a sparsity is required.
- `max_dense_channels`: `int`, default `16`. Guardrail against running dense on many-channel recordings. Set to `None` (with `sparsity=None`) to force dense.
- `ms_before`: `float | None`, default `None` (defaults to the analyzer's `ms_before`).
- `ms_after`: `float | None`, default `None` (defaults to the analyzer's `ms_after`).
- `handle_collisions`: `bool`, default `True`. If `True`, colliding spikes (within `delta_collision_ms` and with overlapping sparsity) are jointly fit with `sklearn.linear_model.LinearRegression(positive=True, fit_intercept=True)`. Otherwise each spike is fit independently with `scipy.stats.linregress`.
- `delta_collision_ms`: `float`, default `2`. Maximum time window (ms) for colliding spikes.

Public convenience function:
```python
compute_amplitude_scalings = ComputeAmplitudeScalings.function_factory()
```
The standalone function accepts a `SortingAnalyzer` positional argument plus the same keyword arguments as `_set_params` above (plus `**job_kwargs`).

Recommended usage:

```python
from spikeinterface import create_sorting_analyzer
from spikeinterface.postprocessing import compute_amplitude_scalings

analyzer = create_sorting_analyzer(sorting, recording, sparse=True)
analyzer.compute(["random_spikes", "waveforms", "templates"])
analyzer.compute(
    "amplitude_scalings",
    handle_collisions=True,
    delta_collision_ms=2,
    max_dense_channels=16,
)

ext = analyzer.get_extension("amplitude_scalings")
scalings, collision_mask = ext.get_data()  # or ext.get_data(outputs="by_unit")
```

Related debugging helper (private): `_plot_collisions(sorting_analyzer, sparsity=None, num_collisions=None)`.
