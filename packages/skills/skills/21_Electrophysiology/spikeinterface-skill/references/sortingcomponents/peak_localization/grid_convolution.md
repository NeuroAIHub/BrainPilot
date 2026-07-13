# Peak localization — grid_convolution

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/peak_localization/method_list.py`
Parent index: [../INDEX.md](../INDEX.md)

---

### `grid_convolution` — `LocalizeGridConvolution`

Class attribute: `name = "grid_convolution"`.

```python
LocalizeGridConvolution(
    recording,
    parents,
    return_output=True,
    radius_um=40.0,
    upsampling_um=5.0,
    sigma_ms=0.25,
    margin_um=50.0,
    prototype=None,
    percentile=5.0,
    peak_sign="neg",
    weight_method={},
)
```

- `radius_um : float`, default `40.0`.
- `upsampling_um : float`, default `5.0` — grid resolution.
- `sigma_ms : float`, default `0.25` — temporal decay of the fake templates
  when no prototype is provided.
- `margin_um : float`, default `50.0` — margin around the probe for the
  fake template grid.
- `prototype : np.ndarray | None`, default `None` — if `None`, a Gaussian is
  generated.
- `percentile : float`, default `5.0` — asserted `0 <= (100-percentile) <= 100`.
- `peak_sign : "neg" | "pos"`, default `"neg"` — used only when
  `prototype is None`.
- `weight_method : dict`, default `{}` — forwarded to
  `get_convolution_weights` (e.g. `mode="gaussian_2d"` or
  `"exponential_3d"`).
- `return_output : bool`, default `True`.
