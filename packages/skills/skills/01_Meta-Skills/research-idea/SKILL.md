---
name: research-idea
description: "Use this skill whenever the user wants to generate or refine a research idea through literature search and discussion. Triggers include: 'research idea', 'brainstorm idea', 'generate idea', 'research-idea', 'idea generation', 'discuss new direction', or any request to explore literature and output to IDEA.md. This skill is the **mandatory interface-layer idea generator** in NeuroClaw: it calls networking search skills to retrieve recent papers, identifies gaps/trends, then iteratively discusses with the user to finalize a structured idea, always saving the result as IDEA.md."
license: MIT License (NeuroClaw custom skill – freely modifiable within the project)
layer: interface
skill_type: workflow
dependencies:
  - multi-search-engine
  - academic-research-hub
---
# Research Idea

## Overview
This skill implements the **Literature Search + User Discussion** process for NeuroClaw research-idea phase.

It acts as the Idea Generator within the multi-agent framework:
- Automatically calls search skills (`multi-search-engine`, `academic-research-hub`, etc.) for the latest papers (prefer last 3–6 months).
- Summarizes key trends, methods, and open gaps.
- Engages in step-by-step discussion with the user to refine novelty and feasibility.
- Saves the final structured idea as **IDEA.md** (Background, Gap, Proposed Idea, Methods Outline, Impact).

If no topic is provided, it first asks the user for a domain (e.g., MRI segmentation, world models in neuroscience).

**Research use only** — the output is a concise, actionable IDEA.md ready for method-design.

## Quick Reference (Idea Flow)

| Step | Description                  | Output File          |
|------|------------------------------|----------------------|
| 1. Search | Call search skills for recent literature | temp_search.md      |
| 2. Analysis | Summarize trends & gaps     | 01_gap_analysis.md  |
| 3. Draft | Propose initial idea        | 02_preliminary.md   |
| 4. Discuss | Iterate with user feedback  | 03_discussion.md    |
| 5. Finalize | Polish and save             | IDEA.md             |

## Installation
```bash
# Place files in: skills/research-idea/
```

## Important Notes & Limitations
- Always uses external search skills (no LLM hallucination for literature).
- Every step saved as numbered .md files for transparency/resume.
- Requires user confirmation at discussion steps.
- Final output always saved as `IDEA.md` in workspace root.

## When to Call This Skill
- Start of any new project
- User wants to brainstorm or pivot research direction
- Before method-design or paper-writing

## Complementary / Related Skills
- `multi-search-engine` → core web & general literature retrieval
- `academic-research-hub` → arXiv, PubMed, Semantic Scholar paper search
- `method-design` → consumes IDEA.md
- `paper-writing` → consumes IDEA.md
- `experiment-controller` → follows finalized idea

## Reference
NeuroClaw architecture (section 1.4 research survey skill).  
Flow: search → gap analysis → proposal → user discussion → IDEA.md  

Created At: 2026-03-24 20:00 HKT
Last Updated At: 2026-03-26 00:28 HKT  
Author: chengwang96