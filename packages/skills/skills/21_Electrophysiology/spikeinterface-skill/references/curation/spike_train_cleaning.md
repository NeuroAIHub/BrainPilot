# Spike-train cleaning
Source in repo: `spikeinterface/src/spikeinterface/curation/remove_duplicated_spikes.py`
Parent index: [INDEX.md](INDEX.md)
---

## Spike-train cleaning

### remove_duplicated_spikes

Factory function created via
`define_function_from_class(source_class=RemoveDuplicatedSpikesSorting, name="remove_duplicated_spikes")`.
Instantiates the following class (verbatim from `remove_duplicated_spikes.py`):

```python
class RemoveDuplicatedSpikesSorting(BaseSorting):
    def __init__(self, sorting: BaseSorting, censored_period_ms: float = 0.3, method: str = "keep_first") -> None
```

Parameters:

- `sorting` (`BaseSorting`) - the parent sorting.
- `censored_period_ms` (`float`, default `0.3`) - two spikes closer than this window (ms)
  are considered duplicates.
- `method` (`str`, default `"keep_first"`) - one of:
  - `"keep_first"` - for each ISI violation, remove the second spike (non-iterative).
  - `"keep_last"` - for each ISI violation, remove the first spike (non-iterative).
  - `"keep_first_iterative"` - iteratively keep the first spike and remove following
    violations (requires `numba`).
  - `"keep_last_iterative"` - like `"keep_first_iterative"` but from the end of the train
    (requires `numba`).
  - `"random"` - randomly remove first or last of each violating pair.

Returns a lazy Sorting wrapper without the duplicated spikes.


### remove_excess_spikes

Verbatim signature from `remove_excess_spikes.py`:

```python
def remove_excess_spikes(sorting: BaseSorting, recording: BaseRecording | None = None)
```

Parameters:

- `sorting` (`BaseSorting`) - the parent sorting.
- `recording` (`BaseRecording | None`, default `None`) - recording used to determine the
  number of samples per segment. If `None`, uses the recording registered on the sorting
  (asserts one is registered).

Returns the original sorting unchanged when no spike exceeds the segment length; otherwise
returns a `RemoveExcessSpikesSorting` wrapper.


### find_duplicated_spikes

Verbatim signature from `curation_tools.py`:

```python
def find_duplicated_spikes(
    spike_train,
    censored_period: int,
    method: Literal["keep_first", "keep_last", "keep_first_iterative", "keep_last_iterative", "random"] = "random",
    seed: int | None = None,
) -> np.ndarray
```

Parameters:

- `spike_train` (`np.ndarray`) - spike train (integer sample indices).
- `censored_period` (`int`) - censored period in samples.
- `method` (`Literal[...]`, default `"random"`) - one of the five duplicate-selection
  policies:
  - `"keep_first"`
  - `"keep_last"`
  - `"keep_first_iterative"`
  - `"keep_last_iterative"`
  - `"random"`

  Non-iterative numpy paths (`"keep_first"`, `"keep_last"`, `"random"`) do not require
  numba. The `_methods_numpy` internal set is `("keep_first", "random", "keep_last")`,
  and the `_methods` full set is
  `("keep_first", "random", "keep_last", "keep_first_iterative", "keep_last_iterative")`.
  Iterative methods require `numba`.
- `seed` (`int | None`, default `None`) - required when `method="random"`; ignored
  otherwise.

Returns the array of indices in `spike_train` that should be dropped.
