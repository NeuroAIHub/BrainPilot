"""FreeSurfer Processor Reference - recon-all pipeline orchestration.

Distilled from the NeuroClaw freesurfer-tool SKILL.md.
Agent should consult this script instead of copying from SKILL.md directly.

Usage:
    python skills/freesurfer-tool/scripts/freesurfer_processor.py \
        --input-mri sub-001_T1w.nii.gz \
        --subjid sub-001 \
        --subjects-dir /data/freesurfer_output \
        --stages all \
        --extra-flags "-T2 T2.nii.gz -parallel -openmp 12"

    # Plan only (no execution):
    python skills/freesurfer-tool/scripts/freesurfer_processor.py \
        --input-mri sub-001_T1w.nii.gz \
        --subjid sub-001 \
        --subjects-dir /data/freesurfer_output \
        --plan-only
"""

import argparse
import sys
from pathlib import Path
from datetime import datetime


def check_freesurfer_installed():
    """Check if FreeSurfer is available on the system."""
    # Simulate check via claw-shell
    # Real impl: call claw-shell with "recon-all --version"
    return False, "FreeSurfer not found (simulation mode)"


def delegate_to_claw_shell(commands, purpose, log_tag):
    """Delegate command execution to claw-shell."""
    print(f"[Delegating to claw-shell] Purpose: {purpose}")
    print(f"Log tag: {log_tag}")
    print("Commands to execute:")
    for cmd in commands:
        print("  " + cmd)
    # Real implementation: agent/tool call to claw-shell
    # e.g. tool_call("claw-shell", commands=commands, log_tag=log_tag, capture_output=True, timeout="24h")


def build_recon_all_command(args):
    """Build the recon-all command from arguments."""
    commands = []

    # 1. Set environment
    fs_home = "/usr/local/freesurfer"  # typical default; adjust if needed
    commands.append(f"export FREESURFER_HOME={fs_home}")
    commands.append("source $FREESURFER_HOME/SetUpFreeSurfer.sh")

    # 2. recon-all command
    recon_cmd = [
        "recon-all",
        "-subjid", args.subjid,
        "-i", args.input_mri,
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
    return commands


def main():
    parser = argparse.ArgumentParser(description="NeuroClaw FreeSurfer Processor")
    parser.add_argument("--input-mri", required=True, help="Path to T1w (or other) NIfTI file")
    parser.add_argument("--subjid", required=True, help="Subject ID (e.g. sub-001)")
    parser.add_argument("--subjects-dir", required=True, help="Output SUBJECTS_DIR path")
    parser.add_argument("--stages", default="all",
                        help="all / autorecon1 / autorecon2 / autorecon3 / stats / comma-separated stages")
    parser.add_argument("--extra-flags", default="",
                        help="Additional flags, e.g. '-T2 T2.nii.gz -FLAIR FLAIR.nii.gz -parallel -openmp 12'")
    parser.add_argument("--plan-only", action="store_true", help="Show plan without execution")
    args = parser.parse_args()

    installed, version_info = check_freesurfer_installed()
    if not installed:
        print("FreeSurfer not detected on system.")
        print("-> Invoking dependency-planner to install FreeSurfer and set up license.")
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

    commands = build_recon_all_command(args)
    log_tag = f"freesurfer_{args.subjid}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    print("\nExecution plan (to be run via claw-shell):")
    for i, cmd in enumerate(commands, 1):
        print(f"Step {i}: {cmd}")

    print(f"\nEstimated runtime: 4-24 hours (full -all), 1-4 hours (segmentation stages only)")
    print(f"Disk usage: ~2-5 GB per subject")
    print(f"Logs will be captured by claw-shell under tag: {log_tag}")

    if args.plan_only:
        print("\nPlan-only mode - no execution performed.")
        return

    confirm = input("\nExecute now? Type YES to proceed: ").strip().upper()
    if confirm != "YES":
        print("Aborted by user.")
        return

    print("\nDelegating pipeline execution to claw-shell skill...")
    delegate_to_claw_shell(
        commands=commands,
        purpose=f"FreeSurfer processing for subject {args.subjid} ({args.stages})",
        log_tag=log_tag,
    )

    print(f"-> Execution handed over to claw-shell.")
    print(f"-> Check logs using tag: {log_tag}")
    print(f"-> Final outputs will be in: {subjects_dir / args.subjid}")


if __name__ == "__main__":
    main()
