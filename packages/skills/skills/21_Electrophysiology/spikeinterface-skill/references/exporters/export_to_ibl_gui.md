# export_to_ibl_gui
Source in repo: `spikeinterface/src/spikeinterface/exporters/to_ibl.py`
Parent index: [INDEX.md](INDEX.md)
---

Exports a `SortingAnalyzer` to the format required by the IBL alignment GUI (`https://github.com/int-brain-lab/iblapps/wiki`). Source: `spikeinterface/exporters/to_ibl.py`.

### Signature (verbatim from source)

```python
def export_to_ibl_gui(
    sorting_analyzer: SortingAnalyzer,
    output_folder: str | Path,
    lfp_recording: BaseRecording | None = None,
    rms_win_length_s=3,
    welch_win_length_samples=2**14,
    psd_chunk_duration_s=1,
    psd_num_chunks=100,
    good_units_query: str | None = "amplitude_median < -40 and isi_violations_ratio < 0.5 and amplitude_cutoff < 0.2",
    remove_if_exists: bool = False,
    verbose: bool = True,
    **job_kwargs,
):
```

### Parameters (verbatim from docstring)

- `analyzer: SortingAnalyzer` — The sorting analyzer object to use for spike information. Should also contain the pre-processed recording to use for AP-band data. (Note: the docstring parameter name is `analyzer` but the actual signature parameter is `sorting_analyzer` — pass positionally or as `sorting_analyzer=...`.)
- `output_folder: str | Path` — The output folder for the exports.
- `lfp_recording: BaseRecording | None, default: None` — The pre-processed recording to use for LFP data. If None, the LFP data is not exported.
- `rms_win_length_s: float, default: 3` — The window length in seconds for the RMS calculation (on the LFP data).
- `welch_win_length_samples: int, default: 2^14` — The window length in samples for the Welch spectral density computation (on the LFP data).
- `psd_chunk_duration_s: float, default: 1` — The chunk duration in seconds for the spectral density calculation (on the LFP data).
- `psd_num_chunks: int, default: 100` — The number of chunks to use for the spectral density calculation (on the LFP data).
- `good_units_query : str | None, default: "amplitude_median < -40 and isi_violations_ratio < 0.5 and amplitude_cutoff < 0.2"` — Pandas-style query string applied to the quality metrics DataFrame; matching units are labelled `1` in `clusters.metrics.csv`. Column names referenced by the query must exist in the `"quality_metrics"` extension DataFrame. Set to `None` to mark all units as good (`label = 1` for every unit). (Note: this parameter is not documented in the docstring; behaviour is verified from source.)
- `remove_if_exists: bool, default: False` — If True and `"output_folder"` exists, it is removed and overwritten.
- `verbose: bool, default: True` — If True, output is verbose.
- `**job_kwargs` — Shared job kwargs, forwarded to `compute_rms` for AP-band and LFP RMS computations. `chunk_duration` is overridden internally to `f"{rms_win_length_s}s"`.

### Required SortingAnalyzer extensions

Verified from source (`required_extensions = ["templates", "spike_amplitudes", "quality_metrics"]`):

- `"templates"` — required.
- `"spike_amplitudes"` — required.
- `"quality_metrics"` — required, and must contain every column referenced by `good_units_query` (default requires `amplitude_median`, `isi_violations_ratio`, `amplitude_cutoff`).

Optional extensions used if present:

- `"spike_locations"` — used to build `spikes.depths.npy` via the `"y"` column; if missing, extremum-channel `y` position is used per spike.
- `"template_metrics"` — used to obtain `peak_to_valley` for `clusters.peakToTrough.npy`; if missing, it is computed directly from templates using `(argmax − argmin) / sampling_frequency` on the extremum-channel waveform.

### Files written to `output_folder`

- `spikes.clusters.npy` (int32), `spikes.depths.npy` (float32), `spikes.times.npy` (float64), `spikes.amps.npy` (float32; sign-flipped and scaled by `1e-6` — i.e. positive amps in Volts).
- `clusters.waveforms.npy`, `clusters.channels.npy` (int32), `clusters.peakToTrough.npy`.
- `clusters.metrics.csv` (with `label` column populated from `good_units_query`).
- `channels.localCoordinates.npy`, `channels.rawInd.npy` (int32).
- `_iblqc_ephysTimeRmsAP.rms.npy`, `_iblqc_ephysTimeRmsAP.timestamps.npy` — only when `sorting_analyzer.has_recording()`.
- `_iblqc_ephysTimeRmsLF.rms.npy`, `_iblqc_ephysTimeRmsLF.timestamps.npy`,
  `_iblqc_ephysSpectralDensityLF.power.npy`, `_iblqc_ephysSpectralDensityLF.freqs.npy` — only when `lfp_recording is not None`.

### Constraints

- Only single-segment analyzers are supported (`ValueError` otherwise: `"The export to IBL format only supports a single segment."`).
- Requires `scipy` (`ImportError: "Please install scipy to use the `export_to_ibl` function."`).
- If `output_folder` exists and `remove_if_exists=False`, `FileExistsError` is raised.
- If any of the required extensions is missing, `ValueError(f"Missing required extension: {ext}. Please compute it before exporting to IBL format.")`.
- If `good_units_query` references columns absent from `quality_metrics`, `ValueError(f"Missing required quality metrics: {missing_metrics}. Please compute it before exporting to IBL format.")`.
- AP-RMS is only exported when `sorting_analyzer.has_recording()`.

### Usage

The docstring contains no example. Minimal usage:

```python
from spikeinterface.exporters import export_to_ibl_gui

export_to_ibl_gui(
    sorting_analyzer,
    output_folder="ibl_export",
    lfp_recording=lfp_recording,  # optional
    remove_if_exists=True,
)
```
