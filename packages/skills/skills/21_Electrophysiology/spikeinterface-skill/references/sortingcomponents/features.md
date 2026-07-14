# Features

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/waveforms/features_from_peaks.py`
Parent index: [INDEX.md](INDEX.md)

---

## Features

Module: `spikeinterface.sortingcomponents.waveforms.features_from_peaks`.

### `compute_features_from_peaks`

```python
from spikeinterface.sortingcomponents.waveforms.features_from_peaks import (
    compute_features_from_peaks,
)

compute_features_from_peaks(
    recording,
    peaks,
    feature_list=["ptp"],
    feature_params={},
    ms_before=1.0,
    ms_after=1.0,
    job_kwargs=None,
)
```

Docstring lists possible features as:
`amplitude`, `ptp`, `center_of_mass`, `energy`, `std_ptp`, `ptp_lag`,
`random_projections_ptp`, `random_projections_energy`.

**However**, the actual `_features_class` registry in the source only has
four entries — passing any other name raises `AssertionError`. Exact
registry (verified from source):

```python
_features_class = {
    "amplitude": AmplitudeFeature,
    "ptp": PeakToPeakFeature,
    "random_projections": RandomProjectionsFeature,
    "center_of_mass": LocalizeCenterOfMass,
}
```

So the valid `feature_list` entries are exactly:

- `"amplitude"` → `AmplitudeFeature`
- `"ptp"` → `PeakToPeakFeature`
- `"random_projections"` → `RandomProjectionsFeature`
- `"center_of_mass"` → `LocalizeCenterOfMass`
  (imported from `peak_localization.method_list`)

Returns a tuple of arrays (one per feature).

### `AmplitudeFeature`

```python
AmplitudeFeature(
    recording,
    name="amplitude_feature",
    return_output=True,
    parents=None,
    all_channels=False,
    peak_sign="neg",
)
```

- `peak_sign : "neg" | "pos" | "both"`, default `"neg"`.
- `all_channels : bool`, default `False`.

### `PeakToPeakFeature`

```python
PeakToPeakFeature(
    recording,
    name="ptp_feature",
    return_output=True,
    parents=None,
    radius_um=150.0,
    all_channels=True,
)
```

- `radius_um : float`, default `150.0`.
- `all_channels : bool`, default `True`.

### `RandomProjectionsFeature`

```python
RandomProjectionsFeature(
    recording,
    name="random_projections_feature",
    feature="ptp",
    return_output=True,
    parents=None,
    projections=None,
    radius_um=100,
    sparse=True,
    noise_threshold=None,
)
```

- `feature : "ptp" | "energy"`, default `"ptp"` — asserted
  `feature in ["ptp", "energy"]`.
- `radius_um : float`, default `100`.
- `sparse : bool`, default `True`.
- `noise_threshold : float | None`, default `None`.
