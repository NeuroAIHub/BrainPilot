# residual_analysis

Source in repo: `spikeinterface/src/spikeinterface/benchmark/residual_analysis.py`
Parent index: [INDEX.md](INDEX.md)
---

## residual_analysis

Defined in `spikeinterface/benchmark/residual_analysis.py`. Both functions are re-exported at the `spikeinterface.benchmark` top level.

```python
def analyse_residual(
    analyzer,
    detect_peaks_kwargs=dict(
        method="locally_exclusive",
        peak_sign="both",
        detect_threshold=6.0,
    ),
    **job_kwargs,
):
    """
    This create the residual by removing each spike from the recording.
    This take in account the spike amplitude scaling, analyzer needs the
    "amplitude_scalings" extensions.
    Then a peak detector is run on this residual trace and then the number of
    peaks can be analysed (the less the better).

    This residual is not perfect at the moment because it does not take into
    account the jitter per spike and so the residual can be high for high
    amplitude when there is an inherent jitter per spike.

    Parameters
    ----------
    analyzer : SortingAnalyzer

    Returns
    -------
    residual : Recording
    peaks : np.array
        The peaks vector detected on the residual.
    """
```

`detect_peaks_kwargs` string literals:

* `method` — any peak detector supported by `spikeinterface.sortingcomponents.peak_detection.detect_peaks`. Default `"locally_exclusive"`. Common alternatives: `"by_channel"`, `"locally_exclusive_torch"`, `"by_channel_torch"`, `"matched_filtering"`.
* `peak_sign` — `"neg"`, `"pos"`, `"both"`. Default `"both"`; `SorterBenchmarkWithoutGroundTruth.compute_result` overrides it to `"neg"`.

```python
def make_residual_recording(analyzer):
    """
    This make a lazy recording residual from an analyzer.

    Parameters
    ----------
    analyzer : SortingAnalyzer
        Must have both "templates" and "amplitude_scalings" extensions computed.

    Returns
    -------
    residual : Recording
        The residual, an InjectTemplatesRecording that adds -1 * templates back
        into the parent recording.  `residual.name` is set to "ResidualRecording".
    """
```
