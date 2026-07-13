# Agreement matching strategies
Source in repo: `spikeinterface/src/spikeinterface/comparison/basecomparison.py`
Parent index: [INDEX.md](INDEX.md)
---

Three strategies are computed automatically for each pair comparison
(`BasePairComparison._do_matching`), driven by the `agreement_scores`
matrix:

1. **`possible_match`** — via `make_possible_match(agreement_scores, min_score=chance_score)`.
   For every unit, list of counterpart units with score `>= chance_score`.
2. **`best_match`** — via `make_best_match(agreement_scores, min_score=chance_score)`.
   For every unit, the single counterpart with the highest score, provided it
   is `>= chance_score`. Symmetric.
3. **`hungarian_match`** — via `make_hungarian_match(agreement_scores, min_score=match_score)`.
   Optimal one-to-one assignment using `scipy.optimize.linear_sum_assignment`,
   with entries below `match_score` dropped (`-1` for integer unit ids,
   `""` for string / object unit ids).

Each strategy returns a `(match_12, match_21)` pair (`pd.Series` for best and
hungarian, `dict[str, np.ndarray]` for possible). All are exposed as
attributes on the comparison object.

`GroundTruthComparison.match_mode` selects which of the two mappings
(`"hungarian"` or `"best"`) is used when computing `count_score` and the
confusion matrix. Label computation (`_do_score_labels`) requires
`match_mode="hungarian"`.

Agreement score computation itself has two methods (via `agreement_method`):
- `"count"` — from spike coincidence counts (`make_match_count_matrix` +
  `make_agreement_scores_from_count`).
- `"distance"` — from spike-time distance functions
  (`calculate_agreement_scores_with_distance`).
