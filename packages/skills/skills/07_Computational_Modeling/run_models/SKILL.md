---
name: run_models
description: "Use this skill whenever the user wants to run phenotype-prediction models, browse model cards, map model inputs/outputs, or choose an execution route for fMRI/sMRI based models. This is a model-entry orchestration skill: it routes requests to model-specific docs and delegates preprocessing to modality skills."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: subagent
skill_type: model
dependencies:
  - fmri-skill
  - smri-skill
---
# Run Models Skill (Model Entry Layer)

## Overview
`run_models` is the NeuroClaw entry skill for model-level inference workflows.

This skill is responsible for:
- Maintaining a model registry (name, paper, source code, input/output, doc file path)
- Selecting the correct model skill under `skills/<model-name>/SKILL.md`
- Coordinating required data preparation before model execution
- Delegating modality preprocessing to `fmri-skill` and `smri-skill`

It supports both:
- deep learning model routes for phenotype prediction
- non-deep-learning statistical / unsupervised / classical machine-learning routes such as first-level and second-level task-fMRI GLM, resting-state ICA, resting-state DictLearning, disease classification with SVM, disease classification with SpaceNet, brain parcellation with K-means, brain parcellation with Hierarchical clustering, temporal filtering, and detrending

This skill does not hardcode detailed install/run commands for each model. Those details are stored in model-specific markdown files.

**Research use only.**

---

## Core Workflow (Never Bypassed)
1. Identify requested model and task (classification/regression phenotype prediction).
2. Locate the corresponding model skill under `skills/<model-name>/SKILL.md`.
3. Verify required inputs (ROI features, optional sMRI features).
4. If inputs are not ready, delegate preprocessing to modality skills:
	 - `fmri-skill` for ROI extraction from fMRI
	 - `smri-skill` when model additionally requires structural features
5. Generate a numbered execution plan and wait for explicit user confirmation (`YES` / `execute` / `proceed`).
6. On confirmation, execute via `claw-shell` following model doc instructions.

---

## Model Registry (Current)

| Model | Paper | Code | Input | Output | Model Doc |
|---|---|---|---|---|---|
| BrainGNN | Li et al., 2020, *Braingnn: Interpretable brain graph neural network for fmri analysis* | https://github.com/xxlya/BrainGNN_Pytorch/tree/main | fMRI ROI features (graph/node-level ROI representation) | Phenotype prediction (classification/regression) + interpretable graph indicators | `skills/brain_gnn/SKILL.md` |
| FM-APP | He et al., 2024, *FM-APP: Foundation model for any phenotype prediction via fMRI to sMRI knowledge transfer* | https://github.com/ZhibinHe/FM-APP | fMRI ROI features + sMRI features | Phenotype prediction (any-phenotype setting) | `skills/fm_app/SKILL.md` |
| NeuroStorm | NeuroClaw model entry for storm-related phenotype prediction workflows | see `skills/neurostorm/SKILL.md` | Multi-modal neuroimaging features as specified in the model doc | Phenotype prediction / downstream inference as specified in the model doc | `skills/neurostorm/SKILL.md` |
| GLM | Classical first-level and second-level task-fMRI general linear model | Nilearn / SPM-style implementation route | Preprocessed task fMRI, events, optional confounds, and optional subject-level contrast maps for group inference | Task activation contrasts, group z maps, and statistical inference outputs | `skills/glm/SKILL.md` |
| ICA | Classical resting-state network decomposition method | Nilearn decomposition implementation route | Preprocessed resting-state fMRI, optional mask, optional confounds | Intrinsic connectivity component maps, subject time series, optional connectomes | `skills/ica/SKILL.md` |
| DictLearning | Classical sparse resting-state network decomposition method | Nilearn decomposition implementation route | Preprocessed resting-state fMRI, optional mask, optional confounds | Sparse component maps, subject time series, optional connectomes | `skills/dictlearning/SKILL.md` |
| SVM | Classical disease classification method for neuroimaging | Nilearn / scikit-learn style decoding route | Preprocessed ROI features, labels, optional covariates | Predicted labels, decision scores, CV metrics | `skills/svm/SKILL.md` |
| SpaceNet | Classical voxel-wise disease classification method for neuroimaging | Nilearn decoding implementation route | Aligned voxel maps, labels, optional covariates, optional mask | Predicted labels, decision scores, CV metrics, coefficient maps | `skills/spacenet/SKILL.md` |
| K-means | Classical brain parcellation method for neuroimaging | Nilearn / clustering-based parcellation route | Preprocessed feature maps or image lists, optional mask, requested parcel count | Parcel labels, cluster summaries, optional centroid outputs | `skills/kmeans/SKILL.md` |
| Hierarchical | Classical hierarchical brain parcellation method for neuroimaging | Nilearn / clustering-based parcellation route | Preprocessed feature maps or image lists, optional mask, requested parcel count | Parcel labels, cluster summaries, optional dendrogram outputs | `skills/hierarchical/SKILL.md` |
| Filtering | Classical signal denoising method for neuroimaging time series | Nilearn / preprocessing route | Preprocessed BOLD image or time series, TR, optional confounds, optional mask | Denoised BOLD, cleaned time series, optional QC summaries | `skills/filtering/SKILL.md` |
| Detrending | Classical signal denoising method for neuroimaging time series | Nilearn / preprocessing route | Preprocessed BOLD image or time series, TR, optional confounds, optional mask | Cleaned BOLD, cleaned time series, optional QC summaries | `skills/detrending/SKILL.md` |

### Citation Notes
- BrainGNN:
	- Li X, Zhou Y, Dvornek N, Zhang M, Gao S, Zhuang J, Scheinost D, Staib L, Ventola P, Duncan J. 2020.
- FM-APP:
	- He Z, Li W, Liu Y, et al. FM-APP. IEEE TMI, 2024, 44(10): 4010-4022.
- NeuroStorm:
	- See `skills/neurostorm/SKILL.md` for the current model card, citation, and execution details.
- GLM:
  - Classical first-level and second-level general linear model for task-evoked activation analysis and group-level inference; see `skills/glm/SKILL.md`.
- ICA:
  - Classical resting-state network decomposition route based on independent component analysis; see `skills/ica/SKILL.md`.
- DictLearning:
  - Classical sparse resting-state network decomposition route; see `skills/dictlearning/SKILL.md`.
- SVM:
  - Classical disease classification route for ROI-level or tabular decoding; see `skills/svm/SKILL.md`.
- SpaceNet:
  - Classical voxel-wise disease classification route with sparse coefficient maps; see `skills/spacenet/SKILL.md`.
- K-means:
  - Classical brain parcellation route for fixed-K parcel discovery; see `skills/kmeans/SKILL.md`.
- Hierarchical:
  - Classical brain parcellation route for multi-scale parcel discovery; see `skills/hierarchical/SKILL.md`.
- Filtering:
  - Classical signal denoising route for temporal filtering; see `skills/filtering/SKILL.md`.
- Detrending:
  - Classical signal denoising route for temporal drift removal; see `skills/detrending/SKILL.md`.

## Harness-Aware Model Registration (Declarative + Testing + Drift Detection)

### Model Specification Format (Extended)
Every model integrated into run_models **must** include a **model specification file** in JSON format alongside its Markdown documentation:

**File**: `skills/{model_name}/{model_name}_spec.json`

```json
{
  "model_name": "brain_gnn",
  "version": "1.0.0",
  "paper": "Li et al., 2020",
  "code_repo": "https://github.com/xxlya/BrainGNN_Pytorch",
  "required_dependencies": {
    "torch": ">=1.9.0,<2.1.0",
    "numpy": ">=1.21.0",
    "scipy": ">=1.7.0",
    "networkx": ">=2.6.0"
  },
  "input_spec": {
    "modality": "fMRI",
    "format": "ROI time-series (N_nodes, T_timepoints)",
    "expected_shape": [116, null],
    "value_range": [-5.0, 5.0],
    "required_preprocessing": ["z-score normalization"]
  },
  "output_spec": {
    "type": "classification|regression",
    "classes": null,
    "value_range": null
  },
  "validation_checksums": {
    "weights_sha256": "abc123...",
    "test_data_sha256": "def456..."
  }
}
```

### Test Suite Requirements
Every model **must** include an automated test suite covering:

1. **Input validation**: verify input dimensions, data types, value ranges
2. **Determinism check**: seed control + verify identical outputs with same seed (tolerance: 1e-6)
3. **Performance regression**: compare inference speed and memory usage against baseline
4. **Output coherence**: verify outputs lie within expected value range, no NaN/Inf values
5. **Backward compatibility**: test model against previous version checksum (if available)

**Test execution**:
```bash
python -m pytest run_models/tests/test_{model_name}.py -v --harness-report
```

Output: `run_models_test_report_{model_name}_{timestamp}.json` with pass/fail status and metrics

### Drift Detection Protocol
Monitor production/inference results for concept drift (distribution shift in data or model behavior):

**Automated monitoring per 100 inferences**:
- **Input distribution shift** (KL divergence against reference data): flag if deviation > 0.1
- **Output distribution shift** (prediction probability / regression output quantiles): flag if shift detected
- **Latency drift** (average inference time): alert if >20% increase
- **Failure rate monitoring** (predictions with NaN/Inf / out-of-range): flag if >1% failures

**Logging output**: `run_models_drift_log.json` (append-only, timestamped entries)

Example entry:
```json
{
  "timestamp": "2026-04-05T14:32:00Z",
  "model": "brain_gnn",
  "inference_count": 100,
  "input_kl_divergence": 0.045,
  "output_mean_shift": 0.002,
  "latency_ms": 45.2,
  "failure_rate": 0.0,
  "status": "healthy"
}
```

**Alert thresholds**: 
- KL divergence > 0.1 → generate warning
- Output shift > 5% std dev → investigation recommended
- Latency drift > 20% → check computational resource bottleneck
- Failure rate > 1% → stop inference, require manual review

### Model Card Template (Minimum Required Metadata)
Each model must include a model card in `skills/{model_name}/SKILL.md` documenting:

```markdown
## Model Card: {model_name}

### Model Details
- **Model name**: {name}
- **Version**: {X.Y.Z}
- **Date**: {YYYY-MM-DD}
- **Source repository**: {repo_url}
- **Paper**: {citation}

### Intended Use
- **Primary use case**: [e.g., fMRI-based phenotype classification]
- **Input modalities**: [fMRI, sMRI, etc.]
- **Supported tasks**: [classification, regression, interpretability]

### Known Limitations
- [e.g., "Trained on N subjects aged 18-65; generalization to pediatric/geriatric populations not validated"]
- [e.g., "Sensitive to head motion artifacts; recommend ICA-FIX preprocessing"]

### Validation Results
- **Test set performance**: [accuracy/AUC/RMSE with confidence intervals]
- **Cross-site validation**: [performance on held-out sites, if applicable]
- **Robustness checks**: [drift detection history, adversarial perturbation results]

### Dependencies & Versioning
- **Required libraries**: [see {model_name}_spec.json]
- **Hash (model weights)**: {SHA256}
- **Last verified**: {date}
```

---

## Delegation Rules

### BrainGNN Route
- Required modality preprocessing: `fmri-skill`
- Typical upstream outputs expected: ROI matrices/time-series converted to model-required feature tensors

### FM-APP Route
- Required modality preprocessing: `fmri-skill` + `smri-skill`
- Typical upstream outputs expected: fMRI ROI features plus structural MRI-derived features

### NeuroStorm Route
- Required modality preprocessing: follow the model doc in `skills/neurostorm/SKILL.md`
- Typical upstream outputs expected: inputs and features specified by the NeuroStorm model card

### GLM Route
- Required modality preprocessing: `fmri-skill`
- Concrete model/tool execution: `nilearn-tool`
- Typical upstream outputs expected:
  - first-level GLM: preprocessed task fMRI, events, optional confounds, named contrasts
  - second-level GLM: subject-level contrast maps, group design matrix, group contrast definition

### ICA Route
- Required modality preprocessing: `fmri-skill`
- Concrete model/tool execution: `nilearn-tool`
- Typical upstream outputs expected:
  - preprocessed resting-state fMRI image list
  - optional mask and confounds
  - requested component count

### DictLearning Route
- Required modality preprocessing: `fmri-skill`
- Concrete model/tool execution: `nilearn-tool`
- Typical upstream outputs expected:
  - preprocessed resting-state fMRI image list
  - optional mask and confounds
  - requested component count

### SVM Route
- Required modality preprocessing: `fmri-skill` and/or `smri-skill`
- Concrete model/tool execution: `nilearn-tool`
- Typical upstream outputs expected:
  - ROI/tabular feature matrix, diagnosis labels, optional covariates

### SpaceNet Route
- Required modality preprocessing: `fmri-skill` and/or `smri-skill`
- Concrete model/tool execution: `nilearn-tool`
- Typical upstream outputs expected:
  - aligned subject image list, diagnosis labels, mask image, optional covariates

### K-means Route
- Required modality preprocessing: `fmri-skill` and/or `smri-skill`
- Concrete model/tool execution: `nilearn-tool`
- Typical upstream outputs expected:
  - feature matrix or aligned image list for parcel discovery
  - optional mask
  - target parcel count

### Hierarchical Route
- Required modality preprocessing: `fmri-skill` and/or `smri-skill`
- Concrete model/tool execution: `nilearn-tool`
- Typical upstream outputs expected:
  - feature matrix or aligned image list for parcel discovery
  - optional mask or similarity structure
  - target parcel count

### Filtering Route
- Required modality preprocessing: `fmri-skill`
- Concrete model/tool execution: `nilearn-tool`
- Typical upstream outputs expected:
  - preprocessed BOLD image or extracted time series
  - TR, optional confounds, optional mask
  - optional frequency settings

### Detrending Route
- Required modality preprocessing: `fmri-skill`
- Concrete model/tool execution: `nilearn-tool`
- Typical upstream outputs expected:
  - preprocessed BOLD image or extracted time series
  - TR, optional confounds, optional mask
  - detrending request and optional standardization settings

### Shared Execution Routing
- Environment/dependency planning: `dependency-planner` + `conda-env-manager`
- Actual model run command execution: `claw-shell`

---

## Input and Output Contract (Entry-Level)

### Inputs expected by this skill
- Model selection (`brain_gnn`, `fm_app`, `neurostorm`, `glm`, `ica`, `dictlearning`, `svm`, `spacenet`, `kmeans`, `hierarchical`, `filtering`, or `detrending`)
- Data split / subject list
- Phenotype target definition
- Optional compute constraints (GPU/CPU, memory, batch size)

For GLM routes, the required task definition should be expressed as:
- task name
- events file
- contrast(s) of interest
- optional group-level analysis scope
- whether the request is first-level GLM or second-level GLM
- if second-level GLM: contrast map list and group design matrix

For ICA routes, the required decomposition definition should be expressed as:
- resting-state image list or subject list
- number of components
- optional mask and confounds

For DictLearning routes, the required decomposition definition should be expressed as:
- resting-state image list or subject list
- number of components
- optional mask and confounds

For SVM routes, the required classification definition should be expressed as:
- diagnosis target / label column
- feature type (`roi/tabular`)
- subject list or split definition
- optional covariates

For SpaceNet routes, the required classification definition should be expressed as:
- diagnosis target / label column
- feature type (`voxel-wise`)
- subject list or split definition
- optional covariates and mask

For K-means routes, the required parcellation definition should be expressed as:
- image list or feature matrix
- target parcel / cluster count
- optional mask

For Hierarchical routes, the required parcellation definition should be expressed as:
- image list or feature matrix
- target parcel / cluster count
- optional mask, similarity structure, or adjacency constraint

For Filtering routes, the required denoising definition should be expressed as:
- input BOLD image or time series
- TR
- optional confounds, mask, and frequency settings

For Detrending routes, the required denoising definition should be expressed as:
- input BOLD image or time series
- TR
- optional confounds, mask, and standardization settings

### Outputs produced by this skill
- A confirmed, numbered run plan
- Pointers to the model-specific instruction file
- Delegated preprocessing plan for required modalities
- Structured output location recommendations

---

## Recommended Output Layout
All model-running artifacts should be managed under `./run_models_output/`:
- `run_models_output/preprocessed/`
	- `fmri/` (from `fmri-skill`)
	- `smri/` (from `smri-skill`, if required)
- `run_models_output/brain_gnn/`
- `run_models_output/fm_app/`
- `run_models_output/neurostorm/`
- `run_models_output/glm/`
- `run_models_output/ica/`
- `run_models_output/dictlearning/`
- `run_models_output/svm/`
- `run_models_output/spacenet/`
- `run_models_output/kmeans/`
- `run_models_output/hierarchical/`
- `run_models_output/filtering/`
- `run_models_output/detrending/`
- `run_models_output/logs/`
- `run_models_output/reports/`

---

## Safety and Execution Policy
- No execution before explicit user confirmation of the numbered plan.
- All run/install actions must go through `claw-shell`.
- If model skills are missing in `skills/<model-name>/`, stop and request or create them before execution.
- Keep train/val/test split and target definition explicit to avoid leakage.

---

## When to Call This Skill
- User asks to run BrainGNN or FM-APP.
- User asks to run NeuroStorm.
- User asks to run classical task activation analysis with GLM.
- User asks to run group-level inference with second-level GLM.
- User asks to perform resting-state network decomposition with ICA.
- User asks to perform resting-state network decomposition with DictLearning.
- User asks to perform disease classification with SVM.
- User asks to perform disease classification with SpaceNet.
- User asks to perform brain parcellation with K-means.
- User asks to perform brain parcellation with Hierarchical clustering.
- User asks to perform signal denoising with filtering.
- User asks to perform signal denoising with detrending.
- User asks which phenotype model to use for fMRI/sMRI ROI data.
- User asks for a unified entry point to model introduction + run routing.

---

## Complementary / Related Skills
- `fmri-skill`
- `smri-skill`
- `dependency-planner`
- `conda-env-manager`
- `claw-shell`

---

## Reference
- BrainGNN paper and code:
	- https://github.com/xxlya/BrainGNN_Pytorch/tree/main
- FM-APP paper and code:
	- https://github.com/ZhibinHe/FM-APP
- Nilearn GLM documentation:
  - https://nilearn.github.io/stable/glm/index.html

Created At: 2026-03-28 20:38 HKT
Last Updated At: 2026-04-14 00:28 HKT
Author: chengwang96