---
name: beautiful-log
description: "Use this skill after a conversation or task is completed when the user wants a clean, beautiful HTML chat log. It keeps only direct NeuroClaw <-> User dialogue, filters out tool calls / internal traces / SKILL.md reading notes, and renders distinct colored message cards for each side."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: base
skill_type: tool
dependencies: []
---
# Beautiful Log (Dialogue-to-HTML)

## Overview
`beautiful-log` converts a conversation transcript into a clean, shareable HTML report.

It is designed for research logging and progress tracking, while removing noisy execution traces.

This skill:
- Keeps only direct dialogue between **User** and **NeuroClaw**.
- Filters out tool/system/internal content (for example: tool calls, file-read traces, SKILL.md parsing notes, hidden reasoning traces).
- Renders a polished HTML page with **different background colors** for User and NeuroClaw messages.
- Preserves message order and basic formatting (line breaks, code blocks as plain text).

## When to Call This Skill
- A task is finished and the user wants a readable conversation archive.
- The user asks for an exportable discussion record.
- Weekly or daily research summary requires clean chat evidence.

## Core Workflow (Never Bypassed)
1. Receive input transcript file path (JSON, JSONL, or simple Markdown text export).
2. Parse and normalize messages to a unified schema: `role`, `content`, `timestamp` (optional).
3. Keep only `user` and `assistant` / `neuroclaw` roles.
4. Remove internal/tool/system traces.
5. Generate HTML cards:
   - User: warm light background card.
   - NeuroClaw: cool light background card.
6. Save output HTML to user-specified location.
7. Return summary: kept messages, filtered messages, output path.

## Input / Output
- Input: conversation export file (recommended JSON/JSONL).
- Output: standalone HTML file (no external assets required).

## Recommended Script
Use:
- `scripts/beautiful_log.py`

Example:
```bash
python skills/beautiful-log/scripts/beautiful_log.py \
  --input logs/session_2026-04-05.jsonl \
  --output logs/session_2026-04-05_beautiful.html \
  --title "NeuroClaw Session Log"
```

## Safety and Data Rules
- Do not include hidden reasoning or tool internals in final export.
- Keep only direct dialogue content.
- If sensitive information appears in user messages, recommend manual redaction before sharing externally.

## Complementary / Related Skills
- `claw-shell` (safe command execution)

Created At: 2026-04-05 23:26 HKT
Last Updated At: 2026-04-05 23:26 HKT
Author: chengwang96
