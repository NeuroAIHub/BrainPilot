---
name: markdown-report-writing
description: Guide AI agents to write beautifully formatted, well-illustrated Markdown reports with proper structure, diagrams, and compatibility across GitHub and Obsidian. Use this skill whenever the user asks you to write a report, project documentation, experiment report, README, technical document, or any long-form Markdown content. Also trigger when users mention Markdown formatting, Mermaid diagrams, report templates, or document publishing.
---

# Markdown Report Writing

Provide expert guidance for writing professional, visually polished Markdown reports that render correctly on both GitHub and Obsidian.

## Core Philosophy: Three-Layer Writing Model

When writing any Markdown report, think in three layers:

1. **Content layer** — Use CommonMark / GFM + Obsidian shared syntax for all headings, paragraphs, lists, images, tables, code blocks, footnotes, task lists, math ($\LaTeX$), and Mermaid diagrams. This is your foundation.
2. **Enhancement layer** — Add renderer-specific features only when necessary: GitHub `<details>` folding, relative links; Obsidian `[[wikilink]]`, `![[embed]]`, Callout, `cssclasses`.
3. **Build layer** — For complex layouts, table of contents generation, site styling, and slide exports, delegate to Pandoc / Quarto / MkDocs / GitHub Pages.

This ensures your output is readable, portable, automatable, and version-controllable across all target environments.

## Writing Principles

Follow these rules for every report:

1. **Shared syntax first** — Build the body with syntax that works on both GitHub and Obsidian (headings, links, images, tables, code blocks, footnotes, task lists, Mermaid, math).
2. **Relative paths for all assets** — Place images, diagrams, and attachments in `assets/` and reference them with relative paths.
3. **Enhance per target** — After the core is solid, add renderer-specific enhancements:
   - **GitHub**: relative links, section anchors, `<details>`, Mermaid
   - **Obsidian**: wikilink, embed, callout, cssclasses
   - **Web/PDF/Slides**: delegate to Pandoc / Quarto / MkDocs
4. **Don't nest Markdown in HTML** — GitHub strips custom HTML attributes; Obsidian won't parse Markdown inside HTML blocks. Use Markdown tables for side-by-side layouts instead of `<div>` flexboxes.
5. **Mermaid first for diagrams** — GitHub and Obsidian both render Mermaid natively. For complex UML, generate PlantUML SVG first, then embed.
6. **Every figure needs alt text and a caption** — Every code block must declare its language.
7. **Every long document must have**: executive summary, table of contents (or equivalent navigation), figures with captions, and a conclusion / next-steps section.

## Quality Checklist

After generating any report, verify:

- [ ] All code blocks have language identifiers
- [ ] All images have alt text and captions
- [ ] All links use relative paths (no absolute paths to local files)
- [ ] Table of contents is present (for documents with 3+ sections)
- [ ] Mermaid diagrams render correctly
- [ ] Footnotes are properly paired (marker + definition)
- [ ] No complex Markdown trapped inside HTML blocks

## Standard Document Skeleton

Start every report with this upgradeable structure:

```md
---
title: Project Name
author: Team / Agent Name
date: YYYY-MM-DD
tags: [tag1, tag2]
---

# Project Name

> One-line summary: what problem this solves and what the conclusion is.

## Executive Summary

3-6 sentences covering background, approach, results, and conclusions.

## Background

Problem statement, context, and boundaries.

## Methods / Approach

Solution design, workflow, data, experimental conditions.

## Results

- Key finding A
- Key finding B
- Key finding C

## Conclusion / Next Steps

## Appendix & References

- [Raw data](./data/raw.csv)
- [Diagrams](./assets/fig-overview.svg)
- [Supplementary docs](./docs/appendix.md)
```

## Layout & Typesetting Techniques

### Images and Figures

Always provide alt text. Use SVG for diagrams, PNG/WebP for screenshots:

```md
![System architecture diagram](./assets/fig-system-architecture.svg)
*Figure: Overall system architecture.*

[View full-size SVG](./assets/fig-system-architecture.svg)
```

### Side-by-Side Layout (Cross-Platform Safe)

Use **two-column Markdown tables** as your grid system — this is the only approach that works reliably on both GitHub and Obsidian:

```md
| Overview | Key Points |
|---|---|
| ![System overview](./assets/fig-overview.svg) | - 4 modules<br>- 12 interfaces<br>- Risk: data sync |
```

Avoid `<div style="display:flex">` — styles get stripped on GitHub and block Markdown parsing on Obsidian.

### Tables

Always use standard Markdown tables. Escape `|` inside cells with `\|`:

```md
| Metric | Value | Notes |
|:--|--:|:--|
| Accuracy | 92.4% | Main model |
| Link to doc | [Appendix](./docs/appendix.md) | See details |
```

### Code Blocks

Always declare the language for syntax highlighting:

```md
​```python
def evaluate(x: float) -> float:
    return x ** 2 + 1
​```
```

### Mermaid Diagrams

Use fenced code blocks — both GitHub and Obsidian render them natively:

```md
​```mermaid
flowchart LR
    Data[Data Input] --> Clean[Cleaning]
    Clean --> Analyze[Analysis]
    Analyze --> Report[Report Output]
​```
```

### Math Expressions

Both GitHub and Obsidian support $\LaTeX$ via MathJax:

```md
Inline: $E = mc^2$

Block:
$$
\operatorname{F1} = \frac{2PR}{P+R}
$$
```

### Task Lists and Collapsible Sections

```md
- [x] Requirements confirmed
- [x] Data collected
- [ ] Charts reviewed
- [ ] Document published

<details>
<summary>Click to expand technical details</summary>

Keep content here plain text or simple HTML.
Avoid complex Markdown (lists, tables, formulas) inside
if the target includes Obsidian.

</details>
```

### Footnotes

Use for citations, terminology, and data sources:

```md
There is a term that needs explanation[^term].

[^term]: This is where the explanation or citation goes.
```

## Report Templates

### 1. Project Report

Use when reporting project status, milestones, architecture decisions, risks, and next steps.

Required sections: Executive Summary → Background → Scope → Architecture & Design → Current Progress → Risks & Mitigation → Conclusion & Next Steps → Appendix.

Include: a system architecture diagram (Mermaid), a progress table with status per task, a risk matrix table, and a task checklist for next steps.

### 2. Experiment Report

Use when documenting experiments, A/B tests, benchmarks, or research findings.

Required sections: Executive Summary → Research Questions & Hypotheses → Experimental Setup → Variables → Procedure → Results → Discussion → Reproducibility → Conclusion.

Include: an environment/config table, a variables table (independent, dependent, controlled), a results comparison table, a results chart, and links to scripts/configs/raw data for reproducibility.

### 3. README

Use for repository introductions and project documentation.

Required sections: Project Name & tagline → Quick-start links → Description → Features → Project Structure → Quick Start (install, run, example) → Usage (with Mermaid flow) → Documentation links → Roadmap → Contributing → License.

See `references/templates.md` for full expanded templates with annotations.

## Choosing Tools for the Job

| Goal | Primary Tool | Agent Should Output |
|---|---|---|
| Repo README / project report | Pure GFM + Mermaid | `.md` + `assets/*.svg` |
| Experiment report / PDF export | Quarto | `.qmd` or enhanced `.md` → export HTML/PDF |
| Documentation site | MkDocs Material | `docs/` directory + nav config |
| Diagrams | Mermaid (first), PlantUML (UML) | `*.mmd` / `*.puml` source + rendered `*.svg` |
| Math rendering on web | MathJax | HTML site with math rendering layer |
| Local editing & export | Typora | Preview → export HTML/PDF |
| Slides / presentation | Quarto Revealjs or Pandoc | `.qmd` or `.md` → rendered slides |

### Rendering Commands

```bash
# Mermaid → SVG
mmdc -i diagrams/flow.mmd -o assets/flow.svg

# PlantUML → SVG
java -jar plantuml.jar --svg diagrams/architecture.puml

# Pandoc → HTML / PDF / Revealjs
pandoc report.md -o report.html
pandoc report.md -o report.pdf
pandoc -t revealjs -s slides.md -o slides.html

# Quarto → HTML / Website / Revealjs
quarto render report.qmd --to html
quarto render report.qmd --to pdf
quarto render slides.qmd --to revealjs
```

## File & Asset Management

Organize project files with this directory structure:

```text
project/
├── README.md
├── reports/
│   ├── project-report.md
│   └── experiment-report.md
├── docs/
│   ├── index.md
│   └── appendix.md
├── assets/
│   ├── figures/
│   │   ├── fig-system-architecture.svg
│   │   └── fig-results-comparison.svg
│   ├── screenshots/
│   │   └── screenshot-dashboard-home.png
│   └── generated/
│       ├── flow-overview.svg
│       └── gantt-plan.svg
├── diagrams/
│   ├── flow-overview.mmd
│   └── architecture.puml
├── data/
│   ├── raw/
│   └── processed/
└── .github/workflows/
    └── docs-check.yml
```

**Naming conventions**: lowercase, hyphen-separated, semantic prefixes (`fig-` for figures, `tbl-` for tables, `exp-` for experiment data, `shot-` for screenshots, `flow-` for flowcharts). Keep both **source files** (`*.mmd`, `*.puml`) and **derived files** (`*.svg`) for version control and CI regeneration.

## CI Quality Pipeline

Include these 4 checks for long-lived documentation:

1. **Lint Markdown** — `markdownlint-cli2 "**/*.md"`
2. **Check TOC freshness** — `doctoc --dryrun .`
3. **Check links** — `lychee --verbose --no-progress "**/*.md"`
4. **Render diagrams** — `mmdc -i diagrams/*.mmd -o assets/generated/`

## Quick Reference: Per-Environment Differences

| Situation | GitHub Approach | Obsidian Approach |
|---|---|---|
| Internal links | Relative paths (auto-branch-aware) | `[[wikilink]]` or Markdown links |
| Embedding content | Standard `![alt](path)` | `![[file.svg\|700]]` |
| Collapsible sections | `<details><summary>` (safe) | Heading folding or Callout |
| Custom styling | Not available in repo `.md` | CSS Snippets + `cssclasses` frontmatter |
| Slides | Not native | `---` separated slides in note |
| Dynamic views | Not in repo `.md` | Dataview plugin queries |

## References

- `references/templates.md` — Full annotated templates for project reports, experiment reports, and README files
- `references/compatibility-matrix.md` — Detailed compatibility table for GitHub vs Obsidian features