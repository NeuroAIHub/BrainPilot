# PaperOrchestra-inspired writing

Experimental native TypeScript/Pi port of PaperOrchestra's default PlotOff path:
outline → literature discovery/verification and Introduction/Related Work → complete
LaTeX draft → three-reviewer evaluation and automatic whole-paper refinement → one
formatting pass → final editable LaTeX and compiled PDF.

Provide a workspace research-material directory with `idea_sparse.md` and
`experimental_log.md`, plus a LaTeX-template directory with `template.tex` and
`guidelines.md`. Existing figures and supporting template files are copied into
the run. Optional PaperBanana plot generation is not enabled in this first port.

All stages use the current session's Pi model. The model must support image
inputs for PDF-page review; `pdflatex`, `bibtex`, `pdftotext` and `pdftoppm` must
be available in the host. Literature retrieval uses BrainPilot's enabled paper
library and configured Tavily search/extract tools. Library metadata supports
citations directly when title, authors, abstract and date are available. Web
candidates require retrieved source-page evidence; source failures and uncertain
metadata remain explicit. No Semantic Scholar key is required.

The paper library follows the session's domain-resource mode and
`search_papers_local` toggle, including the hosted `neuro_sci_papersearch`
connector when configured. Tavily uses the existing MCP configuration/BYOK; the
workflow adds no separate credential store. A disabled or unavailable source may
be complemented by the other. Source records, retrieval time and evidence hashes
are retained alongside the bibliography.
The original prompts are retained with their knowledge-isolation/anonymity tail;
only necessary transport and tool adaptations are recorded in `UPSTREAM.md`.

The workflow automatically writes and reviews a manuscript. Retained fallback
output can still be an incomplete draft; check the reported issues and sources. There is no added
sentence-level approval step, revisionSet or source-hash approval gate.

Installation is disabled by default. Enabling permits the Principal to choose
this workflow for a complete manuscript task; ordinary questions, short reports
and local edits use ordinary capabilities. Disabling prevents new runs and lets
accepted work finish. Session Stop cancels active work and preserves produced files.

The current plugin settings require an explicitly declared single-user host.
Shared/per-user Docker and undeclared external runtimes remain unsupported.
The workflow is native TypeScript/Pi. It reuses existing external MCP tools; no
separate workflow protocol, service or plugin-specific model is used.

Method: https://github.com/google-research/paper-orchestra
Reference commit: ca1b3fa01c2970fc7cda32d16245db38d57b3f56.
PaperOrchestra is Apache-2.0; BrainPilot's host integration is AGPL-3.0-only.
See the runtime's PAPERORCHESTRA_LICENSE and THIRD_PARTY_NOTICES.md.
