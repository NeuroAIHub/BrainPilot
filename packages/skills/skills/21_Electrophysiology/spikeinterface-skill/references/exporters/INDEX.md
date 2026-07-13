# SpikeInterface Exporters Reference

The `spikeinterface.exporters` module provides functions to export a `SortingAnalyzer` (or `Sorting`) to formats consumed by other tools (Phy, IBL alignment GUI, Pynapple) or to a self-contained HTML/image report.

Public API (from `spikeinterface/exporters/__init__.py`):

```python
from .to_phy import export_to_phy
from .report import export_report
from .to_ibl import export_to_ibl_gui
from .to_pynapple import to_pynapple_tsgroup
```

The four names exported are:

- `export_to_phy`
- `export_report`
- `export_to_ibl_gui`
- `to_pynapple_tsgroup`

Note: the public export is `to_pynapple_tsgroup` — there is no `export_to_pynapple` symbol.

## Leaf files

- [export_to_phy.md](export_to_phy.md) — Export a `SortingAnalyzer` to the Phy template-gui format.
- [export_to_ibl_gui.md](export_to_ibl_gui.md) — Export a `SortingAnalyzer` to the IBL alignment GUI format.
- [to_pynapple_tsgroup.md](to_pynapple_tsgroup.md) — Convert a `SortingAnalyzer` / `Sorting` into a `pynapple.TsGroup`.
- [export_report.md](export_report.md) — Export a summary report (unit summaries, per-unit plots, CSVs).
- [helpers_and_enums.md](helpers_and_enums.md) — Module-level helpers (`compute_rms`), enum / Literal parameter values (`template_mode`, `remove_if_exists`, `peak_sign`, `format`), and the required-extensions summary table.
