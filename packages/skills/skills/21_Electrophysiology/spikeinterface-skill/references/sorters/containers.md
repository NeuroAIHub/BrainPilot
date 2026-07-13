# Container support (Docker / Singularity)

Source in repo: `spikeinterface/src/spikeinterface/sorters/container_tools.py`
Parent index: [INDEX.md](INDEX.md)
---

Images live on Docker Hub under the `spikeinterface` organization
(`REGISTRY = "spikeinterface"`). Mapping in `runsorter.py`:

```python
SORTER_DOCKER_MAP = dict(
    combinato="combinato",
    herdingspikes="herdingspikes",
    kilosort4="kilosort4",
    mountainsort4="mountainsort4",
    mountainsort5="mountainsort5",
    pykilosort="pykilosort",
    rtsort="rtsort",
    spykingcircus="spyking-circus",
    spykingcircus2="spyking-circus2",
    tridesclous="tridesclous",
    tridesclous2="tridesclous2",
    hdsort="hdsort-compiled",
    ironclust="ironclust-compiled",
    kilosort="kilosort-compiled",
    kilosort2="kilosort2-compiled",
    kilosort2_5="kilosort2_5-compiled",
    kilosort3="kilosort3-compiled",
    waveclus="waveclus-compiled",
    waveclus_snippets="waveclus-compiled",
)
SORTER_DOCKER_MAP = {k: f"{REGISTRY}/{v}-base" for k, v in SORTER_DOCKER_MAP.items()}
```

Sorters NOT in this map (`simple`, `lupin`, `klusta`, `yass`) cannot use `docker_image=True`;
supply an explicit image string if you have one.

`ContainerClient(mode, container_image, volumes, py_user_base_unix, extra_kwargs)` and
`install_package_in_container(container_client, package_name, installation_mode, ...)` (from
`spikeinterface.sorters.container_tools`) are the low-level helpers used to start containers,
mount volumes, and install SpikeInterface / dependencies inside them.
