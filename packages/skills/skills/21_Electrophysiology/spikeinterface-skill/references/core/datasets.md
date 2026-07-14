# Datasets — datasets.py
Source in repo: `spikeinterface/src/spikeinterface/core/datasets.py`
Parent index: [INDEX.md](INDEX.md)
Related: [globals.md](globals.md), [generate.md](generate.md)
---

## 7. Datasets — `datasets.py`

```python
def download_dataset(
    repo: str = "https://gin.g-node.org/NeuralEnsemble/ephy_testing_data",
    remote_path: str = "mearec/mearec_test_10s.h5",
    local_folder: Path | None = None,
    update_if_exists: bool = False,
) -> Path:
```
The only public function of this module. Uses `datalad` + `pooch` under the hood; returns the local path to the downloaded dataset.

Note: the ticket mentioned an `unlock` argument — it is not in the current signature.
