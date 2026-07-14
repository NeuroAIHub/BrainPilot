# Overview: public exports and quick example
Source in repo: `spikeinterface/src/spikeinterface/comparison/__init__.py`
Parent index: [INDEX.md](INDEX.md)
---

## Public exports

From `spikeinterface/comparison/__init__.py`:

```python
from .comparisontools import (
    count_matching_events,
    compute_agreement_score,
    count_match_spikes,
    make_agreement_scores,
    make_possible_match,
    make_best_match,
    make_hungarian_match,
    do_score_labels,
    compare_spike_trains,
    do_confusion_matrix,
    do_count_score,
    compute_performance,
    do_count_event,
    make_match_count_matrix,
)
from .paircomparisons import (
    compare_two_sorters,
    SymmetricSortingComparison,
    compare_sorter_to_ground_truth,
    GroundTruthComparison,
    compare_templates,
    TemplateComparison,
)
from .multicomparisons import (
    compare_multiple_sorters,
    MultiSortingComparison,
    compare_multiple_templates,
    MultiTemplateComparison,
)

from .groundtruthstudy import GroundTruthStudy
from .collision import CollisionGTComparison
from .correlogram import CorrelogramGTComparison
```

Note: `comparison/__init__.py` does **not** export `AgreementSortingExtractor`,
`AgreementSortingSegment`, `BaseComparison`, `BaseMultiComparison`,
`BasePairComparison`, `BasePairSorterComparison`, `MixinSpikeTrainComparison`,
or `MixinTemplateComparison`. They are used internally (and returned from
`MultiSortingComparison.get_agreement_sorting`), so they can still be
imported from their submodules. There are no `hybrid` helpers in this
module.

---

## Quick example

`GroundTruthComparison` typical usage (compare a sorter output against a
ground-truth sorting):

```python
from spikeinterface.comparison import compare_sorter_to_ground_truth

cmp_gt = compare_sorter_to_ground_truth(
    gt_sorting=gt_sorting,
    tested_sorting=tested_sorting,
    gt_name="ground_truth",
    tested_name="my_sorter",
    delta_time=0.4,            # ms tolerance for coincident spikes
    match_score=0.5,           # min agreement to match units
    well_detected_score=0.8,   # threshold for "well detected" units
    redundant_score=0.2,
    overmerged_score=0.2,
    chance_score=0.1,
    exhaustive_gt=False,       # set True if GT contains all units in the recording
    agreement_method="count",  # "count" | "distance"
    match_mode="hungarian",    # "hungarian" | "best"
    compute_labels=False,
    compute_misclassifications=False,
    verbose=False,
)

# performance per GT unit
perf_by_unit = cmp_gt.get_performance(method="by_unit", output="pandas")
# averaged over units
perf_avg = cmp_gt.get_performance(method="pooled_with_average")

# raw confusion matrix
conf = cmp_gt.get_confusion_matrix()

# categorised unit counts (requires exhaustive_gt=True for the extra columns)
well = cmp_gt.get_well_detected_units(well_detected_score=0.8)
fp = cmp_gt.get_false_positive_units()
redundant = cmp_gt.get_redundant_units()
overmerged = cmp_gt.get_overmerged_units()
bad = cmp_gt.get_bad_units()

cmp_gt.print_performance(method="pooled_with_average")
cmp_gt.print_summary()
```
