---
name: paper-writing
description: "Use this skill whenever the user wants to generate a full academic paper draft from existing research materials. Triggers include: 'write paper', 'generate manuscript', 'draft paper', 'paper-writing', 'hierarchical drafting', 'manuscript composer', 'create LaTeX paper', 'write research paper from IDEA METHOD EXPERIMENT', or any request to transform IDEA.md + METHOD.md + EXPERIMENT.md into a typeset-ready manuscript. This skill is the **mandatory interface-layer writer** in NeuroClaw: it strictly follows the hierarchical manuscript drafting and iterative refinement process (section 4.4 + provided flowchart), never generates the full paper in one shot, saves every intermediate step as a separate file, and produces either clean plain-text or LaTeX output."
license: MIT License (NeuroClaw custom skill – freely modifiable within the project)
layer: interface
skill_type: workflow
dependencies: []
---
# Paper Writing

## Overview
This skill implements the exact **Hierarchical Manuscript Drafting and Iterative Refinement** process described in section 4.4 of the NeuroClaw architecture and the accompanying flowchart.

It acts as the Manuscript Composer within an end-to-end multi-agent framework:
- Reads the latest versions of **IDEA.md**, **METHOD.md**, and **EXPERIMENT.md** from the current workspace (continuously updated by the related skills research-idea, method-design, and experiment-controller).
- If any of the three files are missing or empty, it immediately prompts the user to provide the research idea, experimental methods, and results before proceeding.
- First asks the user whether the final output should be **plain text (.md)** or **LaTeX (.tex)**.
- When LaTeX format is selected, it asks the user to provide a custom template file (e.g., `template.tex`). If none is supplied, it automatically uses the default IEEE template (conference or journal version with appropriate `\documentclass`, packages, and structure).
- When processing **EXPERIMENT.md**, if sufficient quantitative results are present (metrics, comparisons, ablation studies, numerical values, etc.), the skill automatically generates and inserts well-formatted tables (Markdown tables for plain-text mode; proper LaTeX `tabular` or `table` environment for LaTeX mode) into the Results and Discussion sections.
- Then executes the hierarchical flow **step by step** (never one-shot generation), saving the output of **every single step** as a separate Markdown file in the workspace root (e.g., 01_section_content.md, 02_ethics_review.md, ..., 10_final_draft.md). This enforces incremental execution and allows OpenClaw to resume or inspect progress at any stage.

The process preserves narrative coherence, reuses semantic anchors from previous sections, automatically generates figures from experimental logs, ensures ethical dataset citation, improves scientific storytelling, verifies cross-references, and applies self-healing compilation for LaTeX.

**Research use only** — the output is a high-quality draft ready for final human polishing and journal submission.

## Quick Reference (Hierarchical Flow)

| Step | Description | Output File |
|------|-------------|-------------|
| 1. Section Content Generation | Build each section from IDEA.md + METHOD.md + EXPERIMENT.md (auto-generate tables from results if data is sufficient) | 01_section_content.md |
| 2. Ethics Review | Verify dataset origin, license, and ethical approval | 02_ethics_review.md |
| 3. Iterative Optimization | Refine content based on previous sections | 03_iterative_optimization.md |
| 4. Narrative Storytelling | Convert technical content into coherent scientific story | 04_narrative_storytelling.md |
| 5. De-AI Polishing | Remove AI artifacts and improve natural academic tone | 05_de_ai_polishing.md |
| 6. Logic & Continuity Review | Ensure logical flow and cross-section consistency | 06_logic_continuity_review.md |
| 7. Length Control | Adjust section lengths to target journal limits | 07_length_control.md |
| 8. Reference Review & Repair | Verify and fix all citations and cross-references | 08_reference_review.md |
| 9. LaTeX Error Repair | (LaTeX only) Automatically correct compilation errors | 09_latex_error_repair.md |
| 10. Final Draft Generation | Produce and save the complete manuscript | 10_final_draft.md or 10_final_draft.tex |

## Installation
```bash
# Place files in: skills/paper-writing/
```

## Scripts

The `scripts/` directory contains reusable Python modules derived from [nature-skills](https://github.com/Yuan1z0825/nature-skills):

| File | Purpose |
|------|---------|
| [`scripts/nature_figure_style.py`](scripts/nature_figure_style.py) | Publication style rcParams, color palettes (`PALETTE`, `PALETTE_NMI_PASTEL`, etc.), and helper functions (`apply_publication_style`, `is_dark`, `add_panel_label`, `finalize_figure`) |
| [`scripts/figure_templates.py`](scripts/figure_templates.py) | Complete figure templates: grouped bar with legend panel, alpha-graduated ablation bar, multi-panel trend, dual-colormap heatmap |
| [`scripts/section_phrasebank.py`](scripts/section_phrasebank.py) | Section-specific move orders, phrase families, evidence strength verbs, and transition words for all manuscript sections |
| [`scripts/data_statement_templates.py`](scripts/data_statement_templates.py) | 12 Data Availability statement templates, anti-patterns to flag, and FAIR audit questions |

## Integrated Knowledge from nature-skills

The paper-writing skill incorporates academic writing standards from the [nature-skills](https://github.com/Yuan1z0825/nature-skills) project (MIT License, Copyright 2026 Yuan Yizhe). The following rules and strategies are applied during the hierarchical drafting process:

### Writing Strategy (from nature-polishing)

| Domain | Rule |
|--------|------|
| Hourglass structure | Introduction narrows from broad context to specific gap; Discussion widens from specific findings back to broader implications |
| Writing order | Write in this order: Results → Methods → Introduction → Discussion → Abstract → Title — not in reading order |
| Sentence length | Every sentence ≤ 30 words; sentences > 20 words should be checked for multiple propositions; the last sentence of a paragraph is often the weakest |
| Paragraph control | One controlling idea per paragraph; use thematic linking between paragraphs |
| Section tense | Results = past-tense reporting verbs + quantitative detail; Discussion = hedging interpretation verbs + mechanism |
| Hedging calibration | Match claim strength to evidence: *demonstrate* → *suggest* → *may reflect* |
| Overclaim detection | Flag absolutes ("prove", "conclusively", "unprecedented", "best", "first"), unwarranted causation, and scope expansion |
| Citation integrity | Cite only sources personally verified; four attribution types: support, borrow, contrast, reuse |
| British English | signalling, colour, analyse, programme, modelling, behaviour |

### Section Responsibilities

Each section must answer specific questions before the draft moves on.
Full move orders and phrase families are in [`scripts/section_phrasebank.py`](scripts/section_phrasebank.py):

| Section | Must answer |
|---------|-------------|
| **Introduction** | What is the problem? Why does it matter? What has been tried? What is the gap? What is our approach? |
| **Results** | What did we find? How does it compare? What is the magnitude and direction of effects? |
| **Discussion** | What do the results mean? How do they relate to prior work? What are the limitations? What is next? |
| **Conclusion** | What is the single take-away? Why does it matter for the field? |
| **Abstract** | Problem → Gap → Approach → Key result → Impact (≤ 250 words) |

### Figure Standards (from nature-figure)

When generating or describing figures for the manuscript, use the helpers in [`scripts/nature_figure_style.py`](scripts/nature_figure_style.py) and templates in [`scripts/figure_templates.py`](scripts/figure_templates.py):

- Multi-panel figures follow a three-level information hierarchy: **overview → deviation → relationship**; no two panels may answer the same scientific question.
- Primary output is always `.svg`; `.png` at 300 dpi is a secondary raster preview.
- Figure legends ≤ 300 words; titles ≤ 75 characters.
- Four figure archetypes: quantitative grid, schematic-led composite, image plate + quant, asymmetric mixed-modality.
- Anti-redundancy: every panel must encode distinct information; no visual duplication across panels.

### Data Availability (from nature-data)

When writing the Data Availability statement, use the templates in [`scripts/data_statement_templates.py`](scripts/data_statement_templates.py):

- Map every result-supporting dataset to a durable access route (public repo → discipline-specific repo → generalist repo → supplementary → request-based).
- State restriction reason, controller, review route, and access conditions for restricted data.
- Cite public datasets with DataCite-style metadata: creator, title, repository, year, identifier.
- Flag weak patterns such as "Data are available upon request" without further detail.

## Important Notes & Limitations
- The skill **never** generates the full paper in a single step.
- Every intermediate step **must** be saved as a separate numbered Markdown file (01_*.md through 10_*.md) to guarantee step-by-step execution in OpenClaw.
- If LaTeX format is chosen, the skill will ask the user to provide a custom template file. If none is provided, the default IEEE template is used automatically.
- If EXPERIMENT.md contains sufficient quantitative data, tables are automatically generated and inserted into Results/Discussion sections (Markdown tables or LaTeX `tabular` environment).
- If any source file (IDEA.md, METHOD.md, EXPERIMENT.md) is missing, the skill stops and prompts the user to provide the missing content.
- Final output is always saved as `paper_draft.md` (plain text) or `paper_draft.tex` (LaTeX) in the workspace root.
- All intermediate files remain in the workspace for inspection, editing, or resumption.

## When to Call This Skill
- After completing research-idea, method-design, and experiment-controller phases
- When the user wants a polished manuscript draft from the three core MD files
- Before final submission to a journal or arXiv

## Complementary / Related Skills
- `research-idea`         → continuously updates IDEA.md
- `method-design`         → continuously updates METHOD.md
- `experiment-controller` → continuously updates EXPERIMENT.md
- `dependency-planner`    → installs LaTeX dependencies when LaTeX output is selected
- `claw-shell`            → used internally for LaTeX compilation and file operations
- `overleaf-skill`        → optional sync of final draft to Overleaf

### External Skill Libraries (nature-skills)
- [`nature-polishing`](https://github.com/Yuan1z0825/nature-skills/tree/main/nature-polishing) → academic prose polishing, sentence/paragraph rules, hedging calibration, overclaim detection
- [`nature-figure`](https://github.com/Yuan1z0825/nature-skills/tree/main/nature-figure) → publication-ready figure workflow, chart archetypes, design theory
- [`nature-data`](https://github.com/Yuan1z0825/nature-skills/tree/main/nature-data) → Data Availability statements, repository strategy, FAIR metadata
- [`nature-paper2ppt`](https://github.com/Yuan1z0825/nature-skills/tree/main/nature-paper2ppt) → paper-to-PPTX conversion for journal club presentations

## Reference
Hierarchical Manuscript Drafting and Iterative Refinement (section 4.4 of NeuroClaw architecture).  
Flowchart: multi-agent section generation → ethics review → iterative optimization → narrative writing → de-AI polishing → logic/continuity/length/reference checks → LaTeX repair → final draft.

Integrated writing standards from [nature-skills](https://github.com/Yuan1z0825/nature-skills) by Yuan Yizhe (MIT License):  
- Writing strategy, sentence rules, section responsibilities, and phrase bank (nature-polishing)  
- Figure archetypes, design theory, and chart standards (nature-figure)  
- Data Availability statement patterns and FAIR checklist (nature-data)

Created At: 2026-03-23 00:00 HKT
Last Updated At: 2026-03-26 00:27 HKT  
Author: chengwang96