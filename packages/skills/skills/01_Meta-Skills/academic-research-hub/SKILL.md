---
name: academic-research-hub
description: "Use this skill when users need to search academic papers, download research documents, extract citations, or gather scholarly information. Triggers include: requests to \"find papers on\", \"search research about\", \"download academic articles\", \"get citations for\", or any request involving academic databases like arXiv, PubMed, Semantic Scholar, or Google Scholar. Also use for literature reviews, bibliography generation, and research discovery."
license: Proprietary
layer: base
skill_type: tool
dependencies:
  - multi-search-engine
---
# Academic Research Hub

## Overview

Academic Research Hub provides unified access to multiple academic databases (arXiv, PubMed, Semantic Scholar, etc.) for searching papers, downloading PDFs, extracting citations, and generating bibliographies. It is the recommended tool for literature review and reference management in NeuroClaw.

**Prerequisite:** Install [OpenClawCLI](https://clawhub.ai/) (Windows, MacOS)

## Installation

**Best Practices:**

```bash
# Standard installation
pip install arxiv scholarly pubmed-parser semanticscholar requests

# If you encounter permission errors, use a virtual environment
python -m venv venv
source venv/bin/activate   # On Windows: venv\Scripts\activate
pip install arxiv scholarly pubmed-parser semanticscholar requests
```

**Never use `--break-system-packages`** as it can damage your system's Python installation.

## Quick Reference

| Task                    | Command                                              |
|-------------------------|------------------------------------------------------|
| Search arXiv            | `python scripts/research.py arxiv "quantum computing"` |
| Search PubMed           | `python scripts/research.py pubmed "covid vaccine"`  |
| Search Semantic Scholar | `python scripts/research.py semantic "machine learning"` |
| Download papers         | `python scripts/research.py arxiv "topic" --download` |
| Get citations           | `python scripts/research.py arxiv "topic" --citations` |
| Generate bibliography   | `python scripts/research.py arxiv "topic" --format bibtex` |
| Save results            | `python scripts/research.py arxiv "topic" --output results.json` |

## Core Features

- Multi-source search (arXiv, PubMed, Semantic Scholar, Google Scholar)
- Full-text PDF download
- Citation extraction (BibTeX, RIS, JSON, plain text)
- Comprehensive metadata retrieval (title, authors, abstract, DOI, citation count, etc.)

## When to Call This Skill

- Need to search for recent papers on a specific topic
- Build literature reviews or bibliographies
- Download PDFs for local reading
- Extract citations for `paper-writing`
- Use inside `research-idea` or `method-design` workflows

## Benchmark Adapter Guidance

Use this skill as the preferred retrieval backbone for benchmark-style academic search tasks, but do not reimplement a full multi-source aggregator unless the task truly needs unsupported sources or an output schema the script does not emit directly.

- Reuse `scripts/research.py` first for the sources it already supports: `arxiv`, `pubmed`, and `semantic`.
- Treat the script outputs as normalized retrieval inputs, then add only a thin adapter layer for:
	- benchmark-specific file naming and output directories,
	- light field renaming or schema normalization,
	- per-task date-window filtering,
	- source-level merge/dedup metadata,
	- degraded-run logging when one source is unavailable.
- Do not replace the whole workflow with a brand-new all-in-one crawler if the task can be satisfied by composing this skill with a small adapter.
- If a task requires an unsupported source such as OpenReview, keep this skill for the supported sources and implement only the missing source plus the final merge/export layer.
- Preferred pattern for benchmark tasks:
	1. call `research.py` separately for each supported source,
	2. cache or save raw source outputs,
	3. normalize to the benchmark schema,
	4. add unsupported sources only as narrow supplemental branches,
	5. export one final task-specific JSON artifact.

### Benchmark-Facing Default Mainline

For tasks like recent multi-platform paper search:

1. Use `research.py arxiv ... --output ...json`.
2. Use `research.py pubmed ... --output ...json`.
3. Use `research.py semantic ... --output ...json`.
4. Apply a thin adapter script to enforce:
	 - last-N-days filtering,
	 - newest-first sorting,
	 - benchmark key names such as `semantic_scholar`,
	 - task-level metadata and degraded status,
	 - final merged export path.
5. Add OpenReview only if the task explicitly requires it and keep failure there as an expected degraded branch rather than rebuilding the entire supported-source stack.

## Complementary / Related Skills

- `multi-search-engine` → general web/academic search

## Reference

- Official documentation and APIs: arXiv, PubMed, Semantic Scholar
- OpenClawCLI: https://clawhub.ai/

---
Created At: 2026-03-25 18:20 HKT  
Last Updated At: 2026-03-25 18:20 HKT  
Author: chengwang96