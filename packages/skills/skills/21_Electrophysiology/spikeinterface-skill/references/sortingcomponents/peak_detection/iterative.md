# Peak detection — IterativePeakDetector

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/peak_detection/iterative.py`
Parent index: [../INDEX.md](../INDEX.md)

---

### `IterativePeakDetector` (peak_detection/iterative.py, not in registry)

Not registered in `detect_peak_methods` but defined in
`spikeinterface.sortingcomponents.peak_detection.iterative`. Wraps another
detector to iteratively subtract denoised waveforms and re-detect.

```python
IterativePeakDetector(
    recording: BaseRecording,
    peak_detector_node: PeakDetector,
    waveform_extraction_node: WaveformsNode,
    waveform_denoising_node,
    num_iterations: int = 2,
    return_output: bool = True,
    tresholds: Optional[List[float]] = None,
)
```

Output dtype extends `base_peak_dtype` with `("iteration", "int8")`.
