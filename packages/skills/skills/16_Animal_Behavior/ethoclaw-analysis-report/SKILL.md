---
name: ethoclaw-analysis-report
description: Used to generate a structured analysis report based on existing skeleton data, behavioral data, statistical tables, and result figures under a single project path (project_path). First generates manifest.json, then the agent directly fills in the section bodies in the manifest, and finally renders a structured analysis report. Applicable to scenarios such as heatmaps, trajectory plots, radar plots, violin plots, cluster plots, and statistical result summaries. Default output is a single-file HTML report. Users may trigger this with English requests like "generate a report based on this project folder", "organize these results into an HTML report", "generate an analysis summary based on existing charts", or "help me check the groupings and produce a report".
---

# Ethoclaw Analysis Report

Generate a structured analysis report based on existing data and figures under a single `project_path`. The main workflow is fixed as follows:

1. Use `build_report_manifest.py` to generate `manifest.json`
2. The agent only reads `manifest.json` and directly fills in `manifest["section_bodies"][...]["body"]`
3. Use `render_report.py --manifest manifest.json` to render `report.md` and single-file `report.html`

Do not create `sections.json`. Do not write the main text to other intermediate files. `manifest.json` is the only intermediate product.

## Environment Requirements

- Python `>=3.10`
  - The current scripts use modern type annotation syntax like `str | None`, `list[...]`, which cannot be run directly on interpreters below 3.10
- Required dependency: `Pillow`
  - `report_utils.py` directly depends on `PIL.Image`
  - Used to compress and embed `.png` / `.jpg` / `.jpeg` images when rendering HTML
- File encoding: Must read/write `manifest.json`, `report.md`, `report.html` in `UTF-8`
- Shell/platform notes:
  - Under Windows PowerShell, long Chinese text passed through command line arguments, pipes, here-strings, environment variables, or `python -c` / `python -` injection can easily be replaced with `?` or produce garbled text
  - Therefore, text filling must directly edit the `manifest.json` file itself, not through shell text channels

## Core Scope

Process only one project directory. The user must provide `project_path`, and only files under that path can be read.

Allowed inputs include but are not limited to:

- Skeleton or trajectory data: `.h5`, `.csv`, keypoint coordinate tables
- Behavioral or statistical data: summary tables, event tables, significance test tables, parameter tables, single-sample statistical JSON
- Image results: heatmaps, trajectory plots, radar plots, violin plots, cluster plots, atlas, time-series plots
- Project metadata: description text, same-directory notes files, experimental information supplemented by the user in conversation

Do not assume the project must have groupings, nor that all charts must be complete.

## Script Responsibilities

- `scripts/build_report_manifest.py`
  - Input: `project_path`
  - Output: `manifest.json`
  - Responsible for scanning the project, summarizing facts, determining report mode, and generating fillable `section_bodies`

- Agent
  - Input: `manifest.json`
  - Responsible for reading instructions in `facts`, `galleries`, and `section_bodies`
  - Directly fills in `manifest["section_bodies"][body_key]["body"]`

- `scripts/render_report.py`
  - Input: `manifest.json` with filled body text
  - Output: `report.md`, single-file `report.html`
  - HTML embeds images as compressed data URIs by default, not relying on external image files
  - Only responsible for rendering, not for automatically filling in body text

## Language Detection

Before starting any report generation, determine the report language based on the following priority:
default to English

## Standard Workflow

Execute in the following order:

0. **Detect report language**: Apply the language detection rules above to determine whether to generate report
1. Confirm the user has provided `project_path`
2. Run `build_report_manifest.py --project-path <project_path> --output <manifest.json>`
3. Read `manifest.json`
4. Check `facts.unconfirmed_items` and `facts.sample_check`
5. If there are key metadata missing, first ask the user questions
6. Fill in each `manifest["section_bodies"][body_key]["body"]`
7. Save back to the same `manifest.json`
8. Re-read the just-written `manifest.json` in UTF-8, check each filled `body` to ensure it is still normal text, not `?`, `\uFFFD`, garbled text, or truncated text
9. Only after confirming step 8 is correct, run `render_report.py --manifest <manifest.json> --output-dir <report_output>`

Do not render an empty report first and then fill it in.
When filling in body text, directly edit the existing `manifest.json` file, not through shell inline text, command arguments, redirection, or pipes to write large text into JSON.
Also do not first assemble body text into `python -c`, `python -`, `node -e`, PowerShell here-string, `jq` filters, environment variables, or any command line string, and then have the script write it back to `manifest.json`; these are text injection, not "direct file editing".

## Confirm project_path First

You must confirm the user has provided `project_path` before starting work.

If not provided:

- First ask the user for `project_path`
- Before getting the path, do not assume default directories, do not search across directories for materials

If the user provides a path:

- Only read files under that path
- Do not fetch images and data from sibling directories, parent directories, or other project directories
- If the path materials are insufficient, only report the insufficiency and ask questions, do not change to read other directories

## When Questions Must Be Asked

The following information, if cannot be confirmed within the project path, must be asked to the user first before continuing to generate a complete report:

- Whether there are groupings; if file name prefixes already clearly show labels like `control`, `model`, `sham`, `vehicle`, they can be treated as candidate groupings first
- Meaning of each group label, e.g., what do opaque abbreviations like `Y`, `con`, `k` represent
- Which group is the control group, or if there is no control group at all
- Experimental paradigm, experimental scenario, or task type
- Report purpose: internal reporting, experimental records, manuscript draft, figure organization, etc.
- Whether explanatory conclusions are allowed, or only result organization
- If there are multiple result directories, which is the main result for this report

Before confirming these key items:

- Material inventory and result description based on current evidence can be completed
- Section bodies that do not depend on background explanation can be filled in
- Do not output a complete report with strong conclusions
- Do not automatically interpret unclear abbreviations as experimental group meanings; only make candidate grouping judgments for obvious labels like `control`, `model`

## manifest.json Contract

`manifest.json` must contain at least these top-level fields:

- `project_path`
- `project_name`
- `report_title`
- `report_goal`
- `scan`
- `report_mode`
- `report_mode_reason`
- `facts`
- `galleries`
- `section_bodies`

Where `section_bodies` is the only location for body text filling. Structure:

```json
{
  "overview_body": {
    "section_id": "overview",
    "title": "Project Overview",
    "purpose": "Provide a brief overview at the project level.",
    "write_when": "Usually filled in; if even the basic project purpose cannot be confirmed, outline as result organization.",
    "source_fields": ["facts.overview", "report_mode", "facts.unconfirmed_items"],
    "rules": [
      "Explain project name, report purpose, experimental paradigm or its absence.",
      "Overview can cover core figure types or analysis scope."
    ],
    "body": ""
  }
}
```

The agent only needs to change `body`. Do not change the meaning of `section_id`, `title`, `purpose`, `write_when`, `source_fields`, `rules`.
If batch modifying multiple bodies is needed, also directly edit this UTF-8 `manifest.json` file itself, not assembling a shell command containing the body text to overwrite it.
After writing, must re-read this `manifest.json` from disk to confirm each filled `body` can display as normal UTF-8 text; only after confirming the body text is correct in the file can the rendering step proceed.

## What to Write for Each Body

### `project_summary_body`

- Purpose: Compress project path, material scope, current mode, and key gaps into a short section
- Required content: Scan scope, core materials, most suitable writing approach, most critical gaps
- Should not include: File-by-file lists, materials outside the path, long disclaimers

### `overview_body`

- Purpose: Provide high-level overview at the project level and first point out the most obvious result characteristics
- Required content: Project name, experimental paradigm, current report purpose, what this experiment typically evaluates and basic workflow, 1-2 most notable conclusions from current data
- Should not write: Turn the entire section into method description

### `sample_check_body`

- Purpose: Verify samples and groupings
- Required content: Sample count, sample IDs, candidate group labels, whether group names are confirmed, control group status, items to be confirmed
- Should not write: Force interpretation of unclear abbreviations
- Additional requirement: If file name prefixes already clearly show labels like `control`, `model`, `sham`, `vehicle`, they can be directly treated as candidate groupings

### `raw_trajectory_body`

- Purpose: When only raw skeleton or trajectory data exists, provide simple result summary based on coordinate distribution and path length
- Required content: Which raw trajectory files were used, most obvious activity areas or principal axis distribution, intuitive differences in movement range or path length
- Should not write: Hard map horizontal/vertical axes to confirmed open arm/closed arm without device mapping
- Enable by default: As long as raw trajectory summary can be extracted from the project, whether single-sample or multi-sample, it should be filled in

### `heatmap_body`

- Purpose: Summarize spatial distribution or movement patterns shown in heatmaps, trajectory plots, atlas, time-series plots
- Required content: Which figures were referenced, main phenomena observed on the figures
- Should not write: Statistical significance or mechanistic conclusions

### `radar_body`

- Purpose: Summarize multi-parameter profiles in radar plots
- Required content: What the figure represents, profile relative highs and lows, main difference points
- Should not write: Unconfirmed indicator meanings, unconfirmed inter-group comparisons

### `stats_body`

- Purpose: Summarize comparison results supported by statistical tables or statistical figures
- Required content: Which statistical tables/figures were referenced, and comparison results that can be supported by these materials
- Should not write: Significance conclusions when there are no statistical tables
- Additional requirement: Even if formal grouping definitions are incomplete, if group names are very obvious, raw difference directions can be summarized, but do not write mechanistic conclusions

### `cluster_body`

- Purpose: Describe the pattern structure presented in cluster plots
- Required content: Clustering targets, relative proximity or separation trends
- Should not write: Turn visual separation into statistical significance

### `single_subject_body`

- Purpose: Summarize core results for a single individual or single record in single-sample mode
- Required content: Total duration, effective detection duration, distance, core indicators like area residence/entry; if only raw skeleton data exists, also write main activity areas based on trajectory distribution
- Should not write: Group-level patterns

### `integrated_interpretation_body`

- Purpose: Integrate multiple result sources across figure types
- Required content: Which figure types or statistical sources were integrated, which are facts and which are interpretations based on current experimental paradigm
- Should not write: Unapproved mechanistic or causal summaries

## Report Modes

Prioritize selecting the most appropriate one from the following modes:

- `single-subject`
- `multi-sample-no-groups`
- `grouped-raw-summary`
- `grouped-comparison`
- `raw-trajectory-summary`
- `figure-only-summary`
- `data-inventory-only`

If multiple modes could all apply, prioritize the one that best matches the existing evidence; if there are still key ambiguities, confirm with the user.

## Reference Navigation

Read the following files as needed based on task phase, do not load all at once:

- When needing to determine what material types are in the current directory: read `references/input-types.md`
- When needing to determine which items must be confirmed with the user: read `references/metadata-schema.md`
- When needing to determine what sections exist for this report and body responsibilities: read `references/report-sections.md`
- When needing to select report mode and sections based on materials: read `references/section-selection-rules.md`
- When needing to constrain interpretation scope and avoid out-of-bounds conclusions: read `references/interpretation-guardrails.md`
- If `facts.overview.experiment_type` or other project materials explicitly point to a specific animal behavior paradigm, read the corresponding file before writing `overview_body`, `raw_trajectory_body`, `heatmap_body`, `stats_body`, `single_subject_body`, `integrated_interpretation_body`:
  - `TCST`: `references/experiment-types/tcst.md`
  - `OFT`: `references/experiment-types/oft.md`
  - `TST`: `references/experiment-types/tst.md`
  - `EPM`: `references/experiment-types/epm.md`
  - `FST`: `references/experiment-types/fst.md`
  - `NOR`: `references/experiment-types/nor.md`
- When needing to view display templates: read `assets/report_template_en.md` and related `assets/section_templates/*.md`

## Expression Requirements

- The default language of body should match the current user's conversation language; write in English if the user communicates in English; if the user explicitly specifies the report language, prioritize the user's specification.
- When terms first appear, prioritize using "English" format, especially for statistical methods, figure types, ethology metrics, and experimental paradigm names; subsequent text can keep one writing style as long as it doesn't cause ambiguity.
- File names, group labels, column names, and original metric names that come from project files can retain original English, do not forcibly translate and then rewrite the original values.
- Prioritize giving the most direct and informative summary based on current data, do not avoid obvious result characteristics just because of lacking complete background.
- If limitations need to be stated, concentrate them in `project_summary_body`, `overview_body`, or `integrated_interpretation_body` briefly once, do not repeat disclaimers in every section.
- When the experimental paradigm is already clear, concise conclusions can be made about area preference, exploration direction, activity pattern, or coping style by combining with the paradigm's readout meaning.
- First explain which files and figures are based on, then write interpretations
- Separate "observed facts" from "inferences based on context"
- When figures or tables are missing, skip the corresponding body and keep empty string
- When there are no groupings, do not write inter-group comparisons
- When there are no statistical tables, do not write significance conclusions
- When there are only figures without reliable table support, summarize the most obvious image patterns, but do not write as statistical significance or mechanistic conclusions
- Do not render prompt text, writing instructions, or reasoning rules into the final HTML

## Quality Constraints

- Do not read materials outside `project_path`
- Do not fabricate group meanings, sample sizes, experimental backgrounds, statistical methods, or result conclusions
- Do not directly write clustering, heatmaps, or visual separations as significant differences
- Do not exaggerate single-sample phenomena into group-level patterns
- If the user doesn't provide report purpose, ask first; if the answer cannot be obtained temporarily, write as "result organization" first
