# Metadata Schema

Read this file when determining "what information must be confirmed with the user".

## Key Metadata

The following information, if cannot be confirmed from the project directory, file names, figure titles, or user conversation, should first be asked to the user:

- `project_name`: Project name or report title
- `report_goal`: Report purpose, e.g., result organization, internal reporting, manuscript draft
- `experiment_type`: Experimental paradigm or task type
- `has_groups`: Whether groupings exist
- `group_mapping`: What each group label represents
- `control_group`: If there is a control group, which group is the control
- `allow_interpretive_conclusion`: Whether interpretive conclusions are allowed

## Recommended Supplementary Information

- `species`
- `sample_definition`: Whether one record corresponds to individual, session, trial, or other unit
- `preferred_language`
- `priority_figures`
- `main_result_dirs`
- `notes`

## Where This Information Comes From

There are only three sources of metadata:

- Existing description texts, result files, and figure titles within the project directory
- Information that can be directly inferred from file names, directory names, and sample naming conventions
- Experimental background and writing requirements supplemented by the user in conversation

## Questioning Rules

- Missing `project_path`: Ask for the path first, do not do other work
- When group names are obvious labels like `control`, `model`, `sham`, `vehicle`, they can be used as candidate groupings first
- When group names are opaque abbreviations like `Y`, `con`, `k`, ask for group meaning first
- Need to write formal inter-group comparisons but no `control_group`: Ask for control group first
- User requests interpretive conclusions but `allow_interpretive_conclusion` is unclear: Ask if allowed

## What Can Be Written When Unconfirmed

Even if metadata is incomplete, the following are allowed to be output first:

- Project and material overview
- Sample and candidate grouping verification
- Raw trajectory summary
- Direct summary of image and statistical results

Do not avoid obvious data characteristics just because of a small amount of missing background; only when key information is truly missing, do not hard-interpret opaque abbreviations as formal experimental group definitions.

## Relationship with Manifest

- `build_report_manifest.py` will aggregate unconfirmed items into `facts.unconfirmed_items`
- When agents fill in `project_summary_body`, `overview_body`, `sample_check_body`, they can briefly mention key points that still need confirmation
- All body text is directly filled back into `manifest.json`, no additional configuration or section files are created
