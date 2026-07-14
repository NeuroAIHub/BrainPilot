# Backends

Source in repo: `spikeinterface/src/spikeinterface/widgets/base.py`
Parent index: [INDEX.md](INDEX.md)
---

## Backends overview

Defined in `widgets/base.py`. Every widget subclass exposes a subset of the following backends by defining a `plot_<backend>` method. Available backends are detected via `BaseWidget.get_possible_backends()`, which inspects `hasattr(cls, f"plot_{k}")` against the keys of `default_backend_kwargs`.

| Backend value (Literal) | Purpose |
| --- | --- |
| `"matplotlib"` | Static Matplotlib figures. Default backend at import. |
| `"ipywidgets"` | Interactive Jupyter widgets (uses `ipywidgets` + Matplotlib canvas). |
| `"sortingview"` | Remote figURL / SortingView web viewer (deprecated in favor of figpack). |
| `"figpack"` | Web-based interactive views (successor to sortingview). |
| `"ephyviewer"` | Standalone Qt time-series viewer (currently only `TracesWidget`). |
| `"spikeinterface_gui"` | Standalone SpikeInterface Qt/Panel GUI (currently only `SortingSummaryWidget`). |

The full set of accepted `backend=` string Literal values is exactly:

```
"matplotlib" | "figpack" | "ipywidgets" | "ephyviewer" | "spikeinterface_gui" | "sortingview"
```

Passing a backend that is not implemented for the target widget triggers an `AssertionError` listing the available ones.

### Default backend management

```python
from spikeinterface.widgets import get_default_plotter_backend, set_default_plotter_backend

get_default_plotter_backend()          # -> "matplotlib" at import
set_default_plotter_backend("ipywidgets")
```

Both live in `widgets/base.py` and mutate a module-global `default_backend_`:

```python
def get_default_plotter_backend():
    """Return the default backend for spikeinterface widgets.
    The default backend is "matplotlib" at init.
    It can be be globally set with `set_default_plotter_backend(backend)`
    """

def set_default_plotter_backend(backend):
    ...
```

- `get_default_plotter_backend()` returns the module-global default backend string.
- `set_default_plotter_backend(backend)` sets it (used when a widget's `backend=None`).
- Recognised backend strings (used both here and in the `backend=` kwarg of every widget) are the six Literal values enumerated above.

### Common backend keyword arguments

Passed as `**backend_kwargs` to any `plot_*` call. Defaults are taken verbatim from `default_backend_kwargs` in `widgets/base.py`:

| Backend | Kwargs (verbatim defaults) |
| --- | --- |
| `"matplotlib"` | `figure=None`, `ax=None`, `axes=None`, `ncols=5`, `figsize=None`, `figtitle=None` |
| `"figpack"` | `display=True`, `figlabel=None`, `inline=None`, `height=None`, `wait_for_input=False` |
| `"ipywidgets"` | `width_cm=25`, `height_cm=10`, `display=True`, `controllers=None` |
| `"ephyviewer"` | (none) |
| `"spikeinterface_gui"` | (none) |
| `"sortingview"` | `generate_url=True`, `display=True`, `figlabel=None`, `height=None` |

Attempting to pass a keyword not in the target backend's default dict raises `Exception(f"{k} is not a valid plot argument ...")`.

When the matplotlib backend is used, the returned widget object exposes attributes named `.figure`, `.axes`, and `.ax` for further customization (e.g. `w.ax.set_xlim((0, 100))`). `BombcellUpsetPlotWidget` additionally exposes `.figures` (a list, one per unit label subplot).

---
