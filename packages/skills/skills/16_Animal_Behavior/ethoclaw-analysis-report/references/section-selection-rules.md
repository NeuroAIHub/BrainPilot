# Section Selection Rules

Read this file when dynamically selecting report mode and `section_bodies` based on project materials.

## Report Mode Determination

### `single-subject`

Applicable conditions:

- Only one sample detected
- No formal groupings to compare
- Focus is on summarizing single trajectory, single image result, or single statistical metric

Enabled by default:

- `project_summary_body`
- `overview_body`
- `sample_check_body`
- `single_subject_body`

Supplement based on materials:

- `raw_trajectory_body`
- `heatmap_body`
- `radar_body`
- `stats_body`
- `integrated_interpretation_body`

### `multi-sample-no-groups`

Applicable conditions:

- Multiple samples detected
- No clear groupings
- Or only ambiguous abbreviation labels appear

Enabled by default:

- `project_summary_body`
- `overview_body`
- `sample_check_body`

Supplement based on materials:

- `raw_trajectory_body`
- `heatmap_body`
- `radar_body`
- `cluster_body`
- `integrated_interpretation_body`

Do not write formal inter-group conclusions.

### `grouped-raw-summary`

Applicable conditions:

- Multiple samples detected
- Clear groupings already appear in file name prefixes or configuration, e.g., `control` / `model`
- Currently no formal statistical tables or result figures, but can directly make basic summaries from raw skeleton trajectories

Enabled by default:

- `project_summary_body`
- `overview_body`
- `sample_check_body`
- `raw_trajectory_body`

Supplement based on materials:

- `heatmap_body`
- `radar_body`
- `integrated_interpretation_body`

Allowed to directly write difference directions on raw trajectories, such as larger activity range, principal axis distribution more biased toward one side, but do not write as significance or mechanistic conclusions.

### `grouped-comparison`

Applicable conditions:

- Clear groupings exist
- Group meanings are confirmed, or file name prefixes are clear enough to support basic comparisons
- At least some inter-group comparison figures, statistical tables, or other high-level results exist

Enabled by default:

- `project_summary_body`
- `overview_body`
- `sample_check_body`

Supplement based on materials:

- `raw_trajectory_body`
- `heatmap_body`
- `radar_body`
- `stats_body`
- `cluster_body`
- `integrated_interpretation_body`

### `raw-trajectory-summary`

Applicable conditions:

- Main available materials are raw skeleton or trajectory data
- Not enough high-level result figures or statistical tables
- But still can extract basic behavioral summaries from coordinate distributions and path lengths

Enabled by default:

- `project_summary_body`
- `overview_body`
- `sample_check_body`
- `raw_trajectory_body`

### `figure-only-summary`

Applicable conditions:

- Main inputs are image results
- Lacking reliable tables or metadata support

Enabled by default:

- `project_summary_body`
- `overview_body`
- `sample_check_body`

Supplement based on materials:

- `heatmap_body`
- `radar_body`
- `cluster_body`
- `integrated_interpretation_body`

### `data-inventory-only`

Applicable conditions:

- Missing key background
- Materials under `project_path` are very scattered
- Cannot extract reliable result-level information

Enabled by default:

- `project_summary_body`
- `overview_body`
- `sample_check_body`

Do not enable bodies that depend on figure interpretation.

## Body Enabling Conditions

- `project_summary_body`: Always enabled
- `overview_body`: Always enabled
- `sample_check_body`: Always enabled
- `raw_trajectory_body`: Exists trajectory coordinates that can be directly read; enabled for both single-sample and multi-sample projects
- `heatmap_body`: At least one heatmap, trajectory plot, atlas, or time-series plot exists
- `radar_body`: Radar plot exists
- `stats_body`: Statistical figure or statistical table exists
- `cluster_body`: Cluster plot exists
- `single_subject_body`: Current mode is `single-subject`
- `integrated_interpretation_body`: At least two different evidence sources exist simultaneously, e.g., raw trajectory + image results, or two types of image results

## Usage Boundaries

- If file name prefixes are already obvious, labels like `control`, `model`, `sham`, `vehicle` can be directly used as candidate groupings
- If labels are opaque abbreviations like `Y`, `K`, `A1`, still confirm with the user first
- Leave `stats_body` empty when no statistical basis exists
- `raw_trajectory_body` should prioritize writing intuitive features on coordinate distributions and activity ranges, not degrade to material inventory
