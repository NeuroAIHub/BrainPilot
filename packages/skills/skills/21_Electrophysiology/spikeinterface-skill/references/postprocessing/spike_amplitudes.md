# spike_amplitudes — ComputeSpikeAmplitudes
Source in repo: `spikeinterface/src/spikeinterface/postprocessing/spike_amplitudes.py`
Parent index: [INDEX.md](INDEX.md)
---

## spike_amplitudes — ComputeSpikeAmplitudes

- extension name: `"spike_amplitudes"`
- Compute class: `ComputeSpikeAmplitudes(BaseSpikeVectorExtension)`
- depends on: `["templates"]`
- exposes `nodepipeline_variables = ["amplitudes"]`
- `need_backward_compatibility_on_load = True`
- Source: `src/spikeinterface/postprocessing/spike_amplitudes.py`

Parameters (from `_set_params`):

```python
def _set_params(self):
    return super()._set_params()
```

The extension takes **no user-facing parameters** in the current codebase — the historical `peak_sign="neg" | "pos" | "both"` argument has been removed and is explicitly stripped in `_handle_backward_compatibility_on_load`. Amplitudes are read off each template's main (extremum) channel with a peak shift computed from the templates.

Public convenience function:
```python
compute_spike_amplitudes = ComputeSpikeAmplitudes.function_factory()
```

Recommended usage:

```python
analyzer.compute(["random_spikes", "waveforms", "templates"])
analyzer.compute("spike_amplitudes")
amps = analyzer.get_extension("spike_amplitudes").get_data()
# or grouped: analyzer.get_extension("spike_amplitudes").get_data(outputs="by_unit")
```
