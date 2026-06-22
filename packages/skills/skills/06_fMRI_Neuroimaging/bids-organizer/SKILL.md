---
name: bids-organizer
description: "Use this skill whenever the user wants to automatically organize raw neuroimaging data (DICOM, NIfTI, EEG, etc.) into a valid BIDS (Brain Imaging Data Structure) dataset. Triggers include: 'organize to BIDS', 'BIDS organizer', 'convert to BIDS', 'BIDS conversion', 'bidsify', 'create BIDS dataset', 'raw data to BIDS', or any request to structure data according to BIDS specification."
license: MIT License (NeuroClaw custom skill – freely modifiable within the project)
layer: subagent
skill_type: tool
dependencies:
  - dcm2nii
  - claw-shell
---
# BIDS Organizer (Tool Layer)

## Overview

BIDS Organizer is the NeuroClaw interface-layer skill that automatically converts raw or semi-organized neuroimaging data into a standardized BIDS-compliant dataset.

It supports DICOM → NIfTI conversion + BIDS naming, existing NIfTI reorganization, EEG (.set/.edf/.bdf/.fif), and basic metadata handling. The skill generates a clear execution plan, waits for user confirmation, then delegates all heavy work to appropriate base tools.

**Core workflow (never bypassed):**
1. Scan input directory and detect data types (DICOM, NIfTI, EEG, etc.).
2. Generate a numbered execution plan with proposed BIDS structure and subject/session labels.
3. Present the plan, estimated time, and risks; wait for explicit confirmation (“YES” / “execute” / “proceed”).
4. On confirmation, delegate tasks to `dcm2nii`, `mne-eeg-tool`, and `claw-shell`.
5. After completion, run BIDS validation and generate a summary report.

**Research use only.**

## Quick Reference

| Task                              | What needs to be done                                      | Delegate to which tool skill          | Expected output                     |
|-----------------------------------|------------------------------------------------------------|---------------------------------------|-------------------------------------|
| DICOM to BIDS                     | Convert DICOM → NIfTI + apply BIDS naming                  | `dcm2nii` + `claw-shell`              | BIDS-compliant NIfTI + JSON sidecars|
| Existing NIfTI to BIDS            | Rename and reorganize NIfTI files into BIDS hierarchy      | `claw-shell`                          | Properly named BIDS dataset         |
| EEG to BIDS                       | Convert .set/.edf/.bdf/.fif to BIDS EEG format             | `mne-eeg-tool` + `claw-shell`         | BIDS EEG files + events             |
| Create dataset_description.json   | Generate required BIDS metadata files                      | `claw-shell`                          | dataset_description.json            |
| Validate BIDS dataset             | Run bids-validator and generate report                     | `claw-shell`                          | validation report                   |
| Full automatic organization       | End-to-end raw data → valid BIDS dataset                   | All above tools                       | Complete BIDS dataset + QC report   |

## Common Shell Command Examples

```bash
# DICOM to BIDS (most common)
dcm2niix -o ./bids/sub-001/ses-01/anat -f "%p_%s" -b y -z y /path/to/dicom/T1

# Validate the resulting BIDS dataset
bids-validator /path/to/bids_dataset
```

## Installation (Handled by dependency-planner)

Use `dependency-planner` with requests such as:
- “Install dcm2niix and bids-validator”
- “Install MNE-Python for EEG to BIDS conversion”

After installation, verify with:
```bash
dcm2niix --version
bids-validator --version
```

## NeuroClaw recommended wrapper script

```python
# bids_organizer_wrapper.py (placed inside the skill folder for reference)
import subprocess
from pathlib import Path

def organize_to_bids(raw_dir, bids_dir, subject_id, session_id="01"):
    bids_dir = Path(bids_dir)
    bids_dir.mkdir(parents=True, exist_ok=True)
    
    # DICOM to BIDS example
    cmd = [
        "dcm2niix", "-o", str(bids_dir / f"sub-{subject_id}" / f"ses-{session_id}" / "anat"),
        "-f", "%p_%s", "-b", "y", "-z", "y", str(raw_dir)
    ]
    
    print("Executing:", " ".join(cmd))
    subprocess.run(cmd, check=True)
    
    # Create basic dataset_description.json
    desc = {
        "Name": "NeuroClaw BIDS Dataset",
        "BIDSVersion": "1.8.0",
        "DatasetType": "raw"
    }
    (bids_dir / "dataset_description.json").write_text(str(desc))
    
    print(f"BIDS dataset created at: {bids_dir}")
```

## Important Notes & Limitations

- This skill only generates the plan and delegates; actual file operations are performed via `claw-shell`.
- DICOM conversion relies on `dcm2nii`.
- EEG conversion is delegated to `mne-eeg-tool`.
- Always review the proposed BIDS structure (subject/session labels, run numbers) before confirmation.
- Large datasets may require significant disk space and time.

## When to Call This Skill

- Raw scanner data (DICOM) needs to be converted and organized into BIDS
- Existing NIfTI/EEG files need proper BIDS naming and folder structure
- Preparing data for `fmriprep-tool`, `hcppipeline-tool`, `fsl-tool`, or `fmri-skill`
- Before running any standardized preprocessing pipeline

## Benchmark-Facing Default Mainline

For benchmark-style BIDS organization tasks, do not expand into a generic all-modality organizer unless the task explicitly asks for that breadth.

- First identify the narrow target modality and output contract.
- Reuse only the BIDS pieces needed for that target modality.
- Do not pull in EEG branches, full multi-modality survey logic, or large wrapper orchestration when the task is only asking for one narrow anatomical or diffusion path.
- Do not treat the interactive confirmation-heavy core workflow as mandatory for benchmark tasks that explicitly ask for direct completion. In benchmark mode, the answer should default to the narrow executable organization path instead of plan-first / confirm-first orchestration.
- Do not make large review buckets such as `misc_nonbids_review/`, broad unresolved-item triage systems, or generic catch-all wrappers the center of the answer unless the prompt explicitly asks for audit/review handling.
- If the task is specifically structural MRI organization, keep the answer centered on:
    - DICOM to NIfTI conversion only if needed,
    - `sub-*/[ses-*/]anat/` placement,
    - valid suffix naming such as `T1w`, `T2w`, `FLAIR`,
    - required top-level files like `dataset_description.json`,
    - validator/report output.
- If the task is diffusion-only, keep the answer centered on `dwi/` organization and diffusion sidecars instead of broadening into whole-dataset BIDS strategy.
- If subject/session/modality cannot be inferred reliably, report the blocked item explicitly instead of widening into a generic heuristic-heavy organizer.

### Direct Mixed-Modality Benchmark Path

When the benchmark task asks for automatic organization of local DICOM/NIfTI/EEG raw data into BIDS, but does not ask for an interactive planner, default to this narrow path:

1. scan only for the modalities explicitly mentioned by the task,
2. organize those modalities into the required BIDS hierarchy,
3. generate the minimal required dataset metadata,
4. run validation and report concrete blockers,
5. stop there.

Do not turn this into a reusable platform-style organizer with review zones, broad plugin branches, or full modality-by-modality expansion unless the prompt explicitly asks for that breadth.

### Existing DWI NIfTI Sidecar Path

When the task already provides DWI `NIfTI + bval + bvec` files, the preferred mainline is:

1. detect valid DWI image / sidecar triplets,
2. infer `sub-`, optional `ses-`, and optional `run-` entities,
3. place outputs under `sub-*/[ses-*/]dwi/`,
4. preserve matching `.bval`, `.bvec`, and optional `.json`,
5. generate minimal dataset metadata and validate.

In this situation, do not broaden the answer into DICOM conversion, EEG conversion, or a whole-dataset mixed-modality organizer unless the prompt explicitly asks for those branches.

### Structural MRI Narrow Path

For narrow structural MRI BIDS tasks, the preferred mainline is:

1. detect whether input is DICOM or existing NIfTI,
2. convert with `dcm2niix` only when needed,
3. place outputs under `sub-*/[ses-*/]anat/`,
4. assign only the correct structural suffixes,
5. generate minimal required dataset metadata,
6. run BIDS validation and summarize unmapped files.

Do not replace that mainline with a broader all-modality organizer unless the prompt explicitly requests a full mixed-modality BIDS conversion.

## Post-Execution Verification (Harness Integration)

After BIDS organization completes, this skill **automatically invokes harness-core's VerificationRunner** to validate output integrity:

**Integrated verification checks**:

```python
from skills.harness_core import VerificationRunner, AuditLogger

verifier = VerificationRunner(task_type="bids_organization")

# 1. BIDS structure compliance
verifier.add_check("bids_structure", 
    checker=lambda: verify_bids_structure(bids_dir),
    severity="error"
)

# 2. Dataset description file
verifier.add_check("dataset_description",
    checker=lambda: verify_dataset_description_exists(bids_dir),
    severity="error"
)

# 3. Subject/session naming convention
verifier.add_check("naming_convention",
    checker=lambda: verify_bids_naming(bids_dir),
    severity="error"
)

# 4. Metadata JSON sidecar completeness
verifier.add_check("json_sidecars",
    checker=lambda: verify_json_sidecars(bids_dir),
    severity="warning"
)

# 5. Required BIDS files presence
verifier.add_check("required_files",
    checker=lambda: verify_required_files(bids_dir),
    severity="error"
)

report = verifier.run(bids_dir)

# Log verification results
logger = AuditLogger(log_file=f"{bids_dir}/bids_verification.jsonl")
logger.log_validation(
    task_name="bids_organization",
    checks_passed=len([r for r in report.results if r.passed]),
    checks_failed=len([r for r in report.results if not r.passed]),
    warnings=len([r for r in report.results if r.severity == "warning" and not r.passed]),
    report_summary=report.to_dict()
)

if report.failed:
    raise ValueError(f"BIDS verification failed: {report.summary}")
```

**Output files generated**:
- `{bids_dir}/bids_verification.jsonl` — structured audit log
- `{bids_dir}/.bids_validation_timestamp` — verification completion marker

## Complementary / Related Skills

- `dependency-planner` → install required tools
- `claw-shell` → safe execution of all commands
- `harness-core` → automated verification and audit logging

## More Advanced Features

For complex BIDS cases (multi-session, multi-run, custom metadata, HEUDICONV heuristics, etc.), please refer to the official BIDS specification:

- Official BIDS Website: https://bids.neuroimaging.io/
- BIDS Specification: https://bids-specification.readthedocs.io/

You may use the `multi-search-engine` or `academic-research-hub` skill to find the latest BIDS conversion best practices.

---
Created At: 2026-03-25 16:00 HKT  
Last Updated At: 2026-04-05 02:01 HKT
Author: chengwang96