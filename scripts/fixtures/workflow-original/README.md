# Original-pipeline acceptance fixtures

TEST ONLY. These notes, numerical values, manuscript text and publication
metadata are synthetic software fixtures. They establish no scientific result
or writing-quality score.

`scripts/workflow-original-acceptance.mjs` uses the default registered writing
workflow, real SessionManager/WorkflowHost ownership, and real native TeX/PDF
tools on the designated 208 Linux host. It mocks every model session and every
Semantic Scholar response and blocks other fetch traffic.

The default upstream PlotOff input shape is preserved: `raw_materials_dir` and
`latex_template_dir`, with idea/log documents, template/guidelines, and an empty
`figures/info.json`. No artificial PDF or PNG bytes are supplied; all PDF and
page-image evidence must be produced by the real host tools.

The scripted reviewer scores are 5 → 6 → 6 → 5. The first content revision is
accepted, the second is accepted after a sub-axis improvement, and the third is
rejected. One formatting repair follows. Each evaluation uses three mock
reviewers plus a mock meta-review whose deliberately different scores must be
replaced by the reviewer-score means.

Run only after building on 208, with a new task-owned output directory:

```sh
node scripts/workflow-original-acceptance.mjs --output /tmp/brainpilot-original-unique
```
