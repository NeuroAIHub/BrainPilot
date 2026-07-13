# Curation model classes
Source in repo: `spikeinterface/src/spikeinterface/curation/curation_model.py`
Parent index: [INDEX.md](INDEX.md)
---

## Curation model classes

Available in `spikeinterface.curation.curation_model`:

- `Curation` - the top-level Pydantic model (schema above). Includes helper
  `get_final_ids_from_new_unit_ids()` used by `SequentialCuration` to check that step
  outputs line up with the next step's `unit_ids`.
- `CurationModel(*args, **kwargs)` - deprecated shim that emits a `DeprecationWarning`
  and returns `Curation(*args, **kwargs)`. Scheduled for removal in v0.105.0.
- `SequentialCuration` - Pydantic model with the single field
  `curation_steps: List[Curation]`. Post-validator ensures every step (except the last)
  has explicit `new_unit_id` on every merge and `new_unit_ids` on every split, and that
  the resulting final ids match the next step's `unit_ids`.
- `LabelDefinition`, `ManualLabel`, `Merge`, `Split` - sub-schemas listed above.
