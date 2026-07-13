# Modular pipeline example

Source in repo: `spikeinterface/src/spikeinterface/sorters/internal/tridesclous2.py` (canonical example)
Parent index: [INDEX.md](INDEX.md)

---

## Modular pipeline example

The internal sorters in `spikeinterface.sorters.internal` are the canonical
examples of composing these components. Below is a simplified pipeline
inspired by `sorters/internal/tridesclous2.py::_run_from_folder`, showing
how detection, localization, motion estimation/correction, peak selection,
clustering and template matching connect together. It is intentionally
skeletal — see the full source (`tridesclous2.py`, `spyking_circus2.py`,
`lupin.py`) for production defaults.

```python
import numpy as np
from spikeinterface.core import Templates, NumpySorting
from spikeinterface.core.waveform_tools import estimate_templates_with_accumulator
from spikeinterface.core.core_tools import ms_to_samples
from spikeinterface.core.recording_tools import get_noise_levels

from spikeinterface.sortingcomponents.peak_detection import detect_peaks
from spikeinterface.sortingcomponents.peak_localization import localize_peaks
from spikeinterface.sortingcomponents.peak_selection import select_peaks
from spikeinterface.sortingcomponents.clustering import find_clusters_from_peaks
from spikeinterface.sortingcomponents.clustering.method_list import clustering_methods
from spikeinterface.sortingcomponents.matching import find_spikes_from_templates
from spikeinterface.sortingcomponents.motion import (
    estimate_motion,
    interpolate_motion,
)
from spikeinterface.sortingcomponents.tools import (
    clean_templates,
    compute_sparsity_from_peaks_and_label,
)

# ---- 0. job kwargs shared by every stage ----------------------------------
job_kwargs = dict(n_jobs=-1, chunk_duration="1s", progress_bar=True)

# ---- 1. noise levels ------------------------------------------------------
noise_levels = get_noise_levels(recording, return_in_uV=False, **job_kwargs)

# ---- 2. peak detection ----------------------------------------------------
detection_params = dict(
    noise_levels=noise_levels,
    peak_sign="neg",
    detect_threshold=5,
    exclude_sweep_ms=1.5,
    radius_um=80.0,
)
peaks = detect_peaks(
    recording,
    method="locally_exclusive",
    method_kwargs=detection_params,
    job_kwargs=job_kwargs,
)

# ---- 3. peak localization (for motion estimation) -------------------------
peak_locations = localize_peaks(
    recording,
    peaks,
    method="center_of_mass",
    method_kwargs=dict(radius_um=75.0, feature="ptp"),
    ms_before=0.5,
    ms_after=0.5,
    job_kwargs=job_kwargs,
)

# ---- 4. motion estimation + interpolation ---------------------------------
motion = estimate_motion(
    recording,
    peaks=peaks,
    peak_locations=peak_locations,
    method="dredge_ap",
    direction="y",
    rigid=False,
)
recording_corrected = interpolate_motion(
    recording,
    motion,
    border_mode="remove_channels",
    spatial_interpolation_method="kriging",
    sigma_um=20.0,
    p=1,
)

# ---- 5. peak selection for clustering -------------------------------------
selected_peaks = select_peaks(
    peaks,
    method="uniform",
    n_peaks=20_000,
    seed=0,
)

# ---- 6. clustering --------------------------------------------------------
clustering_kwargs = dict(clustering_methods["iterative-isosplit"]._default_params)
clustering_kwargs["noise_levels"] = noise_levels
clustering_kwargs["seed"] = 0
unit_ids, peak_labels, more_outs = find_clusters_from_peaks(
    recording_corrected,
    selected_peaks,
    method="iterative-isosplit",
    method_kwargs=clustering_kwargs,
    extra_outputs=True,
    job_kwargs=job_kwargs,
)

mask = peak_labels >= 0
kept_peaks, kept_labels = selected_peaks[mask], peak_labels[mask]

# ---- 7. build a Templates object ------------------------------------------
fs = recording_corrected.get_sampling_frequency()
ms_before, ms_after = 0.5, 1.5
nbefore = ms_to_samples(ms_before, fs)
nafter = ms_to_samples(ms_after, fs)

pre_peeler = NumpySorting.from_samples_and_labels(
    kept_peaks["sample_index"], kept_labels, fs, unit_ids=unit_ids,
)
sparsity, _ = compute_sparsity_from_peaks_and_label(
    kept_peaks, pre_peeler.to_spike_vector()["unit_index"],
    pre_peeler.unit_ids, recording_corrected, radius_um=100.0,
)
templates_array = estimate_templates_with_accumulator(
    recording_corrected,
    pre_peeler.to_spike_vector(),
    pre_peeler.unit_ids,
    nbefore, nafter,
    return_in_uV=False,
    sparsity_mask=sparsity.mask,
    **job_kwargs,
)
templates = Templates(
    templates_array=templates_array,
    sampling_frequency=fs,
    nbefore=nbefore,
    channel_ids=recording_corrected.channel_ids,
    unit_ids=pre_peeler.unit_ids,
    sparsity_mask=sparsity.mask,
    probe=recording_corrected.get_probe(),
    is_in_uV=False,
)
templates = clean_templates(
    templates,
    sparsify_threshold=1.0,
    noise_levels=noise_levels,
    min_snr=2.5,
    max_jitter_ms=0.2,
    remove_empty=True,
)

# ---- 8. template matching (peeler) ----------------------------------------
spikes = find_spikes_from_templates(
    recording_corrected,
    templates,
    method="tdc-peeler",                     # or "circus-omp", "wobble", "nearest", "nearest-svd"
    method_kwargs=dict(noise_levels=noise_levels),
    job_kwargs=job_kwargs,
)

# ---- 9. final sorting -----------------------------------------------------
from spikeinterface.core.base import minimum_spike_dtype
final = np.zeros(spikes.size, dtype=minimum_spike_dtype)
final["sample_index"] = spikes["sample_index"]
final["unit_index"] = spikes["cluster_index"]
final["segment_index"] = spikes["segment_index"]
sorting = NumpySorting(final, fs, templates.unit_ids)
```

This mirrors the actual code flow used by the built-in `tridesclous2` /
`spykingcircus2` sorters — the only extra pieces those sorters add are the
sort-specific hyperparameter book-keeping, preprocessing / whitening chain,
optional peeler cleaning (`final_cleaning_circus`) and I/O.
