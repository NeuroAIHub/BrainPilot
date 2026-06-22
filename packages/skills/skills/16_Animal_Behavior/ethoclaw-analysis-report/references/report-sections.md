# Report Sections

Read this file when organizing report structure or understanding `manifest["section_bodies"]`.

## Body Filling Contract

All body text is directly written to:

- `manifest["section_bodies"][body_key]["body"]`

Do not create `sections.json`. Do not write body text to other intermediate files.

## Available Body List

### `project_summary_body`

- Corresponding section: Project Summary
- Purpose: Compress path scope, core materials, current report mode, and key gaps into a short section
- Empty condition: Never leave empty, should always be filled

### `overview_body`

- Corresponding section: Overview
- Purpose: Provide high-level overview at the project level and add a sentence about experimental purpose and basic workflow
- Empty condition: Only can be minimally written as result organization when project purpose and core background cannot be confirmed at all

### `sample_check_body`

- Corresponding section: Sample and Group Verification
- Purpose: Verify sample count, sample IDs, candidate groups, group mapping, and control group
- Empty condition: Never leave empty, should always be filled

### `raw_trajectory_body`

- Corresponding section: Raw Trajectory Summary
- Purpose: When only raw skeleton or trajectory data exists, directly summarize activity areas, axis distribution, path length, and differences between samples
- Empty condition: Leave empty when no directly readable trajectory coordinates exist; applicable to both single-sample and multi-sample projects

### `heatmap_body`

- Corresponding section: Heatmap Findings
- Purpose: Describe spatial distribution or movement patterns reflected in heatmaps, trajectory plots, atlas, time-series plots
- Empty condition: Leave empty when current directory has no heatmap materials

### `radar_body`

- Corresponding section: Radar Profile Findings
- Purpose: Describe multi-parameter profiles in radar plots
- Empty condition: Leave empty when current directory has no radar plots

### `stats_body`

- Corresponding section: Statistical Comparison Findings
- Purpose: Summarize comparison results supported by statistical tables or clear statistical figures
- Empty condition: Leave empty when no statistical basis exists or grouping information is insufficient to support comparisons

### `cluster_body`

- Corresponding section: Clustering Findings
- Purpose: Describe pattern structures in cluster plots
- Empty condition: Leave empty when current directory has no cluster plots

### `single_subject_body`

- Corresponding section: Single-Subject Profile
- Purpose: Summarize core indicators and image observations for single sample in single-sample mode
- Empty condition: Leave empty when not in `single-subject` mode

### `integrated_interpretation_body`

- Corresponding section: Integrated Interpretation
- Purpose: Integrate multiple result sources across figure types to form concise direct comprehensive summary
- Empty condition: Leave empty when figure types are insufficient or metadata is insufficient to support comprehensive organization

## Usage Principles

- Not every body needs to be filled every time
- Figure-related bodies should be left empty when no evidence exists
- Empty bodies will not be rendered
- The `purpose`, `write_when`, `source_fields`, `rules` in `section_bodies` are writing constraints for the agent, should not be rendered as-is into final reports
- Body language defaults to current user conversation language; when terms first appear, prioritize writing as "Chinese (English)"
- When filling bodies, directly edit `manifest.json`, do not inject large text through shell pipes or inline commands to avoid encoding contamination
- Each body should prioritize summarizing the most obvious results of current data, do not write entire section as "cannot draw conclusions"
- If limitations need to be stated, prioritize concentrating in `project_summary_body`, `overview_body`, or `integrated_interpretation_body`
- For obvious file name prefixes like `control`, `model`, `sham`, `vehicle`, can directly use as candidate groupings
- For projects with only skeleton data, prioritize writing the most obvious activity areas, axis distribution, or movement range differences, not just doing material inventory
