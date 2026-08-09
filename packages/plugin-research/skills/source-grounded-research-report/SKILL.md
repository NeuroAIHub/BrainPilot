---
name: source-grounded-research-report
description: Research a bounded factual, documentation, API, or literature question from authoritative sources and save a self-contained Markdown report with claim-level citations. Use for reading-heavy evidence gathering, not experiment execution or data analysis.
---

# Source-Grounded Research Report

Define the bounded question and the claims the report must support. Match each
claim to the source that owns or best synthesizes it: official documentation,
versioned source code, specifications, or first-party APIs for implementation
facts; original studies and official implementations for method details;
official datasets or benchmark reports for benchmark facts; and rigorous reviews,
meta-analyses, or authoritative guidelines for synthesis claims. Search snippets
and unverified summaries are discovery leads, not final evidence.

Use `literature-scout`, `api-librarian`, or `evidence-extractor` for independent
reading slices. For a compact task, one child may research and write the report
with `workspaceMode: "shared"`. For parallel research, collect the evidence
packets, then designate one shared-workspace child or yourself to synthesize the
canonical report. Retain child ids and collect every result before synthesis.

Save one self-contained Markdown report under `docs/reports/` or the task's
explicit path. For every decision-relevant claim, record an inspectable source
and exact supporting location; distinguish direct evidence, synthesis, and
inference; reconcile contradictions; and mark unresolved claims `unverified`.
Supporting extracts may remain separate only when the report links them exactly.

Review the report before handoff. Send suspected errors, ambiguities, missing
support, or interpretation questions back to the report author with the exact
path and claim, and require a revision or an explicit unresolved limitation.
Return the canonical report path in `complete_task`; the completion reply is only
an orienting summary.
