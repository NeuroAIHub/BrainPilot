# Job Tools — job_tools.py
Source in repo: `spikeinterface/src/spikeinterface/core/job_tools.py`
Parent index: [INDEX.md](INDEX.md)
Related: [globals.md](globals.md), [core_tools.md](core_tools.md), [recording_tools.md](recording_tools.md)
---

## 5. Job Tools — `job_tools.py`

### Job kwargs vocabulary

The whitelist (`job_keys` at module level) — any other key raises `AssertionError`:

```python
job_keys = (
    "pool_engine",
    "n_jobs",
    "total_memory",
    "chunk_size",
    "chunk_memory",
    "chunk_duration",
    "progress_bar",
    "mp_context",
    "max_threads_per_worker",
)
```

Mutually exclusive size specifiers (only one may be active):

```python
_mutually_exclusive = (
    "total_memory",
    "chunk_size",
    "chunk_memory",
    "chunk_duration",
)
```

Note: the ticket referenced `verbose` as a job_kwarg — it is not in `job_keys`, it is a per-function argument (e.g., `write_binary_recording(..., verbose=False, ...)`).

Semantics (from `_shared_job_kwargs_doc`):
- `chunk_size: int` — samples per chunk.
- `chunk_memory: str` — memory per chunk per worker; e.g. `"100M"`, `"1G"`, `"500MiB"`, `"2GiB"`.
- `total_memory: str` — total memory across workers; e.g. `"500M"`, `"2G"`.
- `chunk_duration: str | float | None` — seconds if float, or units string like `"1s"`, `"500ms"`.
- `n_jobs: int | float` — `-1` → `os.cpu_count()`; float in `(0, 1]` → fraction of cores.
- `progress_bar: bool`.
- `mp_context`: `"fork"` | `"spawn"` | `None` (default `None`; `"fork"` is only safe on Linux).
- `pool_engine`: `"process"` | `"thread"` (default `"process"` at the global level).
- `max_threads_per_worker: int | None, default 1` — applies when `n_jobs > 1`; `None` → no limit.

### Globals used with job kwargs (from `globals.py`)

```python
_default_job_kwargs = dict(
    pool_engine="process", n_jobs=1, chunk_duration="1s", progress_bar=True, mp_context=None, max_threads_per_worker=1
)
```

### Public functions

```python
def set_global_job_kwargs(**job_kwargs):
def get_global_job_kwargs():
def reset_global_job_kwargs():
def is_set_global_job_kwargs_set() -> bool:
```

```python
def fix_job_kwargs(runtime_job_kwargs):
```
Merges `runtime_job_kwargs` into the global job kwargs (validating keys, applying mutual-exclusion, resolving `n_jobs=-1` / float / negative to a concrete count, clipping to `os.cpu_count()`).

```python
def split_job_kwargs(mixed_kwargs):
```
Returns `(specific_kwargs, job_kwargs)` (with `job_kwargs` normalized via `fix_job_kwargs`).

```python
def get_best_job_kwargs():
```
Returns `dict(pool_engine=..., mp_context=..., n_jobs=..., max_threads_per_worker=...)` tuned per-OS (Linux: `process`/`fork`; macOS: `process`/`spawn`; Windows: `thread`/`None`).

### `TimeSeriesChunkExecutor` (the executor class — successor of `ChunkRecordingExecutor`)

```python
class TimeSeriesChunkExecutor:
    def __init__(
        self,
        time_series: "TimeSeries",
        func,
        init_func,
        init_args,
        verbose=False,
        progress_bar=False,
        handle_returns=False,
        gather_func=None,
        pool_engine="thread",
        n_jobs=1,
        total_memory=None,
        chunk_size=None,
        chunk_memory=None,
        chunk_duration=None,
        mp_context=None,
        job_name="",
        max_threads_per_worker=1,
        need_worker_index=False,
    ):
```
Method: `run(slices=None)`.

Note: `ChunkRecordingExecutor` no longer exists in `core/job_tools.py` under that name — it has been renamed to `TimeSeriesChunkExecutor`. Public helpers also exported: `ensure_n_jobs(extractor, n_jobs=1)`, `ensure_chunk_size(time_series, total_memory=None, chunk_size=None, chunk_memory=None, chunk_duration=None, n_jobs=1, **other_kwargs)`, `divide_segment_into_chunks(num_frames, chunk_size)`, `divide_time_series_into_chunks(recording, chunk_size)`, `chunk_duration_to_chunk_size(chunk_duration, time_series)`. Not re-exported from `spikeinterface.core.__init__`: `divide_segment_into_chunks`, `divide_time_series_into_chunks`, `chunk_duration_to_chunk_size` (import them from `spikeinterface.core.job_tools`).

`n_jobs` sentinel semantics (from `fix_job_kwargs` / `ensure_n_jobs`):
- `-1` → `os.cpu_count()`.
- negative `n_jobs` → `os.cpu_count() + 1 + n_jobs` (so `-2` = all but one core, etc.).
- float `n_jobs` in `(0, 1]` → `int(n_jobs * os.cpu_count())`.
- `0` or `None` → treated as `1` in `ensure_n_jobs`; `fix_job_kwargs` asserts non-zero.
- On Windows, values above `61` are clipped to `61` (ProcessPoolExecutor limit).
- Final value is clipped to `os.cpu_count()` and `>= 1`.

### Example

```python
import spikeinterface as si
import spikeinterface.core as sc

# global setup (once per session)
si.set_global_job_kwargs(n_jobs=4, chunk_duration="1s", progress_bar=True)

# merge runtime job_kwargs with the globals
job_kwargs = sc.fix_job_kwargs(dict(n_jobs=-1, chunk_memory="500M"))

# split mixed kwargs
specific_kwargs, job_kwargs = sc.split_job_kwargs(dict(method="mad", n_jobs=2, chunk_duration="500ms"))
```
