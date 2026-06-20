---
name: "repo-to-skill"
description: "Convert a GitHub repository or local codebase into a well-structured Claude Code skill with progressive disclosure. Use this skill whenever the user provides a GitHub URL or local repo path and asks to turn it into a skill, create a skill from a repo, or convert a library/tool/framework into reusable skill documentation. Also trigger when users say things like 'make a skill from this repo', 'turn this codebase into a skill', or 'I want a skill for [library name]'."
version: "1.0.0"
authors:
  - "Claude (AI-assisted)"
review_status: "ai-generated"
---

# Repo-to-Skill: Convert a Repository into a Claude Code Skill

## Purpose

This skill encodes the complete workflow for transforming a GitHub repository (or local codebase) into a well-structured Claude Code skill. It guides you through cloning, exploring, extracting key information, and assembling a skill with proper progressive disclosure — a concise SKILL.md entry point backed by detailed reference files.

## When to Use

Activate when the user:
- Provides a GitHub URL and asks to create a skill from it
- Points to a local repository path and wants it converted to a skill
- Says "make a skill from this repo/library/tool"
- Wants to document a codebase as a reusable skill

## Workflow Overview

```
1. Acquire repo  →  2. Explore broadly  →  3. Collect key info  →  4. Design structure  →  5. Write SKILL.md + references
```

---

## Phase 1: Acquire the Repository

### From GitHub URL
```bash
# Clone to a working directory
git clone <github-url> /tmp/skill-source-repo
# or clone to a user-specified path
```

If the user provides just a repo name (e.g., "mne-tools/mne-python"), construct the URL:
```bash
git clone https://github.com/<owner>/<repo>.git /tmp/skill-source-repo
```

### From Local Path
If the user provides a local path (e.g., `/srv/repos/my-library`), use it directly. Verify it exists before proceeding.

### Already Available
Check if the repo is already cloned locally before downloading again.

---

## Phase 2: Explore the Repository

This is the most important phase. Explore broadly and deeply — the quality of the skill depends on how well you understand the repo. Use parallel subagents when possible to speed up exploration.

### 2.1 Top-Level Orientation

Read these files first (if they exist):
- `README.md` / `README.rst` — project overview, installation, quick start
- `CHANGELOG.md` / `CHANGES.rst` / `HISTORY.md` — recent API changes
- `pyproject.toml` / `setup.py` / `setup.cfg` / `package.json` — dependencies, version
- `CONTRIBUTING.md` — project conventions
- `LICENSE` — license type

Then list the top-level directory structure to understand the project layout.

### 2.2 Core Source Code

Identify the main source directory (often `src/`, `lib/`, or the package name itself). Then:

1. Read `__init__.py` (or equivalent entry point) to find all exported modules/classes/functions
2. List all submodules/subdirectories
3. For each major submodule, read its `__init__.py` to get the public API
4. Read key implementation files for important classes/functions — focus on docstrings and signatures, not internal logic

### 2.3 Documentation

Look for documentation in these common locations:
- `docs/` or `doc/` directory
- `examples/` directory — working code examples are gold
- `tutorials/` directory — step-by-step guides
- API reference docs (often generated, but source `.rst` or `.md` files are useful)
- Jupyter notebooks (`.ipynb`) in any directory

### 2.4 Examples and Tutorials

These are the most valuable resources for a skill. For each example/tutorial:
- Note what it demonstrates
- Extract the key code patterns
- Identify the recommended parameter values and best practices

### 2.5 Tests (Optional)

Skim test files to discover edge cases, expected behaviors, and usage patterns that aren't in the docs.

### Exploration Strategy

Use the Agent tool with `subagent_type=Explore` for broad exploration, or launch multiple parallel subagents to cover different areas simultaneously:

```
Agent 1: Explore top-level structure + README + core __init__.py files
Agent 2: Explore tutorials/ and examples/ directories, read representative files
Agent 3: Explore docs/ for API reference, read key module documentation
```

The goal is to collect:
- Complete list of public API (classes, functions, constants)
- Recommended usage patterns and pipelines
- Parameter defaults and recommended values
- Common pitfalls and gotchas
- Code examples for each major feature

---

## Phase 3: Design the Skill Structure

### Determine Scope

Based on exploration, decide:
- What is the skill's primary purpose? (e.g., "guide users through X analysis pipeline")
- What are the major topic areas? (these become reference files)
- What belongs in the main SKILL.md vs. references?

### Progressive Disclosure Architecture

```
skill-name/
├── SKILL.md              (< 500 lines — overview, pipeline, quick reference)
└── references/
    ├── topic-a.md        (detailed API + examples for topic A)
    ├── topic-b.md        (detailed API + examples for topic B)
    ├── topic-c.md        (detailed API + examples for topic C)
    └── ...
```

Rules of thumb:
- SKILL.md: Pipeline overview, core concepts, quick-start code, common pitfalls, reference table pointing to detail files
- Each reference file: One major topic, complete API listing, detailed code examples, parameter tables
- Keep each file under 300 lines for readability; split if larger
- Include a "Reference Files" table in SKILL.md so the model knows when to read each file

### Reuse Repo Resources Directly

When the repo already has well-written documentation, examples, or reference material, copy them directly into `references/` rather than rewriting. This saves effort and preserves accuracy:

```bash
# Copy useful docs directly
cp /tmp/skill-source-repo/docs/api_reference.md references/
cp /tmp/skill-source-repo/examples/quickstart.py references/
cp /tmp/skill-source-repo/tutorials/getting_started.md references/
```

Rename files to be descriptive if needed. Add a brief header noting the source.

---

## Phase 4: Write the SKILL.md

### Naming Rule

Skill name may only contain lowercase letters, numbers, and hyphens. The name must match the folder name. For example, a skill in folder `my-cool-tool/` must have `name: "my-cool-tool"` in its frontmatter.

### Required Structure

```markdown
---
name: "my-skill-name"
description: "One-line description of what this skill provides"
version: "1.0.0"
authors:
  - "Claude (AI-assisted)"
review_status: "ai-generated"
---

# Skill Title

## Purpose
What domain knowledge this skill encodes and why it's useful.

## When to Use This Skill
Trigger conditions — what user phrases/contexts activate this skill.

## Reference Files (Progressive Disclosure)
| Topic | File | When to Read |
|-------|------|--------------|
| Topic A | `references/topic-a.md` | User asks about A |
| Topic B | `references/topic-b.md` | User asks about B |

## Overview / Pipeline
High-level workflow or concept map.

## Quick Start
Minimal working example covering the most common use case.

## Key Concepts
Core data structures, important classes, essential functions.

## Common Pitfalls
Numbered list of mistakes to avoid, with brief explanations.

## [Additional sections as needed]
```

### Writing Guidelines

1. Lead with the pipeline/workflow — users want to know "what do I do first?"
2. Include runnable code examples — not pseudocode
3. Cite parameter values with sources when possible
4. Keep SKILL.md under 500 lines — move details to references
5. Use tables for API listings and parameter comparisons
6. The reference table is critical — it tells the model when to load each file

---

## Phase 5: Write Reference Files

For each major topic area, create a reference file:

```markdown
# Topic Name Reference

## Table of Contents
1. [Section 1](#section-1)
2. [Section 2](#section-2)
...

## Section 1
[Detailed API, parameters, code examples]

## Section 2
[More details]
```

### What to Include in References

- Complete function/class signatures with all parameters
- Parameter tables with types, defaults, and descriptions
- Multiple code examples showing different use cases
- Tips for parameter selection
- Links between related functions

### Reusing Repo Content

Prefer copying existing high-quality content from the repo:
- Tutorial code → reference examples
- API docstrings → function reference tables
- README sections → overview content
- Example scripts → working code snippets

Only rewrite when the original content is poorly organized, outdated, or too verbose.

---

## Quality Checklist

Before finishing, verify:

- [ ] Skill name contains only lowercase letters, numbers, and hyphens, and matches the folder name
- [ ] SKILL.md is under 500 lines
- [ ] All major features/modules are covered
- [ ] Reference table in SKILL.md lists all reference files with "when to read" guidance
- [ ] Each reference file has a table of contents
- [ ] Code examples are complete and runnable
- [ ] Common pitfalls section exists
- [ ] Quick start example covers the most common use case
- [ ] No reference file exceeds ~300 lines (split if needed)
- [ ] Skill directory uses kebab-case naming

---

## Example: Converting a Python Library

For a Python library like `pandas`:

```
pandas-guide/
├── SKILL.md                    # Overview, core objects (DataFrame, Series), quick start
└── references/
    ├── io.md                   # read_csv, read_excel, to_parquet, etc.
    ├── selection-indexing.md    # loc, iloc, boolean indexing, query
    ├── groupby-aggregation.md  # groupby, agg, transform, pivot_table
    ├── merging-joining.md      # merge, join, concat
    ├── time-series.md          # DatetimeIndex, resample, rolling
    └── visualization.md        # plot(), plot.bar(), etc.
```

The SKILL.md would contain the DataFrame/Series overview, a quick-start example, and a reference table pointing to each topic file.
