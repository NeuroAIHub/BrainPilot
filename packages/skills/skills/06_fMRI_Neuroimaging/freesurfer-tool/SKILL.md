---
name: freesurfer-tool
description: "Use this skill whenever the user wants to process structural MRI data (T1w, T2w, FLAIR, etc.) with FreeSurfer, especially for cortical/subcortical segmentation, surface reconstruction, parcellation, cortical thickness, volume statistics, or full recon-all pipeline. Triggers include: 'freesurfer', 'recon-all', 'segment MRI', 'FreeSurfer processing', 'cortical segmentation', 'subcortical segmentation', 'run recon-all', 'freesurfer T1', 'process brain MRI with freesurfer', 'aseg aparc', or any request to run FreeSurfer on NIfTI MRI data for research analysis."
license: MIT License (NeuroClaw custom skill – freely modifiable within the project)
layer: base
skill_type: tool
dependencies:
  - claw-shell
---
# FreeSurfer Tool

## Overview

FreeSurfer is the gold-standard open-source suite for automated reconstruction of the brain’s cortical surface from structural MRI, including skull-stripping, intensity normalization, Talairach registration, cortical parcellation (Desikan-Killiany / Destrieux atlases), subcortical segmentation (`aseg`), surface mesh generation, cortical thickness estimation, and statistics.

This skill serves as the **NeuroClaw interface-layer wrapper** for FreeSurfer and strictly follows the hierarchical design:

1. Check whether FreeSurfer is installed (`recon-all --version`, `$FREESURFER_HOME` environment variable).  
2. If not found → immediately invoke `dependency-planner` to plan and (after user confirmation) install the latest stable FreeSurfer release + license setup.  
3. Collect and confirm: input NIfTI file(s), subject ID, output `SUBJECTS_DIR`, desired stages/flags (e.g. `-all`, `-autorecon1..3`, `-T2`, `-FLAIR`, `-parallel`).  
4. Generate a clear, numbered execution plan including exact shell commands.  
5. Present plan, estimated runtime, disk/RAM requirements, and risks → wait for explicit user confirmation (“YES” / “execute” / “proceed”).  
6. On confirmation → delegate **all** shell command execution to the `claw-shell` skill (environment setup, `recon-all` invocation, logging, progress monitoring).  
7. Report completion status, log location, output directory, and next steps.

**Key design principle (2026 update)**: No direct `subprocess.run()` calls for long-running FreeSurfer commands. All shell execution is routed through `claw-shell` for centralized logging, timeout handling, real-time output streaming, and interruption safety.

**Research use only.**

## Quick Reference (Common Use Cases)

| Task                              | Recommended `recon-all` flags / approach                          |
|-----------------------------------|-------------------------------------------------------------------|
| Full pipeline (most common)       | `-all`                                                            |
| Fast subcortical + basic surfaces | `-autorecon1 -autorecon2 -autorecon3`                             |
| Cortical surfaces & parcellation  | `-autorecon2 -autorecon3` (after `autorecon1` completed)          |
| Improve pial surface with T2      | `-T2 T2w.nii.gz`                                                  |
| Use FLAIR for better segmentation | `-FLAIR FLAIR.nii.gz`                                             |
| Enable multi-core acceleration    | `-parallel -openmp 8` (or match available cores)                  |
| Resume interrupted run            | Omit `-i` and `-all`, specify stages only                         |
| Generate statistics only          | `-stats`                                                          |

## Installation Check & Setup

Installation is **fully delegated** to `dependency-planner`.

When FreeSurfer is not detected:
- Call `dependency-planner` with request:  
  "Install latest stable FreeSurfer (8.1.0 or newer) on current OS, including license.txt setup"
- After user confirms the installation plan → `dependency-planner` handles download, package install, license placement
- This skill then verifies `$FREESURFER_HOME` and `recon-all` availability

**Prerequisites**:
- `dependency-planner` (mandatory for installation)
- `claw-shell` (mandatory for command execution)
- Valid FreeSurfer academic license (free registration required)
- ≥16 GB RAM recommended (32 GB+ strongly preferred for `-all`)

## Agent Reference Rule

When the agent needs FreeSurfer processing implementation code, it should first consult the curated snippet in `skills/freesurfer-tool/scripts/` instead of copying from the embedded wrapper below.

Reference snippet available:
- `scripts/freesurfer_processor.py` -> recon-all pipeline orchestration: environment setup, stage selection, parallel flags, claw-shell delegation

Example:
```bash
python skills/freesurfer-tool/scripts/freesurfer_processor.py \
    --input-mri sub-001_T1w.nii.gz \
    --subjid sub-001 \
    --subjects-dir /data/freesurfer_output \
    --stages all \
    --extra-flags "-T2 T2.nii.gz -parallel -openmp 12"
```

## NeuroClaw recommended wrapper script

```python
# freesurfer_processor.py
import argparse
import os
import sys
from pathlib import Path
from datetime import datetime

# In real NeuroClaw: these would be agent tool calls
def check_freesurfer_installed():
    # Simulate check via claw-shell
    # Real impl: call claw-shell with "recon-all --version"
    return False, "FreeSurfer not found (simulation mode)"

def delegate_to_claw_shell(commands, purpose, log_tag):
    print(f"[Delegating to claw-shell] Purpose: {purpose}")
    print(f"Log tag: {log_tag}")
    print("Commands to execute:")
    for cmd in commands:
        print("  " + cmd)
    # Real implementation: agent/tool call to claw-shell
    # e.g. tool_call("claw-shell", commands=commands, log_tag=log_tag, capture_output=True, timeout="24h")

def main():
    parser = argparse.ArgumentParser(description="NeuroClaw FreeSurfer Processor")
    parser.add_argument("--input-mri", required=True, help="Path to T1w (or other) NIfTI file")
    parser.add_argument("--subjid", required=True, help="Subject ID (e.g. sub-001)")
    parser.add_argument("--subjects-dir", required=True, help="Output SUBJECTS_DIR path")
    parser.add_argument("--stages", default="all", help="all / autorecon1 / autorecon2 / autorecon3 / stats / comma-separated stages")
    parser.add_argument("--extra-flags", default="", help="Additional flags, e.g. '-T2 T2.nii.gz -FLAIR FLAIR.nii.gz -parallel -openmp 12'")
    parser.add_argument("--plan-only", action="store_true", help="Show plan without execution")
    args = parser.parse_args()

    installed, version_info = check_freesurfer_installed()
    if not installed:
        print("FreeSurfer not detected on system.")
        print("→ Invoking dependency-planner to install FreeSurfer and set up license.")
        print("Please complete the dependency-planner confirmation flow first.")
        sys.exit(1)

    print("FreeSurfer detected:", version_info)

    subjects_dir = Path(args.subjects_dir).resolve()
    print(f"\nProcessing plan for subject: {args.subjid}")
    print(f"Input MRI     : {args.input_mri}")
    print(f"Output dir    : {subjects_dir}")
    print(f"Stages        : {args.stages}")
    if args.extra_flags:
        print(f"Extra flags   : {args.extra_flags}")

    # Build shell commands
    commands = []
    # 1. Set environment
    fs_home = "/usr/local/freesurfer"  # typical default; adjust if needed
    commands.append(f"export FREESURFER_HOME={fs_home}")
    commands.append(f"source $FREESURFER_HOME/SetUpFreeSurfer.sh")

    # 2. recon-all command
    recon_cmd = [
        "recon-all",
        "-subjid", args.subjid,
        "-i", args.input_mri
    ]

    if args.stages == "all":
        recon_cmd.append("-all")
    elif "," in args.stages:
        for stage in args.stages.split(","):
            stage = stage.strip()
            if stage:
                recon_cmd.append(f"-{stage}")
    else:
        recon_cmd.append(f"-{args.stages}")

    if args.extra_flags:
        recon_cmd.extend(args.extra_flags.split())

    # Recommend parallel execution if not disabled
    if "-parallel" not in args.extra_flags and "-openmp" not in args.extra_flags:
        recon_cmd.extend(["-parallel", "-openmp", "8"])

    commands.append(" ".join(recon_cmd))

    log_tag = f"freesurfer_{args.subjid}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    print("\nExecution plan (to be run via claw-shell):")
    for i, cmd in enumerate(commands, 1):
        print(f"Step {i}: {cmd}")

    print(f"\nEstimated runtime: 4–24 hours (full -all), 1–4 hours (segmentation stages only)")
    print(f"Disk usage: ~2–5 GB per subject")
    print(f"Logs will be captured by claw-shell under tag: {log_tag}")

    if args.plan_only:
        print("\nPlan-only mode — no execution performed.")
        return

    confirm = input("\nExecute now? Type YES to proceed: ").strip().upper()
    if confirm != "YES":
        print("Aborted by user.")
        return

    print("\nDelegating pipeline execution to claw-shell skill...")
    delegate_to_claw_shell(
        commands=commands,
        purpose=f"FreeSurfer processing for subject {args.subjid} ({args.stages})",
        log_tag=log_tag
    )

    print(f"→ Execution handed over to claw-shell.")
    print(f"→ Check logs using tag: {log_tag}")
    print(f"→ Final outputs will be in: {subjects_dir / args.subjid}")

if __name__ == "__main__":
    main()
```

## Important Notes & Limitations

- All actual shell command execution is delegated to `claw-shell` (no direct `subprocess` calls for `recon-all`).  
- Full `-all` pipeline is very long-running → `claw-shell` should support background/detached mode or long timeouts.  
- Input must be NIfTI (`.nii` or `.nii.gz`); convert DICOM first using `dcm2nii` skill.  
- Output follows standard FreeSurfer structure: `$SUBJECTS_DIR/<subjid>`.  
- Windows users: strongly recommended to use WSL2 (installation handled by `dependency-planner`).  
- License check: skill assumes `license.txt` is already in place after `dependency-planner` run.

## When to Call This Skill

- User provides structural MRI (NIfTI) and wants automated FreeSurfer processing.  
- Any mention of `recon-all`, `aseg`, `aparc`, cortical thickness, surface reconstruction, or FreeSurfer statistics.

## Complementary / Related Skills

- `dependency-planner` → install FreeSurfer + license  
- `claw-shell` → safe execution of long-running shell commands  
- `conda-env-manager` → manage Python environment for post-processing FreeSurfer outputs  

## Reference

Official site: https://surfer.nmr.mgh.harvard.edu  
Latest stable release (as of 2026): FreeSurfer 8.1.0 or newer  
License registration: https://surfer.nmr.mgh.harvard.edu/registration.html  
Documentation: https://surfer.nmr.mgh.harvard.edu/fswiki/FreeSurferWiki  

Custom NeuroClaw skill created to integrate FreeSurfer safely into the hierarchical skill structure.

Curated reference snippet in this skill:
- `skills/freesurfer-tool/scripts/freesurfer_processor.py`

## Post-Execution Verification (Harness Integration)

After FreeSurfer processing completes, this skill **automatically invokes harness-core's VerificationRunner** to validate output integrity:

**Integrated verification checks**:

```python
from skills.harness_core import VerificationRunner, AuditLogger

verifier = VerificationRunner(task_type="freesurfer_processing")

# 1. Brain-extracted anatomy files
verifier.add_check("brain_extraction",
    checker=lambda: verify_brain_extraction(subjects_dir, subjid),
    severity="error"
)

# 2. Cortical surface files (white, pial)
verifier.add_check("surface_reconstruction",
    checker=lambda: verify_surface_files(subjects_dir, subjid),
    severity="error"
)

# 3. Cortical thickness bounds (1–4 mm range)
verifier.add_check("thickness_bounds",
    checker=lambda: verify_cortical_thickness_range(subjects_dir, subjid),
    severity="warning"
)

# 4. parcellation labels (aparc/aseg)
verifier.add_check("parcellation",
    checker=lambda: verify_aparc_aseg(subjects_dir, subjid),
    severity="error"
)

# 5. Statistics file completeness
verifier.add_check("statistics",
    checker=lambda: verify_stats_files(subjects_dir, subjid),
    severity="warning"
)

report = verifier.run(subjects_dir)

# Log verification results
logger = AuditLogger(log_file=f"{subjects_dir}/{subjid}/freesurfer_verification.jsonl")
logger.log_validation(
    task_name="freesurfer_processing",
    subject_id=subjid,
    checks_passed=len([r for r in report.results if r.passed]),
    total_checks=len(report.results)
)
```

**Output**: `{SUBJECTS_DIR}/{subjid}/freesurfer_verification.jsonl` (structured audit log with JSONL format)

---

Created At: 2026-03-19 20:00 HKT  
Last Updated At: 2026-04-05 02:03 HKT  
Author: chengwang96