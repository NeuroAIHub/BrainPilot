# Peak localization — monopolar_triangulation

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/peak_localization/method_list.py`
Parent index: [../INDEX.md](../INDEX.md)

---

### `monopolar_triangulation` — `LocalizeMonopolarTriangulation`

Class attribute: `name = "monopolar_triangulation"`.

```python
LocalizeMonopolarTriangulation(
    recording,
    parents,
    return_output=True,
    radius_um=75.0,
    max_distance_um=150.0,
    optimizer="minimize_with_log_penality",
    enforce_decrease=True,
    feature="ptp",
)
```

- `radius_um : float`, default `75.0`.
- `max_distance_um : float`, default `150.0` — bounds on the depth solve.
- `optimizer : str`, default `"minimize_with_log_penality"`.
- `enforce_decrease : bool`, default `True` — enforce radial monotonic
  decrease of the PTP profile.
- `feature : "ptp" | "energy" | "peak_voltage"`, default `"ptp"` —
  validated by `assert feature in ["ptp", "energy", "peak_voltage"]`
  (note: `"mean"` is NOT accepted here, unlike `LocalizeCenterOfMass`).
- `return_output : bool`, default `True`.
