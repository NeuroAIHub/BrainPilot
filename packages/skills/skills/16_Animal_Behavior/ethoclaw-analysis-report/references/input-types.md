# Input Types

Read this file when determining "what materials are available in the project path for generating reports".

## Common Input Types

### Raw or Semi-Raw Data

- `.h5`: Common for skeleton, trajectory, keypoints, or intermediate results.
- `.csv` / `.xlsx`: Common for behavioral summary tables, event tables, significance test results.
- `txt` / `yaml` / `json`: Common for parameter orders, group name descriptions, configuration files.

These files are typically used to determine:

- Whether there is single-sample or multi-sample data.
- Whether group labels exist.
- Whether there are quantifiable tables that can support figure interpretation.

### Image or Document Results

- Heatmaps, trajectory plots: spatial distribution, activity paths, velocity distributions.
- Radar plots: multi-parameter profiles, group mean comparisons, single-sample overviews.
- Violin plots / box plots: parameter distributions and inter-group differences.
- Cluster plots / clustermap: sample or parameter pattern structures.

These files are typically used for:

- Generating figure captions.
- Organizing result sections.
- Deciding which figures go into the main text and which are suitable for appendices.

## Priority Questions When Scanning Within Path

1. Are there file names or table columns that can identify samples.
2. Are there group labels, but do not automatically interpret label meanings.
3. Are there statistical result tables like `stats_overall.csv`, `stats_pairwise.csv`.
4. Are there figures representing overall patterns, such as group means radar, clustermap.
5. Are there same-directory description texts, experimental notes, or background information supplemented by the user in conversation.

## Handling Principles When Materials Are Incomplete

- Only figures, no tables: Can do figure organization and conservative descriptions, do not make strong statistical interpretations.
- Have tables, no figures: Can generate text-based result summaries, but image display is limited.
- Have multiple figure types but no background: First do material inventory and ask the user questions.
- Only single sample: Prioritize switching to `single-subject` mode.

## Minimum Judgment Items to Output to Upper Flow

At least judge and organize these boolean or summary fields:

- `has_skeleton_data`
- `has_behavior_summary`
- `has_stats_tables`
- `has_heatmaps`
- `has_radar`
- `has_cluster_figure`
- `sample_count_detected`
- `group_labels_detected`
- `metadata_files_found`
