# Snippets extractors
Source in repo: `spikeinterface/src/spikeinterface/extractors/waveclussnippetstextractors.py`
Parent index: [INDEX.md](INDEX.md)
---

## `read_waveclus_snippets(file_path)`

Class: `WaveClusSnippetsExtractor` in `waveclussnippetstextractors.py` — combines `MatlabHelper` + `BaseSnippets`. Reads WaveClus snippets from either a `times_*.mat` file (uses `cluster_class[:,1]` for times) or a `*_spikes.mat` file (uses `index` for times).

Full signature (verbatim):

```python
class WaveClusSnippetsExtractor(MatlabHelper, BaseSnippets):
    def __init__(self, file_path):
```

The snippets are stored on disk shaped `(n_snippets, n_samples * n_channels)` (channels concatenated per sample) and reshaped to `(n_snippets, n_samples, n_channels)` for SpikeInterface.

Snippet layout parameters come from `par/sr`, `par/w_pre` (offset by -1), `par/w_post` (offset by +1). Times are stored in ms and converted to frames via `round(times * sr / 1000)`.

Also provides:

```python
@staticmethod
def write_snippets(snippets_extractor, save_file_path):
```

`save_file_path` must end with `_spikes.mat`. The snippets extractor must be aligned (`is_aligned()` True). Writes `{"index": ..., "spikes": ..., "par": {"sr", "w_pre", "w_post"}}` via `MatlabHelper.write_dict_to_mat`.

## `read_npy_snippets(...)`

Re-exported from `spikeinterface.core` as `read_npy_snippets` (wrapper for `NpySnippetsExtractor`). Not implemented in the `extractors` subpackage — see the core reference for its signature.
