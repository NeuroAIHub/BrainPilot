# Event extractors
Source in repo: `spikeinterface/src/spikeinterface/extractors/neoextractors/` (openephys.py, alphaomega.py, maxwell.py, plexon2.py, spikeglx.py)
Parent index: [INDEX.md](INDEX.md)
---

Event extractors expose a `BaseEvent` interface. All Neo-based event extractors set a class-level `NeoRawIOClass` attribute; some also set `handle_event_frame_directly = True` on the class (AlphaOmega). Neo events use the structured dtype:

```python
_neo_event_dtype = np.dtype([("time", "float64"), ("duration", "float64"), ("label", "<U100")])
```

## `read_openephys_event(folder_path, experiment_name=None, block_index=None)`

Function in `neoextractors/openephys.py` (not a wrapper — a real Python function that auto-detects the format then instantiates `OpenEphysBinaryEventExtractor`).

Full signature (verbatim):

```python
def read_openephys_event(folder_path, experiment_name=None, block_index=None):
```

- `experiment_name`: e.g. `"experiment1"`, `"experiment2"`; mutually exclusive with `block_index`.
- Legacy-format folders raise: events can be read only from the "binary" format.

Class `OpenEphysBinaryEventExtractor`:

```python
class OpenEphysBinaryEventExtractor(NeoBaseEventExtractor):
    NeoRawIOClass = "OpenEphysBinaryRawIO"

    def __init__(self, folder_path, experiment_name=None, block_index=None):

    @classmethod
    def get_available_experiments(cls, folder_path):
        # returns e.g. ["experiment1", "experiment2"]
```

If multiple experiments exist and neither `experiment_name` nor `block_index` is set, a `ValueError` is raised listing available experiments.

## `read_alphaomega_event(folder_path)`

Class: `AlphaOmegaEventExtractor` in `neoextractors/alphaomega.py`. Reads events from AlphaOmega MPX files.

Full signature (verbatim):

```python
class AlphaOmegaEventExtractor(NeoBaseEventExtractor):
    NeoRawIOClass = "AlphaOmegaRawIO"
    handle_event_frame_directly = True

    def __init__(self, folder_path):
```

## `read_maxwell_event(file_path)`

Class: `MaxwellEventExtractor` in `neoextractors/maxwell.py`. Reads TTL events from Maxwell `.h5` files (not Neo-based — uses `h5py` directly).

Full signature (verbatim):

```python
class MaxwellEventExtractor(BaseEvent):
    def __init__(self, file_path):
```

Only version `20160704` is currently supported (`NotImplementedError` otherwise). Sampling rate is hard-coded to `20000`. Event dtype:

```python
_maxwell_event_dtype = np.dtype([("frame", "int64"), ("state", "int8"), ("time", "float64")])
```

with `state` set to `-1` for off transitions.

## `read_plexon2_event(folder_path, block_index=None, use_names_as_ids=False)`

Class: `Plexon2EventExtractor` in `neoextractors/plexon2.py`.

Full signature (verbatim):

```python
class Plexon2EventExtractor(NeoBaseEventExtractor):
    NeoRawIOClass = "Plexon2RawIO"

    def __init__(self, folder_path, block_index=None, use_names_as_ids=False):
```

- `use_names_as_ids`: use channel names as ids (they must be unique).

## `read_spikeglx_event(folder_path, block_index=None)`

Function in `neoextractors/spikeglx.py`. Class: `SpikeGLXEventExtractor`.

Full signatures (verbatim):

```python
class SpikeGLXEventExtractor(NeoBaseEventExtractor):
    NeoRawIOClass = "SpikeGLXRawIO"

    def __init__(self, folder_path, block_index=None):


def read_spikeglx_event(folder_path, block_index=None):
```

Reads events saved on the SpikeGLX event channel.
