#!/usr/bin/env python3
"""Reorganize HCP Young Adult (HCP1200) native layout to BIDS structure.

Converts HCP-YA directory layout (e.g., 100307/T1w/, 100307/MNINonLinear/)
to BIDS-compliant structure (sub-100307/anat/, sub-100307/func/).
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

# HCP-YA task mappings: task folder name -> BIDS task label + full name
TASK_MAP = {
    "tfMRI_MOTOR": {"label": "motor", "name": "Motor"},
    "tfMRI_EMOTION": {"label": "emotion", "name": "Emotion"},
    "tfMRI_GAMBLING": {"label": "gambling", "name": "Gambling"},
    "tfMRI_LANGUAGE": {"label": "language", "name": "Language"},
    "tfMRI_RELATIONAL": {"label": "relational", "name": "Relational"},
    "tfMRI_SOCIAL": {"label": "social", "name": "Social"},
    "tfMRI_WM": {"label": "wm", "name": "WorkingMemory"},
    "rfMRI_REST": {"label": "rest", "name": "RestingState"},
}


def normalize_subject_id(hcp_id: str) -> str:
    """Convert HCP subject ID to BIDS format."""
    return f"sub-{hcp_id.strip()}"


def find_subjects(input_dir: Path, participant_list: list = None) -> list:
    """Find HCP subject directories."""
    subjects = []
    for d in sorted(input_dir.iterdir()):
        if d.is_dir() and d.name.isdigit():
            if participant_list is None or d.name in participant_list:
                subjects.append(d)
    return subjects


def reorganize_subject(subject_dir: Path, output_dir: Path, dry_run: bool = False) -> dict:
    """Reorganize a single HCP-YA subject to BIDS."""
    hcp_id = subject_dir.name
    bids_id = normalize_subject_id(hcp_id)
    sub_dir = output_dir / bids_id

    report = {"subject": hcp_id, "files_created": 0, "warnings": []}

    if not dry_run:
        (sub_dir / "anat").mkdir(parents=True, exist_ok=True)
        (sub_dir / "func").mkdir(parents=True, exist_ok=True)
        (sub_dir / "dwi").mkdir(parents=True, exist_ok=True)

    # Structural MRI: T1w and T2w
    mninonlinear = subject_dir / "MNINonLinear"
    t1w_src = mninonlinear / "T1w.nii.gz"
    t2w_src = mninonlinear / "T2w.nii.gz"

    if t1w_src.exists():
        dst = sub_dir / "anat" / f"{bids_id}_T1w.nii.gz"
        if not dry_run:
            shutil.copy2(t1w_src, dst)
        report["files_created"] += 1
    else:
        report["warnings"].append("T1w not found")

    if t2w_src.exists():
        dst = sub_dir / "anat" / f"{bids_id}_T2w.nii.gz"
        if not dry_run:
            shutil.copy2(t2w_src, dst)
        report["files_created"] += 1
    else:
        report["warnings"].append("T2w not found")

    # Functional MRI
    for task_dir_name, task_info in TASK_MAP.items():
        task_dir = subject_dir / task_dir_name
        if not task_dir.exists():
            task_dir = mninonlinear / "Results" / task_dir_name

        if task_dir.exists():
            # Look for the main bold file
            bold_candidates = list(task_dir.glob("*_bold.nii.gz"))
            if not bold_candidates:
                bold_candidates = list(task_dir.glob("*.nii.gz"))

            for bold_src in bold_candidates:
                run_label = "01"
                bids_task = task_info["label"]
                dst_name = f"{bids_id}_task-{bids_task}_run-{run_label}_bold.nii.gz"
                dst = sub_dir / "func" / dst_name
                if not dry_run:
                    shutil.copy2(bold_src, dst)
                report["files_created"] += 1

    # Diffusion MRI
    dmri_dir = subject_dir / "T1w" / "Diffusion"
    if dmri_dir.exists():
        for suffix in ["data.nii.gz", "bval", "bvec"]:
            src = dmri_dir / suffix
            if src.exists():
                bids_suffix = suffix.replace("data.nii.gz", "dwi.nii.gz")
                dst = sub_dir / "dwi" / f"{bids_id}_{bids_suffix}"
                if not dry_run:
                    shutil.copy2(src, dst)
                report["files_created"] += 1

    return report


def create_dataset_description(output_dir: Path, n_subjects: int):
    """Create BIDS dataset_description.json."""
    desc = {
        "Name": "HCP Young Adult (HCP1200)",
        "BIDSVersion": "1.8.0",
        "DatasetType": "raw",
        "License": "HCP Data Use Terms",
        "Authors": ["Human Connectome Project"],
        "Acknowledgements": "WU-Minn HCP Consortium",
        "HowToAcknowledge": "Please cite the Human Connectome Project.",
        "ReferencesAndLinks": [
            "https://www.humanconnectome.org/study/hcp-young-adult",
            "Glasser et al. (2013) NeuroImage"
        ],
        "Subjects": n_subjects
    }
    with open(output_dir / "dataset_description.json", "w", encoding="utf-8") as f:
        json.dump(desc, f, indent=2)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Reorganize HCP-YA native layout to BIDS."
    )
    parser.add_argument("--input", required=True, help="Path to HCP-YA raw directory")
    parser.add_argument("--output", required=True, help="Output BIDS directory")
    parser.add_argument("--participants", help="Text file with subject IDs (one per line)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without copying")
    args = parser.parse_args()

    input_dir = Path(args.input).resolve()
    output_dir = Path(args.output).resolve()

    if not input_dir.exists():
        print(f"Input directory not found: {input_dir}", file=sys.stderr)
        return 1

    # Load participant list
    participant_list = None
    if args.participants:
        p_file = Path(args.participants).resolve()
        if not p_file.exists():
            print(f"Participant list not found: {p_file}", file=sys.stderr)
            return 1
        participant_list = [line.strip() for line in p_file.read_text().splitlines() if line.strip()]
        print(f"Subject list: {len(participant_list)} subjects")

    # Find subjects
    subjects = find_subjects(input_dir, participant_list)
    print(f"Found {len(subjects)} subject directories in {input_dir}")

    if not subjects:
        print("No subjects found. Check input directory structure.", file=sys.stderr)
        return 1

    if not args.dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)

    # Process each subject
    total_files = 0
    all_warnings = []
    for i, sub_dir in enumerate(subjects):
        report = reorganize_subject(sub_dir, output_dir, dry_run=args.dry_run)
        total_files += report["files_created"]
        if report["warnings"]:
            all_warnings.extend([f"{report['subject']}: {w}" for w in report["warnings"]])
        if (i + 1) % 100 == 0 or (i + 1) == len(subjects):
            print(f"  Processed {i + 1}/{len(subjects)} subjects ({total_files} files)")

    # Create dataset metadata
    if not args.dry_run:
        create_dataset_description(output_dir, len(subjects))

    # Summary
    print(f"\nBIDS Staging Summary:")
    print(f"  Subjects: {len(subjects)}")
    print(f"  Files created: {total_files}")
    print(f"  Output: {output_dir}")
    if args.dry_run:
        print("  [DRY RUN - no files were copied]")

    if all_warnings:
        print(f"\n  Warnings ({len(all_warnings)}):")
        for w in all_warnings[:20]:
            print(f"    - {w}")
        if len(all_warnings) > 20:
            print(f"    ... and {len(all_warnings) - 20} more")

    return 0


if __name__ == "__main__":
    sys.exit(main())
