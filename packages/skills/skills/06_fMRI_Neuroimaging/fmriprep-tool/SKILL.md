---
name: fmriprep-tool
description: "Use this skill whenever the user wants to perform standardized preprocessing of functional MRI (fMRI) and anatomical MRI data using fMRIPrep. Triggers include: 'fmriprep', 'fMRIPrep', 'fMRI preprocessing', 'BIDS fMRI', 'run fmriprep', 'preprocess bold', 'BOLD preprocessing', 'anatomical preprocessing', or any request involving BIDS-organized fMRI datasets."
license: MIT License (NeuroClaw custom skill – freely modifiable within the project)
layer: base
skill_type: tool
dependencies:
  - claw-shell
  - bids-organizer
---
# fMRIPrep Tool

## Overview

fMRIPrep is a robust, standardized preprocessing pipeline for BIDS-compliant functional and anatomical MRI data. It performs best-practice steps including anatomical segmentation, functional motion correction, susceptibility distortion correction, coregistration, normalization to standard space, and generates comprehensive QC reports.

This skill serves as the **NeuroClaw interface-layer wrapper** for fMRIPrep and strictly follows the hierarchical design:

1. Check whether fMRIPrep and its dependencies (Docker or Singularity) are installed.
2. If missing → invoke `dependency-planner` to generate a safe installation plan.
3. Detect input BIDS dataset structure and confirm output directory.
4. Generate a clear, numbered execution plan with exact command, flags, estimated runtime, and risks.
5. Present the plan and wait for explicit user confirmation (“YES” / “execute” / “proceed”).
6. On confirmation → delegate the entire pipeline execution to `claw-shell`.
7. After completion, summarize outputs, highlight QC reports, and suggest next steps (e.g., feeding results into analysis or paper-writing).

**Research use only.**

## Quick Reference

| Task                          | Recommended Command / Approach                                      | Typical Runtime (per subject) |
|-------------------------------|---------------------------------------------------------------------|-------------------------------|
| Full fMRIPrep pipeline        | `fmriprep bids_dir output_dir participant --fs-license-file license.txt` | 2–8 hours                    |
| Anatomical only               | `--anat-only`                                                       | 30–90 min                    |
| Functional only (after anat)  | `--bold-only`                                                       | 1–4 hours                    |
| Use FreeSurfer recon-all      | `--fs-subjects-dir /path/to/fs`                                     | +2–6 hours                   |
| Skip susceptibility distortion| `--ignore fieldmaps`                                                | Reduces time                 |
| Low memory mode               | `--mem-mb 8000 --nthreads 4`                                        | For limited resources        |
| Generate detailed QC reports  | Default behavior (outputs in `sub-*/figures/` and `reports/`)       | Included                     |

## Common Shell Command Examples

```bash
# Standard full pipeline (most common)
fmriprep \
  /data/bids \
  /data/fmriprep_output \
  participant \
  --participant-label sub-001 sub-002 \
  --fs-license-file /home/cwang/clawd/license.txt \
  --nthreads 8 \
  --mem-mb 16000 \
  --output-spaces MNI152NLin2009cAsym \
  --clean-workdir

# Anatomical preprocessing only
fmriprep /data/bids /data/fmriprep_output participant --anat-only

# Use Singularity instead of Docker (common on clusters)
singularity run --cleanenv \
  /path/to/fmriprep.simg \
  /data/bids /data/fmriprep_output participant \
  --fs-license-file /license.txt
```

## Installation (Handled by dependency-planner)

Use `dependency-planner` with one of the following requests:
- “Install latest fMRIPrep using Docker”
- “Install latest fMRIPrep using Singularity”
- “Install fMRIPrep via conda/mamba in neuroclaw-fmriprep environment”

After installation, verify with:
```bash
fmriprep --version
```

**Prerequisites**:
- Valid FreeSurfer license (`license.txt`)
- Docker or Singularity
- Sufficient disk space (~10–30 GB per subject) and RAM (≥16 GB recommended)

## NeuroClaw recommended wrapper script

```python
# fmriprep_wrapper.py (placed inside the skill folder for reference)
import subprocess
import argparse
from pathlib import Path

def run_fmriprep(bids_dir, output_dir, participant_labels=None, nthreads=8, mem_mb=16000):
    cmd = [
        "fmriprep",
        str(bids_dir),
        str(output_dir),
        "participant",
        "--fs-license-file", "/home/cwang/clawd/license.txt",
        "--nthreads", str(nthreads),
        "--mem-mb", str(mem_mb),
        "--output-spaces", "MNI152NLin2009cAsym",
        "--clean-workdir"
    ]
    
    if participant_labels:
        cmd.extend(["--participant-label"] + participant_labels)
    
    print("Running:", " ".join(cmd))
    subprocess.run(cmd, check=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--bids-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--subjects", nargs="+", default=None)
    args = parser.parse_args()
    
    run_fmriprep(args.bids_dir, args.output_dir, args.subjects)
```

## Important Notes & Limitations

- All actual fMRIPrep execution is routed through `claw-shell` (especially important for long-running pipelines).
- fMRIPrep is computationally intensive and disk-heavy. Always run with appropriate resource limits.
- A valid FreeSurfer license file is required if surface reconstruction is enabled.
- Outputs include preprocessed BOLD, anatomical derivatives, and rich HTML QC reports in `sub-*/figures/`.
- Work directory can become very large; use `--clean-workdir` when possible.

## When to Call This Skill

- User has a BIDS-organized dataset and wants standardized fMRI preprocessing.
- Before advanced analysis (GLM, connectivity, MVPA, etc.).
- After `dcm2nii` when converting raw scanner data to BIDS format.

## Post-Execution Verification (Harness Integration)

After fMRIPrep completes, this skill **automatically invokes harness-core's VerificationRunner** to validate preprocessing output quality:

**Integrated verification checks**:

```python
from skills.harness_core import VerificationRunner, AuditLogger
import json
from pathlib import Path

verifier = VerificationRunner(task_type="fmriprep_preprocessing")

# 1. Output directory structure
verifier.add_check("output_structure",
    checker=lambda: verify_fmriprep_output_structure(output_dir),
    severity="error"
)

# 2. Preprocessed BOLD integrity
verifier.add_check("bold_preprocessing",
    checker=lambda: verify_bold_files_exist(output_dir),
    severity="error"
)

# 3. Anatomical derivatives (T1w, brain mask)
verifier.add_check("anatomical_derivatives",
    checker=lambda: verify_anatomical_space_files(output_dir),
    severity="error"
)

# 4. Motion parameters / confounds file
verifier.add_check("confounds_available",
    checker=lambda: verify_confounds_files(output_dir),
    severity="warning"
)

# 5. No NaN/Inf in preprocessed BOLD data
verifier.add_check("bold_data_integrity",
    checker=lambda: verify_bold_no_nan_inf(output_dir),
    severity="error"
)

# 6. QC reports generated
verifier.add_check("qc_reports",
    checker=lambda: verify_qc_reports_exist(output_dir),
    severity="warning"
)

# 7. fMRIPrep HTML report accessible
verifier.add_check("html_report",
    checker=lambda: Path(output_dir).glob("**/report.html"),
    severity="warning"
)

report = verifier.run(output_dir)

# Log verification results
logger = AuditLogger(log_file=f"{output_dir}/fmriprep_verification.jsonl")
logger.log_validation(
    task_name="fmriprep_preprocessing",
    checks_passed=len([r for r in report.results if r.passed]),
    checks_failed=len([r for r in report.results if not r.passed]),
    warnings=len([r for r in report.results if r.severity == "warning" and not r.passed]),
    report_summary=report.to_dict()
)

if report.failed:
    raise ValueError(f"fMRIPrep verification failed: {report.summary}")
```

**Output files generated**:
- `{output_dir}/fmriprep_verification.jsonl` — structured audit log
- `{output_dir}/.fmriprep_verification_timestamp` — verification completion marker

## Complementary / Related Skills

- `dependency-planner` → install fMRIPrep and dependencies
- `claw-shell` → safe execution of long-running pipeline
- `harness-core` → automated verification and audit logging

## More Advanced Features

For advanced options (custom templates, surface-based processing, ICA-AROMA, etc.), please refer to the official fMRIPrep documentation:
- Official Documentation: https://fmriprep.org/
- User Guide: https://fmriprep.org/en/stable/
- BIDS App specification: https://bids-apps.neuroimaging.io/

You may use the `multi-search-engine` or `academic-research-hub` skill to retrieve the latest best practices or example commands.

---

Created At: 2026-03-25 17:10 HKT  
Last Updated At: 2026-04-05 02:01 HKT  
Author: chengwang96