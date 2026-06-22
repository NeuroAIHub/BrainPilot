---
name: ukb-skill
description: "Use this skill whenever the user wants to analyze already available UK Biobank data for brain-related research, including neurological outcomes, cognitive phenotypes, brain MRI derived phenotypes, survival analysis, subgroup analysis, propensity score analysis, mediation analysis, sensitivity analysis, machine learning, visualization, or manuscript-ready summaries. This skill only covers post-extraction analysis and explicitly excludes RAP access and data download guidance."
license: MIT License (NeuroClaw custom skill – freely modifiable within the project)
layer: subagent
skill_type: dataset
dependencies:
  - nilearn-tool
  - fsl-tool
  - claw-shell
---
# UKB Skill (Dataset Layer)

## Overview

`ukb-skill` is the NeuroClaw **analysis-layer** skill for **brain-focused UK Biobank downstream research**.

This skill is designed for users who already have local UK Biobank tables, derived phenotype tables, or neuroimaging-derived feature matrices and want to run downstream statistical or machine learning analyses.

It follows the NeuroClaw hierarchical design principles:
- This skill describes **WHAT needs to be analyzed** and **which existing skill should handle each part**.
- It contains **no RAP download workflow** and **no cloud export instructions**.
- It contains **no direct implementation code** and **no direct shell commands**.
- All concrete execution should be delegated through `claw-shell` and related downstream skills.

**Core workflow (never bypassed):**
1. Confirm that the user already has accessible UK Biobank-derived local data.
2. Identify the research target: neurological endpoint, cognitive phenotype, brain MRI phenotype, or predictive modeling task.
3. Identify the analysis type: regression, survival analysis, subgroup analysis, propensity score analysis, mediation analysis, sensitivity analysis, machine learning, visualization, or manuscript support.
4. Check the minimum required columns, files, and assumptions.
5. Generate a **numbered execution plan** with outputs, delegated skills, and risks.
6. Present the plan and wait for explicit user confirmation ("YES" / "execute" / "proceed").
7. On confirmation, delegate all execution through `claw-shell` and the target skills.

**Research use only.**

---

## Scope Boundaries

### Included
- Brain-related UK Biobank disease endpoint analysis using existing tables
- Cognitive and brain-health phenotype modeling
- Brain MRI derived phenotype association analysis
- Survival / logistic / linear modeling on UK Biobank-derived tables
- Sensitivity analysis, subgroup analysis, propensity score analysis, and mediation analysis
- Machine learning on brain-related tabular or derived neuroimaging features
- Visualization and manuscript-ready result summarization

### Excluded
- UK Biobank RAP access setup
- UK Biobank application, governance, or approval procedures
- Downloading demographics, proteomics, metabolomics, or raw UKB exports
- Cloud-side field selection or export helper workflows
- Low-level data download scripts

If the user asks how to obtain or download UK Biobank data, state that this skill only supports post-extraction analysis after the data has already been exported or derived.

---

## Benchmark-Facing Default Mainline

For benchmark-style prompts, choose the narrowest valid UK Biobank brain-analysis route first and do not widen the response into unrelated epidemiology branches.

- If the task is incident neurological disease modeling:
   - Default to `analysis-ready table -> survival endpoint check -> Cox regression -> sensitivity analysis if requested -> result summary`.
   - Do not expand into unrelated imaging preprocessing or data download steps.
- If the task is cross-sectional cognition or brain-phenotype association analysis:
   - Default to `feature table -> covariate check -> linear/logistic regression -> ranked outputs -> visualization if requested`.
   - Do not expand into unrelated survival analysis unless the prompt explicitly asks for incident-event modeling.
- If the task is predictive modeling on brain-related UKB features:
   - Default to `clean feature matrix -> train/validation split -> model fitting -> metrics -> interpretation`.
   - Delegate predictive modeling to `run_models` when appropriate.
- If required columns or files are missing:
   - State `Missing required input` explicitly.
   - Do not invent UKB field names, event dates, or covariates.
- Do not introduce RAP, cloud export, or downloader guidance in benchmark mode.

When multiple valid analysis routes exist, prefer one explicit mainline plus a short note about blocked optional branches.

**Research use only.**

---

## Quick Reference (Common UKB Brain Tasks → Delegation Map)

| Task | What needs to be done (high level) | Delegate to which skill | Expected outputs |
|---|---|---|---|
| Phenotype extraction | Extract and preprocess UKB variables with field ID mapping | `scripts/extract_ukb_phenotype.py` | Preprocessed phenotype CSV |
| Case extraction | Extract brain-related disease cases by ICD-10/ICD-9 codes | `scripts/extract_ukb_cases.py` | Case/control CSV with prevalence stats |
| Survival dataset | Build survival dataset with prevalent/incident separation | `scripts/build_ukb_survival.py` | Survival CSV (time, status) |
| QC summary | Generate per-subject QC with imaging availability | `scripts/ukb_qc_summary.py` | QC summary + exclusion list |
| Neurological survival analysis | Validate incident-event table, define endpoint, run Cox regression, summarize hazard ratios | `claw-shell` | model summaries, hazard ratio tables, survival outputs |
| Cognitive phenotype association | Regress cognition or brain-health phenotype on exposure or imaging features | `claw-shell` | beta/OR tables, cleaned regression outputs |
| Brain MRI phenotype association | Analyze ROI volumes, cortical thickness, WMH burden, diffusion or connectivity summaries | `claw-shell` | ranked effect tables, feature association summaries |
| Predictive modeling on UKB brain features | Fit classification or regression models and interpret them | `run_models` | metrics, predictions, SHAP summaries, model comparisons |
| Subgroup analysis | Test heterogeneity by sex, age band, APOE, vascular risk, or other subgroup | `claw-shell` | subgroup effect tables, interaction summaries |
| Propensity score analysis | Estimate propensity scores, run matching or weighting, assess balance | `claw-shell` | matched/weighted dataset summaries, balance outputs |
| Mediation analysis | Test whether a biomarker or imaging phenotype mediates a brain-related outcome | `claw-shell` | direct/indirect effect summaries, mediation tables |
| Sensitivity analysis | Exclude early events or rows with missing covariates, then rerun the same model | `claw-shell` | sensitivity tables, robustness comparison summaries |
| Brain-result visualization | Turn ranked brain-region or connectome outputs into figures | `brain-visualization` | PNG figures, ranked region tables, connectome plots |
| Manuscript-ready methods/results | Convert the finished analysis into text for reports or papers | `paper-writing` | draft methods, results text, figure legends |

---

## Recommended Strategy (Decision Logic)

- If the goal is **incident neurological disease analysis** such as dementia, stroke, or Parkinson's disease:
   - Prefer the survival-analysis route.
   - Confirm prevalent vs incident definition, censoring rule, and time/status columns before modeling.
   - Best for: longitudinal UKB outcome studies.

- If the goal is **cross-sectional cognition or brain-health association analysis**:
   - Prefer linear or logistic regression on a cleaned participant-level table.
   - Best for: baseline phenotype studies, association screens, cognition analyses.

- If the goal is **brain MRI phenotype association analysis** using ROI tables, cortical thickness, WMH burden, diffusion summaries, or connectome summaries:
   - Prefer a feature-table association route.
   - Best for: imaging-derived phenotype studies and region-wise effect ranking.

- If the goal is **predictive modeling** on UKB brain-related features:
   - Prefer `run_models` for model fitting, model comparison, and interpretation.
   - Best for: disease risk prediction, cognitive outcome prediction, multimodal tabular modeling.

- If the goal is **effect heterogeneity or causal approximation**:
   - Prefer subgroup, propensity score, or mediation workflows.
   - Best for: mechanistic analyses, treatment/exposure comparison, robustness studies.

- If the goal is **publication-ready figures or writing**:
   - Prefer `brain-visualization` for figures and `paper-writing` for text output.
   - Best for: reporting, paper drafting, slide-ready summaries.

---

## Minimal Input Requirements

### For Survival Analysis
- participant ID column
- survival time or baseline and event/censoring dates
- event indicator/status column
- clearly defined neurological or brain-related outcome
- covariates

### For Cross-Sectional Regression
- participant ID column
- exposure or predictor columns
- target phenotype column
- covariates

### For Brain Feature Modeling
- participant ID column
- ROI / IDP / derived feature columns
- target phenotype or outcome
- optional scanner, site, or confound columns

If the required inputs are not present, return a concrete missing-input list instead of inventing fields.

---

## Brain-Relevant UKB Targets

This skill is intentionally restricted to brain-related UK Biobank content. Typical targets include:
- neurodegenerative outcomes: dementia, Alzheimer's disease, Parkinson's disease
- cerebrovascular outcomes: stroke and vascular brain-health outcomes
- cognition: memory, reaction time, executive function, fluid intelligence, cognitive decline
- psychiatric or brain-health outcomes when explicitly tied to brain-focused analysis
- imaging-derived brain phenotypes: cortical thickness, regional volume, subcortical volume, WMH burden, diffusion metrics, functional connectivity summaries

If the request is mainly non-brain UK Biobank epidemiology, this skill should state that it is out of scope.

---

## When to Call This Skill

- Any request involving UK Biobank brain-related downstream analysis on already available local data.
- Any request involving dementia, stroke, cognition, brain MRI phenotypes, WMH burden, or brain-feature prediction in UKB.
- Any request asking for subgroup analysis, propensity score analysis, mediation analysis, or sensitivity analysis in a brain-focused UKB setting.

Do not call this skill for RAP export, field download, or raw neuroimaging preprocessing from DICOM/NIfTI.

---

## Complementary / Related Skills

- `run_models`            -> predictive modeling and interpretation on derived UKB brain features
- `brain-visualization`   -> convert effect tables or connectome outputs into figures
- `paper-writing`         -> manuscript-ready methods/results writing
- `method-design`         -> analysis design refinement for neurological UKB studies
- `academic-research-hub` -> literature-backed design support and research grounding
- `smri-skill`            -> raw structural MRI preprocessing before UKB-level tabular analysis
- `fmri-skill`            -> raw functional MRI preprocessing before UKB-level tabular analysis
- `wmh-segmentation`      -> WMH extraction before UKB-level association or prediction analysis
- `claw-shell`            -> all concrete execution

---

## Important Notes & Limitations

- This skill assumes that the user already has legal access to UK Biobank data and has already exported or derived the needed local analysis files.
- This skill does not define fixed UKB field IDs because field selection differs across studies and exports.
- This skill should not guess disease definitions, date columns, or censoring rules when they are not provided.
- Sensitivity analysis should be framed as filtered-data reruns of the same main model, not as unrelated new pipelines.
- If multiple candidate outcomes or feature tables exist, the skill should first ask which one is primary before execution.
- This skill is intended for research workflows and not for clinical decision-making.

---

## Default Response Pattern

When this skill is triggered, the response should:
1. Restate the exact UK Biobank brain-related analysis goal.
2. State that the skill assumes local data is already available and does not cover downloading.
3. List the minimum required columns or files.
4. Provide a numbered execution plan.
5. State which NeuroClaw skills will be delegated to.
6. Wait for confirmation before execution.

---

## Companion Scripts

Adapted from [UKBAnalytica_v2](https://github.com/Hinna0818/UKBAnalytica_v2) (Nan He, Southern Medical University).

### `scripts/extract_ukb_phenotype.py`

Extract and preprocess UKB phenotype data with automatic field ID mapping.

```bash
python skills/ukb-skill/scripts/extract_ukb_phenotype.py \
  --input ukb_raw.csv --output phenotype.csv

python skills/ukb-skill/scripts/extract_ukb_phenotype.py \
  --input ukb_raw.csv --variables sex,age,bmi,smoking,townsend --output covariates.csv

python skills/ukb-skill/scripts/extract_ukb_phenotype.py --list-variables
```

Features:
- 50+ predefined UKB field ID mappings (demographics, lifestyle, biomarkers, brain IDPs, cognition)
- Automatic preprocessing: invalid code removal, variable-specific recoding
- Custom variable mapping via JSON
- Lists all available variables with `--list-variables`

### `scripts/extract_ukb_cases.py`

Extract brain-related disease cases using ICD-10/ICD-9 codes.

```bash
python skills/ukb-skill/scripts/extract_ukb_cases.py \
  --input ukb_raw.csv --disease dementia --output dementia_cases.csv

python skills/ukb-skill/scripts/extract_ukb_cases.py \
  --input ukb_raw.csv --custom-icd G20 --output custom_cases.csv

python skills/ukb-skill/scripts/extract_ukb_cases.py --list-diseases
```

Features:
- 15 predefined brain-related disease definitions (dementia, Alzheimer's, stroke, Parkinson's, MS, epilepsy, depression, anxiety, schizophrenia, bipolar, brain tumour, TBI)
- Multi-source ascertainment: ICD-10, ICD-9, Death register
- Custom ICD-10 pattern support
- Prevalence statistics per disease

### `scripts/build_ukb_survival.py`

Build survival analysis datasets with prevalent/incident case separation.

```bash
python skills/ukb-skill/scripts/build_ukb_survival.py \
  --input ukb_raw.csv --disease dementia --output survival.csv

python skills/ukb-skill/scripts/build_ukb_survival.py \
  --input ukb_raw.csv --disease stroke --censor-date 2023-10-31 --output stroke_survival.csv
```

Features:
- Follow-up time calculation (years from baseline)
- Prevalent vs incident case separation
- Censoring at death or administrative censor date
- Compatible with Cox regression in downstream analysis

### `scripts/ukb_qc_summary.py`

Generate per-subject QC summaries for brain-related UKB data.

```bash
python skills/ukb-skill/scripts/ukb_qc_summary.py \
  --input ukb_raw.csv --output qc_summary.csv

python skills/ukb-skill/scripts/ukb_qc_summary.py \
  --input ukb_raw.csv --imaging-check --age-min 45 --age-max 80 --output qc_imaging.csv
```

Features:
- Covariate completeness check
- Brain imaging availability (T1w, FLAIR, dMRI, rs-fMRI IDPs)
- Age range filtering
- Per-subject QC pass/fail flag

---

## Reference

Companion scripts adapted from [UKBAnalytica_v2](https://github.com/Hinna0818/UKBAnalytica_v2) by Nan He (Southern Medical University). SKILL.md analysis design narrowed to brain-focused UK Biobank research.

Custom NeuroClaw skill.

Created At: 2026-04-20 15:47 HKT
Last Updated At: 2026-05-06 15:12 HKT
Author: chengwang96