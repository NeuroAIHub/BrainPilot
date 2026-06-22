---
name: smri-skill
description: "Use this skill whenever the user wants to process structural MRI (sMRI) such as T1w/T2w/FLAIR for brain extraction, bias correction, tissue segmentation (GM/WM/CSF), registration to MNI, cortical/subcortical parcellation, cortical thickness/volumetry (FreeSurfer), HCP-style structural preprocessing, WMH lesion segmentation (FLAIR+T1), ROI-wise feature extraction, or converting results back to DICOM. This is the NeuroClaw modality-layer interface: it plans WHAT to do and delegates execution to tool skills."
license: MIT License (NeuroClaw custom skill – freely modifiable within the project)
layer: subagent
skill_type: modality
dependencies:
  - freesurfer-tool
  - fsl-tool
  - wmh-segmentation
  - nii2dcm
  - claw-shell
complementary_skills:
  - fmri-skill
  - dwi-skill
---
# sMRI Skill (Modality Layer)

## Overview
`smri-skill` is the NeuroClaw **modality-layer** interface skill responsible for **structural MRI** processing (T1w/T2w/FLAIR) and feature extraction.

It strictly follows NeuroClaw hierarchical design principles:
- This skill describes **WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code** and **no direct shell commands**.
- All concrete execution is delegated to tool skills and routed through `claw-shell`.

**Core workflow (never bypassed):**
1. Identify input type (DICOM / NIfTI / BIDS), modalities available (T1w only vs T1w+T2w vs T1w+FLAIR).
2. Generate a **numbered execution plan** (steps, tools, outputs, runtime, risks).
3. Present the plan and wait for explicit user confirmation (“YES” / “execute” / “proceed”).
4. On confirmation, delegate each step via `claw-shell`.
5. Save outputs into a clean folder structure (`smri_output/`).

## Benchmark-Facing Default Mainline

For benchmark-style structural MRI tasks, start from the narrowest valid anatomical mainline and only add optional branches when the prompt or inputs explicitly require them.

- If the task is full structural MRI processing with no explicit T2w or FLAIR dependency:
  - Default to `DICOM -> NIfTI if needed -> T1w mainline -> FreeSurfer recon-all -> feature/stat table export`.
  - Keep T2w, FLAIR, WMH, HCP structural, and DICOM re-export as optional branches, not default branches.
- If the task is only DICOM conversion:
  - Delegate to `dcm2nii` and stop there.
- If the task asks for quick volumetric preprocessing only:
  - Prefer the `fsl-tool` route rather than mixing FreeSurfer and HCP options in the mainline.
- If optional modalities or branches are missing:
  - Mark them as skipped or blocked.
  - Do not widen the task into unrelated structural subpipelines.

Avoid listing unrelated modality-adjacent tools in the primary plan for T1-only structural benchmarks.

**Research use only.**

---

## Quick Reference (Common sMRI Tasks → Delegation Map)

| Task | What needs to be done (high level) | Delegate to which skill | Expected outputs |
|---|---|---|---|
| DICOM → NIfTI | Convert DICOM series to NIfTI (+ JSON) | `dcm2nii` | `*_T1w.nii.gz`, `*_T2w.nii.gz`, `*_FLAIR.nii.gz`, `*.json` |
| Organize to BIDS | Create valid BIDS layout (anat/) | `bids-organizer` | `bids/sub-*/anat/sub-*_T1w.nii.gz` etc. |
| Fast structural preprocessing | Brain extraction, bias correction, tissue segmentation, MNI registration | `fsl-tool` (`fsl_anat`, BET/FAST/FLIRT/FNIRT) | brain mask, tissue maps, transforms, QC |
| FreeSurfer Autorecon1 (volumetric preprocessing) | Image conversion, motion correction, intensity normalization, registration to Talairach, bias correction, skull stripping | `freesurfer-tool` (`recon-all -autorecon1`) | `orig.mgz`, `T1.mgz`, `brainmask.mgz`, `transforms/talairach.xfm` |
| FreeSurfer Autorecon2 (subcortical segmentation & surface extraction) | Tissue classification, white matter segmentation, surface tessellation, topology repair, white matter & pial surface generation | `freesurfer-tool` (`recon-all -autorecon2`) | `?h.orig`, `?h.white`, `?h.pial`, `aseg.mgz`, `wm.mgz`, surface QC |
| FreeSurfer Autorecon3 (spherical registration & parcellation) | Spherical surface registration, cortical parcellation (Desikan-Killiany, Destrieux, DKT), anatomical statistics extraction, Brodmann area mapping | `freesurfer-tool` (`recon-all -autorecon3`) | `?h.sphere.reg`, `?h.aparc.annot`, `stats/?h.aparc.stats`, ROI morphology tables |
| Full FreeSurfer pipeline (all 3 stages) | Complete T1/T2 preprocessing with optional T2-pial refinement | `freesurfer-tool` (`recon-all -all -T2pial`) | Full FreeSurfer subject directory with surfaces, atlases, stats |
| Surface-based morphometry (quick) | Cortical surfaces, parcellation, thickness, aseg/aparc stats (simplified) | `freesurfer-tool` | FreeSurfer subject dir, stats tables |
| HCP-grade structural pipeline | PreFreeSurfer → FreeSurfer → PostFreeSurfer | `hcppipeline-tool` | HCP-style derivatives, surfaces, QC |
| BIDS anatomical derivatives (standardized) | Run BIDS-App anatomical-only workflow | `fmriprep-tool` (`--anat-only`) | BIDS derivatives + QC report |
| WMH lesion segmentation | Segment WMH from FLAIR+T1 | `wmh-segmentation` (+ `docker-env-manager` if Docker ops needed) | WMH mask NIfTI + run log |
| ROI-wise feature extraction | Extract ROI stats from derived maps (GM prob, WMH mask, thickness maps in NIfTI, cortical thickness, surface-based stats) | `nilearn-tool` (or `fsl-tool` `fslstats`, FreeSurfer `mris_anatomical_stats`) | `roi_stats_*.csv`, morphology tables |
| Export results to DICOM | Convert final NIfTI outputs back to DICOM series | `nii2dcm` | DICOM series for PACS/viewers |

---

## Recommended Strategy (Decision Logic)
- If the goal is **quick brain extraction + tissue segmentation + MNI alignment** (fast baseline, ~6 minutes):
  - Prefer `fsl-tool` (`fsl_anat`).
  - Best for: quick QC, preprocessing, multi-subject batches.

- If the goal is **cortical thickness / surface parcellation / aseg-aparc volumetry** (detailed surface morphometry):
  - Prefer `freesurfer-tool` (`recon-all`) with **3-stage execution** (recommended for flexibility):
    - **Stage 1: `-autorecon1`** (volumetric preprocessing, ~15-30 min)
      - Produces: intensity-normalized brain image (`T1.mgz`), Talairach registration (`talairach.xfm`), brain mask (`brainmask.mgz`).
      - Use when: you need just preprocessing, quality control, or pial surface refinement before running surface extraction.
    - **Stage 2: `-autorecon2`** (white matter segmentation & surface extraction, ~30-60 min)
      - Produces: white matter mask (`wm.mgz`), initial surfaces (`?h.orig`, `?h.white`, `?h.pial`), segmentation (`aseg.mgz`).
      - Use when: you need cortical surfaces for thickness measurement, but haven't registered to standard space yet.
    - **Stage 3: `-autorecon3`** (spherical registration & parcellation, ~15-30 min)
      - Produces: registered sphere (`?h.sphere.reg`), cortical parcellations (`?h.aparc.annot`, `?h.aparc.a2009s.annot`, `?h.aparc.DKTatlas.annot`), morphometric statistics (`stats/?h.aparc.stats`).
      - Use when: you need full atlas-based ROI labels, cortical thickness maps, and anatomical statistics for group-level analysis.
  - **Quick execution**: Run `recon-all -all -T2pial` (if T2 available, ~2-3 hours total) for immediate full results.
  - Best for: surface-based group analysis, cortical thickness studies, clinico-anatomical correlation.

- If the goal is **highest-quality, HCP-style surfaces and multimodal alignment**:
  - Prefer `hcppipeline-tool` (structural stages).
  - Best for: HCP datasets, publication-grade preprocessing, maximal anatomical detail.

- If the dataset is already **BIDS** and you want **standardized derivatives + QC** (and future fMRI integration):
  - Prefer `fmriprep-tool --anat-only` (or full fMRIPrep if fMRI exists).
  - Best for: reproducible BIDS-compliant preprocessing, multi-modal (fMRI-ready), open science.

- If the goal is **WMH lesion segmentation** (vascular burden, aging, MS-like WM lesions):
  - Use `wmh-segmentation` (Docker-based); ensure Docker readiness via `docker-env-manager` if needed.
  - Best for: FLAIR+T1 pathological lesion mapping.

- If the goal is **ROI-level tables** from any NIfTI scalar map (thickness, volume, WMH count, etc.):
  - Use `nilearn-tool` to generate reproducible CSV feature tables.
  - Best for: downstream statistical analysis, machine learning pipelines.

---

## FreeSurfer Setup & Prerequisites (Ubuntu)

### System Dependencies & Installation
For Ubuntu 22.04+ systems, `freesurfer-tool` must ensure:

#### 1. System-level Dependencies
```bash
sudo apt-get update
sudo apt-get install -y \
  tcsh bc perl tar libgomp1 build-essential \
  wget vim-common libxmu-dev libxi-dev libxt-dev \
  libx11-dev libglu1-mesa-dev libjpeg62-dev
```

#### 2. FreeSurfer Installation & License
- **Download** FreeSurfer 7.4.1 (or newer): Install to `/usr/local/freesurfer/`
- **License file**: Obtain from https://surfer.nmr.mgh.harvard.edu/fswiki/License → place at `/usr/local/freesurfer/license.txt`

#### 3. Environment Configuration (in shell profile, e.g., `.bashrc`)
```bash
export FREESURFER_HOME=/usr/local/freesurfer
export SUBJECTS_DIR=/path/to/your/freesurfer/subjects
source $FREESURFER_HOME/SetUpFreeSurfer.sh
```

### When to Use Each Stage

| Stage | Command | Input | Output | Runtime | Use Case |
|---|---|---|---|---|---|
| **Autorecon1** | `recon-all -autorecon1 -i <T1.nii.gz> -subjid <sub>` | T1w NIfTI (mandatory) | `orig.mgz`, `T1.mgz`, `brainmask.mgz`, Talairach xfm | 15–30 min | Preprocessing only, QC checkpoints, T2-pial setup |
| **Autorecon2** | `recon-all -autorecon2 -subjid <sub>` | (uses autorecon1 outputs) | `wm.mgz`, surfaces (`?h.orig`, `?h.white`, `?h.pial`) | 30–60 min | Cortical surface extraction, thickness measurement |
| **Autorecon3** | `recon-all -autorecon3 -subjid <sub>` | (uses autorecon2 outputs) | `?h.sphere.reg`, `?h.aparc.annot`, stats tables | 15–30 min | Atlas registration, ROI labels, group analysis ready |
| **All (1-click)** | `recon-all -all -T2pial -i <T1.nii.gz> -T2 <T2.nii.gz> -subjid <sub>` | T1w (required), T2w (optional but improves pial surface) | Complete subject dir | 2–3 hours | Full pipeline; T2-pial refines pial boundary |

---

## Standard Output Layout (Recommended)
All outputs must be written under `./smri_output/`:
- `smri_output/nifti/`        (converted inputs if needed: `*_T1w.nii.gz`, `*_T2w.nii.gz`)
- `smri_output/bids/`         (optional staging BIDS: `bids/sub-*/anat/`)
- `smri_output/fsl_anat/`     (FSL structural outputs: brain mask, tissue maps, transforms)
- `smri_output/freesurfer/`   (FreeSurfer SUBJECTS_DIR structure)
  - `freesurfer/sub-01/mri/`
    - `orig.mgz`, `T1.mgz`, `T2.mgz` (if T2 available)
    - `brainmask.mgz`, `wm.mgz`, `norm.mgz`
    - `aseg.mgz`, `aparc+aseg.mgz`, `wmparc.mgz` (after autorecon2+3)
    - `transforms/talairach.xfm`, `cc_up.lta`, etc.
  - `freesurfer/sub-01/surf/`
    - `?h.orig`, `?h.white`, `?h.pial` (surfaces)
    - `?h.sphere.reg` (registered sphere, after autorecon3)
    - `?h.inflated`, `?h.sphere` (topological surfaces)
  - `freesurfer/sub-01/label/`
    - `?h.aparc.annot`, `?h.aparc.a2009s.annot`, `?h.aparc.DKTatlas.annot` (parcellations, after autorecon3)
    - `?h.cortex.label`, `?h.BA*.label` (Brodmann areas, after autorecon3)
  - `freesurfer/sub-01/stats/`
    - `?h.aparc.stats`, `?h.aparc.a2009s.stats`, `?h.aparc.DKTatlas.stats` (cortical morphometry)
    - `aseg.stats`, `wmparc.stats` (subcortical volumes)
    - `?h.curv.stats` (curvature statistics)
- `smri_output/hcp/`          (HCP structural outputs)
- `smri_output/fmriprep/`     (fMRIPrep derivatives/QC pointers)
- `smri_output/wmh/`          (WMH masks + logs)
- `smri_output/roi/`          (ROI feature CSVs extracted from FreeSurfer stats or NIfTI-based ROIs)
- `smri_output/logs/`         (claw-shell log tags / pointers, FreeSurfer recon-all logs)

---

## Safety / Execution Rules (NeuroClaw)
- **No execution without explicit user confirmation** of the full numbered plan.
- All execution must be routed through `claw-shell`.
- If a required dependency is missing, delegate installation planning to `dependency-planner`.
- If Docker is required (e.g., WMH segmentation containers), coordinate via `docker-env-manager` (plan → confirm → run).

---

## Important Notes & Limitations
- **Structural pipelines are long-running** (especially FreeSurfer/HCP). Always provide realistic runtime + disk estimates in the plan:
  - Autorecon1: 15–30 min, ~2 GB disk
  - Autorecon2: 30–60 min, ~1 GB additional
  - Autorecon3: 15–30 min, ~500 MB additional
  - Full pipeline (`-all`): 2–3 hours total, ~4–5 GB disk per subject
- **FreeSurfer License**: Required and must be placed at `$FREESURFER_HOME/license.txt`. Obtain from https://surfer.nmr.mgh.harvard.edu/fswiki/License (free registration).
- **T2-pial optimization**: Include T2w image with `-T2 <file> -T2pial` flags to refine pial surface in cortical regions with ambiguous GM/CSF boundaries. Recommended for HCP and high-resolution clinical datasets.
- **System dependencies**: Unix/Linux-only (macOS with Rosetta2 for ARM; Windows via WSL2). Requires X11 forwarding for visualization tools.
- **ROI extraction**: Surface-based ROIs from FreeSurfer `.annot` files can be extracted via `mris_anatomical_stats` (built-in) or converted to NIfTI via `mri_aparc2aseg` for volumetric ROI analysis.
- **Registration outputs**: FreeSurfer surfaces (`?h.sphere.reg`) are registered to average template space; enables cross-subject statistical inference via QDEC or nilearn.
- **This skill is for research workflows**; not for clinical decision-making.

---

## When to Call This Skill
- Any request involving: T1w/T2w/FLAIR preprocessing, brain extraction, tissue segmentation, MNI registration, cortical thickness, FreeSurfer recon-all, HCP structural pipeline, WMH segmentation, or ROI-wise structural features.

## Post-Execution Verification (Harness Integration)

After structural MRI processing completes, this skill **automatically invokes harness-core's VerificationRunner** to validate structural derivatives:

**Integrated verification checks**:

```python
from skills.harness_core import VerificationRunner, AuditLogger
import nibabel as nib
import numpy as np

verifier = VerificationRunner(task_type="structural_mri_processing")

# 1. Structural brain extraction quality
verifier.add_check("brain_extraction_mask",
    checker=lambda: verify_brain_mask_exists(output_dir),
    severity="error"
)

# 2. Tissue segmentation (GM/WM/CSF) available and reasonable
verifier.add_check("tissue_segmentation",
    checker=lambda: verify_tissue_maps_integrity(output_dir),
    severity="error"
)

# 3. MNI registration transforms
verifier.add_check("mni_registration",
    checker=lambda: verify_mni_transforms(output_dir),
    severity="warning"
)

# 4. Cortical surface files (if FreeSurfer)
verifier.add_check("cortical_surfaces",
    checker=lambda: verify_freesurfer_surfaces(output_dir),
    severity="warning"
)

# 5. No NaN/Inf in structural maps
verifier.add_check("structural_data_integrity",
    checker=lambda: verify_structural_no_nan_inf(output_dir),
    severity="error"
)

# 6. Cortical thickness reasonable range (if available)
verifier.add_check("cortical_thickness_bounds",
    checker=lambda: verify_thickness_range(output_dir, min_mm=1.0, max_mm=4.0),
    severity="warning"
)

# 7. Volume statistics plausible
verifier.add_check("volume_statistics",
    checker=lambda: verify_tissue_volume_ratios(output_dir),
    severity="warning"
)

report = verifier.run(output_dir)

# Log verification results
logger = AuditLogger(log_file=f"{output_dir}/structural_verification.jsonl")
logger.log_validation(
    task_name="structural_mri_processing",
    checks_passed=len([r for r in report.results if r.passed]),
    checks_failed=len([r for r in report.results if not r.passed]),
    warnings=len([r for r in report.results if r.severity == "warning" and not r.passed]),
    report_summary=report.to_dict()
)

if report.failed:
    raise ValueError(f"Structural MRI verification failed: {report.summary}")
```

**Output files generated**:
- `{output_dir}/structural_verification.jsonl` — structured audit log
- `{output_dir}/.structural_verification_timestamp` — completion marker

## Complementary / Related Skills

- `dcm2nii` → DICOM → NIfTI
- `fsl-tool` → fsl_anat / BET / FAST / FIRST / registration utilities
- `freesurfer-tool` → cortical & subcortical morphometry + thickness/parcellation
- `hcppipeline-tool` → HCP-style structural pipeline
- `fmriprep-tool` → standardized BIDS-App anatomical-only derivatives + QC
- `wmh-segmentation` → WMH lesion mask from FLAIR+T1 (Docker)
- `docker-env-manager` → safe Docker operations (when needed)
- `nilearn-tool` → ROI feature extraction from structural-derived NIfTI maps
- `nii2dcm` → export final NIfTI results back to DICOM
- `dependency-planner` + `conda-env-manager` → installation/environment management
- `claw-shell` → mandatory safe execution layer
- `harness-core` → automated verification and audit logging

---

## Reference
Aligned with NeuroClaw modality-skill pattern (see `fmri-skill`, `dwi-skill`, `eeg-skill`).
Common sMRI toolchain: FSL (fast structural utilities), FreeSurfer (surface morphometry), HCP pipelines (HCP-grade structural processing), fMRIPrep (BIDS anatomical derivatives), Nilearn (ROI features on NIfTI maps), MARS-WMH (WMH segmentation via Docker).

Created At: 2026-03-26 01:09 HKT
Last Updated At: 2026-04-05 02:01 HKT
Author: chengwang96