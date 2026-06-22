---
name: fsl-tool
description: "Use this skill whenever the user wants to process neuroimaging data with FSL (FMRIB Software Library), covering structural MRI, functional MRI (fMRI), and diffusion MRI (dMRI/DTI). Triggers include: 'use FSL', 'FSL processing', 'fsl_anat', 'FEAT', 'MELODIC', 'eddy', 'bedpostx', 'probtrackx', 'BET', 'FAST', 'FLIRT', 'FNIRT', 'run FSL pipeline'. This skill is the NeuroClaw interface-layer wrapper for FSL: checks installation, generates execution plan with concrete shell commands, waits for explicit confirmation, then routes all commands through claw-shell."
license: MIT License (NeuroClaw custom skill – freely modifiable within the project)
layer: base
skill_type: tool
dependencies:
  - claw-shell
---
# FSL Tool

## Overview

FSL is a comprehensive library of analysis tools for MRI, fMRI, and diffusion brain imaging. This skill provides a safe, unified interface for the three core modalities in NeuroClaw:

- Structural MRI (T1w, T2w, FLAIR)  
- Functional MRI (task-based and resting-state)  
- Diffusion MRI (DTI / dMRI)

**Workflow**:

1. Check if FSL is installed (`fslversion`).  
2. If not installed → call `dependency-planner` to generate installation plan.  
3. Analyze input files and propose concrete shell commands with parameter explanations.  
4. Present full numbered plan + estimated time + risks.  
5. Wait for explicit user confirmation (“YES”, “execute”, “proceed”).  
6. Execute all commands safely via `claw-shell`.  
7. Summarize outputs and suggest next steps.

**Research use only.**

## Core Modalities and Common Shell Commands

### 1. Structural MRI
```bash
# One-click structural preprocessing (strongly recommended)
fsl_anat -i T1w.nii.gz -o T1w_anat --clobber
# -i : input T1w file
# -o : output folder name
# --clobber : overwrite existing files (commonly used)

# Brain extraction (BET)
bet T1w.nii.gz T1w_brain -m -f 0.5
# -m : output brain mask (_mask.nii.gz)
# -f : brain extraction threshold (0.3~0.7; 0.5 is usually stable)

# Tissue segmentation + bias correction
fast -t 1 -n 3 -H 0.1 -I 4 -l 20.0 -o T1w_fast T1w_brain
# -t 1 : T1-weighted image
# -n 3 : 3 tissue classes (GM, WM, CSF)
# -H 0.1 : bias field correction strength

# Linear + nonlinear registration to MNI152
flirt -in T1w_brain -ref $FSLDIR/data/standard/MNI152_T1_2mm_brain -out T1w_to_MNI -omat T1w_to_MNI.mat -dof 12
fnirt --in=T1w_brain --aff=T1w_to_MNI.mat --cout=T1w_to_MNI_warp --config=T1_2_MNI152_2mm

# Subcortical segmentation
first -i T1w_brain -o T1w_first -b
```

### 2. Functional MRI
```bash
# Motion correction
mcflirt -in bold.nii.gz -out bold_mcf -plots -refvol 0

# Task-based fMRI full analysis (FEAT)
feat design.fsf

# Resting-state ICA
melodic -i bold_mcf.nii.gz -o melodic_output --report --nobet --bgthreshold=10 --tr=2.0 --mmthresh=0.5 --dim=30

# Automatic denoising (FIX)
fix melodic_output -c $FSLDIR/training_files/Standard.RData -m -f 20
```

### 3. Diffusion MRI
```bash
# Distortion and eddy current correction
topup --imain=AP_PA_b0.nii.gz --datain=acqparams.txt --out=topup_results --fout=field --iout=b0_unwarped
eddy --imain=dwi.nii.gz --mask=dwi_brain_mask.nii.gz --acqp=acqparams.txt --index=index.txt \
     --bvecs=bvecs --bvals=bvals --topup=topup_results --out=eddy_corrected --very_verbose

# Tensor fitting
dtifit -k eddy_corrected.nii.gz -m dwi_brain_mask.nii.gz -r bvecs -b bvals -o dtifit

# Multi-fiber modeling
bedpostx bedpostx_input -n 3 -w 1 -b 1000

# Automated major tract extraction
xtract -bpx bedpostx_input.bedpostX -out xtract_results -str $FSLDIR/data/xtract/tracts.txt
```

## Quick Reference

| Modality     | Task                        | Main Command                  | Typical Time      |
|--------------|-----------------------------|-------------------------------|-------------------|
| Structural   | Full preprocessing          | `fsl_anat`                    | 10–40 min        |
| Structural   | Brain extraction            | `bet`                         | 1–3 min          |
| Structural   | Tissue segmentation         | `fast`                        | 5–15 min         |
| Functional   | Motion correction           | `mcflirt`                     | 2–10 min         |
| Functional   | Task GLM                    | `feat`                        | 15–90 min        |
| Functional   | Resting-state ICA           | `melodic`                     | 20–120 min       |
| Diffusion    | Preprocessing               | `topup + eddy`                | 30–180 min       |
| Diffusion    | Tensor metrics              | `dtifit`                      | 5–20 min         |
| Diffusion    | Tractography                | `probtrackx2 / xtract`        | 30 min – 24 h+   |

## Installation

Use `dependency-planner` skill with one of the following requests:
- “Install latest FSL on Ubuntu using official installer”  
- “Install FSL via conda-forge in a new environment”

After installation, verify with:
```bash
fslversion
echo $FSLDIR
```

## Important Notes & Limitations

- All actual execution is routed through `claw-shell`.  
- Long-running commands (bedpostx, probtrackx, group FEAT, etc.) run safely in the `claw` tmux session.  
- Always consider running `fsl_anat` first for structural data — it handles BET + FAST + registration automatically.  
- Input must be NIfTI format. Use `dcm2nii` skill first if starting from DICOM.  
- Monitor progress with `tail -f` on the log file provided by claw-shell.

## When to Call This Skill

- After `dcm2nii` conversion  
- When any FSL preprocessing, registration, segmentation or advanced analysis is needed  
- Before feeding quantitative results into `paper-writing` or `experiment-controller`

## Complementary / Related Skills

- `dependency-planner`  
- `claw-shell`  

## More Advanced Features

For less common tools (ASL, FABBER, VBM, PALM, custom scripting, etc.), please refer to the official FSL documentation:
- Official FSL Website: https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/  
- Structural tools: https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/Structural  
- Functional tools: https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/FEAT  
- Diffusion tools: https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/FDT  
- Full tool list: https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/FSL  

You may use the `multi-search-engine`, `academic-research-hub`, or `arxiv-cli-tools` skill anytime to find the latest FSL tutorials or example pipelines.

## Post-Execution Verification (Harness Integration)

After FSL processing completes, this skill **automatically invokes harness-core's VerificationRunner** to validate output integrity:

**Integrated verification checks**:

```python
from skills.harness_core import VerificationRunner, AuditLogger

verifier = VerificationRunner(task_type="fsl_processing")

# 1. Brain extraction quality (BET)
verifier.add_check("brain_extraction",
    checker=lambda: verify_bet_output(output_dir),
    severity="error"
)

# 2. FSL output files existence
verifier.add_check("output_files",
    checker=lambda: verify_output_files(output_dir),
    severity="error"
)

# 3. Data integrity (NaN/Inf checks)
verifier.add_check("data_integrity",
    checker=lambda: verify_no_nan_inf(output_dir),
    severity="error"
)

# 4. Registration quality metrics
verifier.add_check("registration_quality",
    checker=lambda: verify_registration_quality(output_dir),
    severity="warning"
)

# 5. Tensor metrics bounds (for DTI/DWI)
verifier.add_check("tensor_bounds",
    checker=lambda: verify_fa_md_bounds(output_dir),
    severity="warning"
)

report = verifier.run(output_dir)

# Log verification results
logger = AuditLogger(log_file=f"{output_dir}/fsl_verification.jsonl")
logger.log_validation(
    task_name="fsl_processing",
    checks_passed=len([r for r in report.results if r.passed]),
    total_checks=len(report.results),
    output_path=output_dir
)
```

**Output**: `{output_dir}/fsl_verification.jsonl` (structured audit log with JSONL format)

---

Created At: 2026-03-25 00:00 HKT  
Last Updated At: 2026-04-05 02:03 HKT  
Author: chengwang96