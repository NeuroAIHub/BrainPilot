# Peak detection — matched_filtering

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/peak_detection/matched_filtering.py`
Parent index: [../INDEX.md](../INDEX.md)

---

### `matched_filtering` — `MatchedFilteringPeakDetector`

Class attributes: `name = "matched_filtering"`, `engine = "numba"`,
`need_noise_levels = False`, `preferred_mp_context = None`.

```python
MatchedFilteringPeakDetector(
    recording,
    prototype,
    ms_before,
    peak_sign="neg",
    detect_threshold=5,
    exclude_sweep_ms=1.0,
    radius_um=50,
    random_chunk_kwargs={"num_chunks_per_segment": 5},
    weight_method={},
    return_output=True,
)
```

- `prototype : array` (positional, required) — canonical action potential
  waveform used as filter.
- `ms_before : float` (positional, required) — time (ms) before the max
  absolute value of the prototype.
- `peak_sign : "neg" | "pos" | "both"`, default `"neg"` — validated by
  `assert peak_sign in ("both", "neg", "pos")`. Additionally the prototype
  sign must match (asserted).
- `detect_threshold : float`, default `5`.
- `exclude_sweep_ms : float`, default `1.0`.
- `radius_um : float`, default `50` — neighbourhood radius for local
  deduplication.
- `random_chunk_kwargs : dict`, default `{"num_chunks_per_segment": 5}` —
  used to estimate noise of the convolved signal.
- `weight_method : dict`, default `{}` — forwarded to
  `postprocessing.localization_tools.get_convolution_weights`
  (`mode="gaussian_2d"` or `"exponential_3d"`, etc.).
- `return_output : bool`, default `True`.

Output dtype gains an extra `"z"` (float32) field indicating the depth index
in the fake grid. Requires `numba` and `scipy`.
