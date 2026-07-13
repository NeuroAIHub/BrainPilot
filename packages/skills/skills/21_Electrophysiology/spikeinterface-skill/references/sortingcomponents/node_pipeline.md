# Node pipeline framework

Source in repo: `spikeinterface/src/spikeinterface/core/node_pipeline.py`
Parent index: [INDEX.md](INDEX.md)

---

## Node pipeline framework

Sorting components are implemented on top of the small node-graph engine in
`spikeinterface.core.node_pipeline`. The idea: a graph of `PipelineNode`
objects is executed in parallel over chunks of the recording. Peaks flow
from a `PeakSource` (either a detector or a replay of existing peaks) to
downstream nodes that extract features, denoise waveforms, localize peaks,
etc.

Key classes (in `spikeinterface.core.node_pipeline`):

- `PipelineNode` — base class. Overrides:
  - `get_margin()` — number of samples of trace margin needed.
  - `get_dtype()` — dtype of the node output.
  - `compute(chunk, start_frame, end_frame, segment_index, max_margin, *args)`.
- `PeakSource(PipelineNode)` — always the first node.
- `PeakDetector(PeakSource)` — subclassed by all `detect_peaks` methods
  (e.g. `LocallyExclusivePeakDetector`) and by all matching peelers via
  `BaseTemplateMatching`. There is **no** class called `PeakLocalizer` or
  `PeakSelector`.
- `PeakRetriever(recording, peaks)` — replay an existing peak array through
  the pipeline (used by `localize_peaks`).
- `SpikeRetriever(sorting, recording, ...)` — replay an existing sorting as
  spike-tagged peaks (used by postprocessing: spike locations, amplitude
  scalings, principal components, ...).
- `WaveformsNode(PipelineNode)` — base class for nodes that output
  waveforms.
- `ExtractDenseWaveforms(recording, parents, ms_before, ms_after,
  return_output=False)` — extract dense waveform snippets.
- `ExtractSparseWaveforms(recording, parents, ms_before, ms_after, ...)` —
  extract per-channel sparse waveform snippets.

Runner:

```python
run_node_pipeline(
    time_series,
    nodes,
    job_kwargs,
    job_name="pipeline",
    gather_mode="memory",   # or "npy" / "zarr" via GatherToMemory/Npy/Zarr
    gather_kwargs={},
    squeeze_output=True,
    folder=None,
    names=None,
    verbose=False,
    skip_after_n_peaks=None,
    slices=None,             # list of (segment_index, frame_start, frame_stop)
    check_for_peak_source=False,
)
```

Gather engines: `GatherToMemory`, `GatherToNpy`, `GatherToZarr` — all in
`core.node_pipeline`.

Helpers:

- `find_parent_of_type(list_of_parents, parent_type)`
- `find_parents_of_type(list_of_parents, parent_type)`
- `check_graph(nodes, check_for_peak_source=True)`
- `sorting_to_peaks(sorting, main_channel_indices, dtype=spike_peak_dtype)`

Every `detect_peaks` / `localize_peaks` / `find_spikes_from_templates` call
under the hood ends with `run_node_pipeline([...], job_kwargs, ...)`.
