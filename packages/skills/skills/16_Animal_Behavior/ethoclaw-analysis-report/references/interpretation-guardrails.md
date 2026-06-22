# Interpretation Guardrails

Read this file when generating result interpretation and summary text.

## General Principles

- First give the most direct result conclusions, then add a sentence about which figures or tables they are based on.
- Prioritize summarizing "the most obvious characteristics of current data", do not give up normal summarization just because background is incomplete.
- Separate "observed facts" from "interpretations based on experimental paradigm", but do not repeat limitation statements in every paragraph.
- If key limitations truly exist, concentrate them in one section briefly, do not repeatedly write disclaimers throughout.

## Allowed Conclusion Types to Write Directly

- Main activity areas, preference directions, entry patterns, residence patterns of single samples
- High/low differences already clearly presented between multiple groups in images or statistical tables
- Simple summaries based on trajectory axis distribution, activity range, and path length when only raw skeleton data exists
- Readout conclusions directly corresponding to experimental paradigm, e.g., increased open-arm exploration, decreased center exploration, enhanced novel object preference

## Not Allowed to Overstep Situations

- When only ambiguous abbreviation labels exist, do not explain inter-group relationships
- When no statistical tables exist, do not write "significantly increased / significantly decreased"
- Cluster plot showing separation does not equal statistical significant difference
- Heatmap showing activity distribution does not equal mechanistic conclusions
- Single-sample results should not be written as group-level patterns
- Obvious file name prefixes like `control`, `model`, `sham`, `vehicle` can be used as candidate groupings first; other abbreviations should not be directly interpreted as biological groupings

## Recommended Expression Style

- "Results show..."
- "Images and statistical results together indicate..."
- "This sample mainly exhibits..."
- "Under this experimental paradigm, this typically corresponds to..."
- "If looking only at evidence within the current project path, the most obvious characteristic is..."

## Conclusion Levels

Prioritize output with the following strength:

1. Direct result summary
2. Comparisons with statistical support
3. Interpretations combined with experimental paradigm
4. Mechanistic conclusions

Default should cover levels 1 to 3. Only enter level 4 when user explicitly allows and evidence is sufficient.
