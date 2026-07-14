# Peak localization — center_of_mass

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/peak_localization/method_list.py`
Parent index: [../INDEX.md](../INDEX.md)

---

### `center_of_mass` — `LocalizeCenterOfMass`

Class attribute: `name = "center_of_mass"`.

```python
LocalizeCenterOfMass(
    recording,
    parents,
    return_output=True,
    radius_um=75.0,
    feature="ptp",
)
```

- `radius_um : float`, default `75.0` — sparsity radius (um).
- `feature : "ptp" | "mean" | "energy" | "peak_voltage"`, default `"ptp"` —
  validated by `assert feature in ["ptp", "mean", "energy", "peak_voltage"]`.
- `return_output : bool`, default `True`.
