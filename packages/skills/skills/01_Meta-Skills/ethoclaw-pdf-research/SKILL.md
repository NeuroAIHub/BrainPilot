---
name: ethoclaw-pdf-research
description: "Read local PDF files for analysis, summarization, and research-note generation. Use when the user uploads a PDF or provides a local PDF path and wants the model to inspect reports, papers, whitepapers, slides, or scanned documents by extracting text, rendering page images, and producing a structured summary or research log."
---

# EthoClaw PDF Research Reader

Use scripts first. Prefer a two-path workflow: extract text for speed, inspect rendered page images when formatting is important or the PDF is scan-heavy.

## Interaction rule

Do not parse a newly received PDF immediately by default.

When the user uploads a PDF without a clear output request, first confirm what they want:

- short summary
- detailed analysis
- research log returned directly in chat
- markdown file only if explicitly requested
- page/section/figure-focused reading

Only start parsing after the user confirms the desired output.

Exception: if the user already asked for a specific output together with the file or path, treat that as confirmation and proceed directly.

## Quick start

Prepare an analysis bundle:

```bash
python3 scripts/extract_pdf_bundle.py /path/to/file.pdf \
  --output-dir /tmp/pdf_bundle \
  --text-last-page 0 \
  --render-last-page 8
```

If the user explicitly wants markdown files, generate both deliverables:

```bash
python3 scripts/build_markdown_deliverables.py \
  /tmp/pdf_bundle/manifest.json \
  --output-dir /tmp/pdf_bundle/md
```

If the user explicitly wants only a research-log file:

```bash
python3 scripts/build_research_log.py \
  /tmp/pdf_bundle/manifest.json \
  --output /tmp/pdf_bundle/research-log.md
```

## Workflow

1. Resolve the source PDF.
   - If the user uploaded a file, use the local file path provided by the runtime.
   - If the user gave a path, validate that it exists before proceeding.
2. Check whether the user already specified the output.
   - If yes, proceed directly.
   - If no, ask a short confirmation question before parsing.
   - Read `references/confirmation-prompts.md` for the default phrasing.
3. After confirmation, run `scripts/extract_pdf_bundle.py`.
   - This produces `manifest.json`, `document.txt`, and rendered PNG page previews.
4. Read `manifest.json` first.
   - Check page count, extracted-text size, and rendered image paths.
5. Read `document.txt` for the main pass.
   - Use this for normal text PDFs, reports, and most academic papers.
6. If the extracted text is sparse, garbled, or loses key layout, inspect the PNG pages directly.
   - Read the first pages for title/abstract/executive summary.
   - Read result-heavy or conclusion-heavy pages when needed.
7. Produce the requested output.
   - Default: return the summary or research log directly in chat.
   - For a plain summary: give topic, core argument, evidence, conclusions, caveats.
   - For a research log: write the full research log directly in chat unless the user explicitly asked for a file.
   - Only generate markdown files when the user explicitly asks for markdown, wants a reusable local artifact, or needs the result saved for later editing.
   - If markdown files are requested, use `build_markdown_deliverables.py` or `build_research_log.py` as scaffolding helpers, then fill the sections with actual findings.

## Script behavior

### `scripts/extract_pdf_bundle.py`

- Read PDF metadata via `pdfinfo`
- Extract text with `pdftotext -layout`
- Render selected pages to PNG via `pdftoppm`
- Write a reusable bundle for later reading:
  - `manifest.json`
  - `document.txt`
  - `images/page-XXXX.png`

Important flags:

- `--text-last-page 0`: read all pages as text
- `--render-last-page N`: render the first N pages for visual inspection
- `--dpi 144`: default PNG quality; raise it if formulas or small print are hard to read
- `--clean`: replace an existing output directory

### `scripts/build_research_log.py`

- Convert `manifest.json` into a markdown note scaffold
- Keep source paths and reading instructions in the log
- Use it when the user explicitly wants a research log, reading note, or reusable markdown artifact
- Do not stop at the empty scaffold; fill the sections with actual findings after reading the PDF bundle

### `scripts/build_summary_md.py`

- Convert `manifest.json` into a short markdown summary scaffold
- Use it when the user wants a concise deliverable or when you want a companion file next to the research log

### `scripts/build_markdown_deliverables.py`

- Create both `summary.md` and `research-log.md` in one step
- Use it as the default markdown-deliverable generator after the user confirms they want markdown output

## Heuristics

- Prefer text first for normal reports and papers.
- Prefer image inspection when the PDF is scanned, multi-column extraction is messy, or tables/figures matter more than raw prose.
- For very long PDFs, do not read every rendered page by default. Start with:
  - title / abstract / executive-summary pages
  - table-of-contents page if it helps navigation
  - conclusion / discussion pages
  - result figures or tables requested by the user
- If the user asks for deep extraction of a specific section, rerun the script with a tighter page range rather than rendering the whole file at high DPI.

## Notes

- The current version relies on local command-line tools already available on the host: `pdfinfo`, `pdftotext`, and `pdftoppm`.
- This skill does not perform OCR beyond what the local PDF/text tools can recover. For image-only scans, rely on rendered PNG pages and vision-capable analysis.
- Keep external writes minimal. Most tasks can be completed locally inside the workspace.

## References

- Read `references/confirmation-prompts.md` when a PDF arrives without a clear requested output.
- Read `references/output-patterns.md` for compact output shapes and suggested summary formats.
