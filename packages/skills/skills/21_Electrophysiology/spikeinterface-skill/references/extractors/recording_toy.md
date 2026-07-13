# Toy data recording
Source in repo: `spikeinterface/src/spikeinterface/extractors/toy_example.py`
Parent index: [INDEX.md](INDEX.md)
---

Source: `extractors/toy_example.py`. Generates an on-the-fly ground-truth dataset (no disk I/O). Backed by `NoiseGeneratorRecording` + `generate_templates` + `InjectTemplatesRecording` via `generate_ground_truth_recording`.

```python
def toy_example(
    duration=10,
    num_channels=4,
    num_units=10,
    sampling_frequency=30000.0,
    num_segments=2,
    average_peak_amplitude=-100,
    upsample_factor=None,
    contact_spacing_um=40.0,
    num_columns=1,
    spike_times=None,
    spike_labels=None,
    # score_detection=1,   # commented out in source
    firing_rate=3.0,
    seed=None,
):
    """
    Returns
    -------
    recording : RecordingExtractor
    sorting   : SortingExtractor
    """
```

Return type: tuple `(BaseRecording, BaseSorting)` (concretely an `InjectTemplatesRecording` and a `NumpySorting`).

Notes:
- `duration` may be a `float`/`int` (repeated per segment) or a `list[float]` of length `num_segments`.
- `upsample_factor` currently raises `NotImplementedError` if set.
- If `spike_times` / `spike_labels` are provided, both must be `list[np.ndarray]` of length `num_segments`.
- Probe: a 2-D `Probe` with `num_channels` circular contacts (radius 5), `contact_spacing_um` spacing, `num_columns` columns.
- Templates are generated with `ms_before=1.5`, `ms_after=3.0`, and rescaled to `average_peak_amplitude` when it is not `None`.
