# Hybrid tools (`hybrid_tools.py`)
Source in repo: `spikeinterface/src/spikeinterface/generation/hybrid_tools.py`
Parent index: [INDEX.md](INDEX.md)
---

### `generate_hybrid_recording`

Inject synthetic (or user-provided) units into an existing real recording, optionally following a `Motion` object.

```python
def generate_hybrid_recording(
    recording: BaseRecording,
    sorting: BaseSorting | None = None,
    templates: Templates | None = None,
    motion: Motion | None = None,
    are_templates_scaled: bool = True,
    unit_locations: np.ndarray | None = None,
    drift_step_um: float = 1.0,
    upsample_factor: int | None = None,
    upsample_vector: np.ndarray | None = None,
    amplitude_std: float = 0.05,
    amplitude_factor: np.ndarray | None = None,
    generate_sorting_kwargs: dict = dict(num_units=10, firing_rates=15, refractory_period_ms=4.0, seed=2205),
    generate_unit_locations_kwargs: dict = dict(margin_um=10.0, minimum_z=5.0, maximum_z=50.0, minimum_distance=20),
    generate_templates_kwargs: dict = dict(ms_before=1.0, ms_after=3.0),
    seed: int | None = None,
) -> tuple[BaseRecording, BaseSorting]
```

Parameters:
- `recording` (BaseRecording): Base recording to inject units into.
- `sorting` (BaseSorting | None, default None): If None, one is generated with `generate_sorting_kwargs`.
- `templates` (Templates | None, default None): If None, templates are generated with `generate_templates_kwargs` and `generate_unit_locations_kwargs`.
- `motion` (Motion | None, default None): If provided, uses `DriftingTemplates` + `InjectDriftingTemplatesRecording` so units follow drift. Otherwise, a static `InjectTemplatesRecording` is used and a warning is emitted.
- `are_templates_scaled` (bool, default True): If True, templates are assumed to be in uV and are "unscaled" (subtract offsets, divide by gains) when the recording has channel gains/offsets.
- `unit_locations` (np.ndarray | None, default None): Injection locations. If None and `templates is None`, generated via `generate_unit_locations`. If `templates` is provided, `unit_locations` is computed via `compute_monopolar_triangulation` on the templates.
- `drift_step_um` (float, default 1.0): Step used to build the discrete displacement grid when `motion` is provided.
- `upsample_factor` (int | None, default None): Upsampling factor used only when templates must be generated.
- `upsample_vector` (np.ndarray | None, default None): Optional per-spike upsample index (same shape as spike_vector).
- `amplitude_std` (float, default 0.05): Std of the per-spike amplitude modulation applied at injection.
- `amplitude_factor` (np.ndarray | None, default None): Explicit per-spike amplitude factor.
- `generate_sorting_kwargs` (dict, default `dict(num_units=10, firing_rates=15, refractory_period_ms=4.0, seed=2205)`).
- `generate_unit_locations_kwargs` (dict, default `dict(margin_um=10.0, minimum_z=5.0, maximum_z=50.0, minimum_distance=20)`).
- `generate_templates_kwargs` (dict, default `dict(ms_before=1.0, ms_after=3.0)`).
- `seed` (int | None, default None): Global seed.

Returns: `(hybrid_recording, sorting)`.

Notes on modes / drift / template selection:
- Drift mode is enabled by passing `motion`. `motion.dim` must be 0 or 1 (2 raises `NotImplementedError("3D motion not implemented yet")`). Displacement start/stop is derived from `min`/`max` of the concatenated motion displacement; the discretization step is `drift_step_um`.
- Template selection: `templates` argument can be user-provided (typically from the template database or from `estimate_templates_from_recording`), and `select_templates` / `scale_template_to_range` / `relocate_templates` help preparing them before injection.

### `estimate_templates_from_recording`

```python
def estimate_templates_from_recording(
    recording: BaseRecording,
    ms_before: float = 2,
    ms_after: float = 2,
    sorter_name: str = "spykingcircus2",
    run_sorter_kwargs: dict | None = None,
    job_kwargs: dict | None = None,
)
```

Runs a sorter (SpyKING CIRCUS 2 by default, with template matching disabled via `run_sorter_kwargs["matching"] = {"method": None}`) then estimates dense templates from its clustering output. Returns a `Templates` object with `is_in_uV=True` and the recording's probe attached.

Parameters:
- `recording` (BaseRecording): Recording to estimate templates from.
- `ms_before` (float, default 2): Time before the peak of the templates.
- `ms_after` (float, default 2): Time after the peak of the templates.
- `sorter_name` (str, default `"spykingcircus2"`): Sorter used to obtain fast clustering.
- `run_sorter_kwargs` (dict | None, default None): Kwargs forwarded to `run_sorter`.
- `job_kwargs` (dict | None, default None): Job kwargs used inside `estimate_templates`.

### `select_templates`

```python
def select_templates(
    templates: Templates,
    min_amplitude: float | None = None,
    max_amplitude: float | None = None,
    min_depth: float | None = None,
    max_depth: float | None = None,
    amplitude_function: Literal["ptp", "min", "max"] = "ptp",
    depth_direction: Literal["x", "y"] = "y",
)
```

Filter templates by amplitude and/or depth. At least one of the four bounds must be given (asserted). Requires a probe attached to `templates` when depth filtering is used. Returns the filtered `Templates`, or `None` (with a warning) if no template passes.

Parameters:
- `templates` (Templates).
- `min_amplitude` (float | None, default None).
- `max_amplitude` (float | None, default None).
- `min_depth` (float | None, default None).
- `max_depth` (float | None, default None).
- `amplitude_function` (Literal, default `"ptp"`): one of `"ptp"`, `"min"`, `"max"`.
- `depth_direction` (Literal, default `"y"`): one of `"x"`, `"y"`.

### `scale_template_to_range`

```python
def scale_template_to_range(
    templates: Templates,
    min_amplitude: float,
    max_amplitude: float,
    amplitude_function: Literal["ptp", "min", "max"] = "ptp",
)
```

Linearly rescales templates so their per-unit amplitude sits between `min_amplitude` and `max_amplitude`. Returns a new `Templates`.

Parameters:
- `templates` (Templates).
- `min_amplitude` (float): Target minimum amplitude across units after scaling.
- `max_amplitude` (float): Target maximum amplitude across units after scaling.
- `amplitude_function` (Literal, default `"ptp"`): one of `"ptp"`, `"min"`, `"max"`.

### `relocate_templates`

```python
def relocate_templates(
    templates: Templates,
    min_displacement: float,
    max_displacement: float,
    margin: float = 0.0,
    favor_borders: bool = True,
    depth_direction: Literal["x", "y"] = "y",
    seed: int | None = None,
)
```

Move each template by a random displacement in `[min_displacement, max_displacement]` along `depth_direction`.

Parameters:
- `templates` (Templates).
- `min_displacement` (float).
- `max_displacement` (float).
- `margin` (float, default 0.0): Allows going beyond probe borders when > 0.
- `favor_borders` (bool, default True): Biases towards moving units toward the closest probe border to avoid center-of-probe bias.
- `depth_direction` (Literal, default `"y"`): one of `"x"`, `"y"`.
- `seed` (int | None, default None).
