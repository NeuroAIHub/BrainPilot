# Sortingview curation
Source in repo: `spikeinterface/src/spikeinterface/curation/sortingview_curation.py`
Parent index: [INDEX.md](INDEX.md)
---

## Sortingview curation

### apply_sortingview_curation

Verbatim signature from `sortingview_curation.py`:

```python
def apply_sortingview_curation(
    sorting_or_analyzer, uri_or_json, exclude_labels=None, include_labels=None, skip_merge=False, verbose=None
)
```

Parameters:

- `sorting_or_analyzer` (`Sorting | SortingAnalyzer`) - object to curate.
- `uri_or_json` (`str | Path`) - path to a local `.json` file, a kachery URI, or a
  `gh://` URL. Non-`.json` paths (and any non-`gh://` prefix) trigger a call to the
  optional `kachery` package (falling back to `kachery_cloud` with a deprecation warning).
- `exclude_labels` (`list | None`, default `None`) - labels to drop. Mutually exclusive
  with `include_labels`.
- `include_labels` (`list | None`, default `None`) - labels to keep. Mutually exclusive
  with `exclude_labels`.
- `skip_merge` (`bool`, default `False`) - if True, ignore the merge groups in the
  curation dict (labels/removals still apply).
- `verbose` (`None`) - deprecated; setting anything but `None` emits a warning.

Behavior:

1. Loads the curation dict (JSON file, kachery URI, or `gh://` URL).
2. Optionally strips merges if `skip_merge=True`.
3. Filters units by `exclude_labels` or `include_labels`.
4. Delegates the merge/removal application to `apply_curation(..., new_id_strategy="join")`.

Requires the `kachery` (or the deprecated `kachery_cloud`) package for URI loading.
