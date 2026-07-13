# Package Exports

Source in repo: `spikeinterface/src/spikeinterface/benchmark/__init__.py`
Parent index: [INDEX.md](INDEX.md)
---

## Package Exports

The top-level `spikeinterface.benchmark` package (from `spikeinterface/benchmark/__init__.py`) re-exports:

```python
from spikeinterface.benchmark import (
    analyse_residual,
    make_residual_recording,
    SorterStudy,
    SorterStudyWithoutGroundTruth,
)
```

All other study classes (`PeakDetectionStudy`, `PeakLocalizationStudy`, `UnitLocalizationStudy`, `PeakSelectionStudy`, `ClusteringStudy`, `MatchingStudy`, `MergingStudy`, `MotionEstimationStudy`, `MotionInterpolationStudy`) plus base classes (`Benchmark`, `BenchmarkStudy`, `MixinStudyUnitCount`) live in the sub-modules and can be imported with fully qualified names, e.g.

```python
from spikeinterface.benchmark.benchmark_base import Benchmark, BenchmarkStudy
from spikeinterface.benchmark.benchmark_matching import MatchingStudy
from spikeinterface.benchmark.benchmark_peak_detection import PeakDetectionStudy
from spikeinterface.benchmark.benchmark_clustering import ClusteringStudy
from spikeinterface.benchmark.benchmark_merging import MergingStudy
from spikeinterface.benchmark.benchmark_motion_estimation import (
    MotionEstimationStudy, get_gt_motion_from_unit_displacement,
)
from spikeinterface.benchmark.benchmark_motion_interpolation import MotionInterpolationStudy
```
