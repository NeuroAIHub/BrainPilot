# Automated splitting
Source in repo: `spikeinterface/src/spikeinterface/curation/__init__.py`
Parent index: [INDEX.md](INDEX.md)
---

## Automated splitting

There is currently no public `get_potential_auto_split` or `auto_split_units` function in
`spikeinterface.curation` (verified against `curation/__init__.py` and every file in the
directory). Automated per-unit splitting is not exposed here. If you need to split units,
use `CurationSorting.split(...)`, `SplitUnitSorting(...)`, or specify `splits` in a
curation dict passed to `apply_curation`.
