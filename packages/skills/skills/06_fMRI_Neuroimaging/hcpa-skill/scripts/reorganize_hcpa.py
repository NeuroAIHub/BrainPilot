#!/usr/bin/env python3
"""Reorganize HCP Aging native layout to BIDS structure.

Converts HCP-A directory layout to BIDS-compliant structure.
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

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
    return f"sub-{hcp_id.strip()}"


def find_subjects(input_dir: Path, participant_list: list = None) -> list:
    subjects = []
    for d in sorted(input_dir.iterdir()):
        if d.is_dir() and d.name.isdigit():
            if participant_list is None or d.name in participant_list:
                subjects.append(d)
    return subjects


def reorganize_subject(subject_dir: Path, output_dir: Path, dry_run: bool = False) -> dict:
    hcp_id = subject_dir.name
    bids_id = normalize_subject_id(hcp_id)
    sub_dir = output_dir / bids_id
    report = {"subject": hcp_id, "files_created": 0, "warnings": []}

    if not dry_run:
        (sub_dir / "anat").mkdir(parents=True, exist_ok=True)
        (sub_dir / "func").mkdir(parents=True, exist_ok=True)
        (sub_dir / "dwi").mkdir(parents=True, exist_ok=True)

    mninonlinear = subject_dir / "MNINonLinear"

    # Structural
    for suffix in ["T1w.nii.gz", "T2w.nii.gz"]:
        src = mninonlinear / suffix
        if src.exists():
            modality = suffix.split(".")[0].lower()
            dst = sub_dir / "anat" / f"{bids_id}_{modality}.nii.gz"
            if not dry_run:
                shutil.copy2(src, dst)
            report["files_created"] += 1
        else:
            report["warnings"].append(f"{suffix} not found")

    # Functional
    for task_dir_name, task_info in TASK_MAP.items():
        task_dir = subject_dir / task_dir_name
        if not task_dir.exists():
            task_dir = mninonlinear / "Results" / task_dir_name
        if task_dir.exists():
            bold_candidates = list(task_dir.glob("*_bold.nii.gz"))
            if not bold_candidates:
                bold_candidates = list(task_dir.glob("*.nii.gz"))
            for bold_src in bold_candidates:
                dst_name = f"{bids_id}_task-{task_info['label']}_run-01_bold.nii.gz"
                dst = sub_dir / "func" / dst_name
                if not dry_run:
                    shutil.copy2(bold_src, dst)
                report["files_created"] += 1

    # Diffusion
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
    desc = {
        "Name": "HCP Aging",
        "BIDSVersion": "1.8.0",
        "DatasetType": "raw",
        "License": "HCP Data Use Terms",
        "Authors": ["Human Connectome Project"],
        "HowToAcknowledge": "Please cite the HCP Aging project.",
        "ReferencesAndLinks": ["https://www.humanconnectome.org/study/hcp-lifespan-aging"],
        "Subjects": n_subjects
    }
    with open(output_dir / "dataset_description.json", "w", encoding="utf-8") as f:
        json.dump(desc, f, indent=2)


def main() -> int:
    parser = argparse.ArgumentParser(description="Reorganize HCP-A native layout to BIDS.")
    parser.add_argument("--input", required=True, help="Path to HCP-A raw directory")
    parser.add_argument("--output", required=True, help="Output BIDS directory")
    parser.add_argument("--participants", help="Text file with subject IDs")
    parser.add_argument("--dry-run", action="store_true", help="Preview without copying")
    args = parser.parse_args()

    input_dir = Path(args.input).resolve()
    output_dir = Path(args.output).resolve()

    if not input_dir.exists():
        print(f"Input directory not found: {input_dir}", file=sys.stderr)
        return 1

    participant_list = None
    if args.participants:
        p_file = Path(args.participants).resolve()
        if p_file.exists():
            participant_list = [l.strip() for l in p_file.read_text().splitlines() if l.strip()]

    subjects = find_subjects(input_dir, participant_list)
    print(f"Found {len(subjects)} subjects")

    if not args.dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)

    total_files = 0
    for i, sub_dir in enumerate(subjects):
        report = reorganize_subject(sub_dir, output_dir, dry_run=args.dry_run)
        total_files += report["files_created"]
        if (i + 1) % 100 == 0 or (i + 1) == len(subjects):
            print(f"  Processed {i + 1}/{len(subjects)} subjects")

    if not args.dry_run:
        create_dataset_description(output_dir, len(subjects))

    print(f"\nBIDS Staging Summary:")
    print(f"  Subjects: {len(subjects)}")
    print(f"  Files created: {total_files}")
    print(f"  Output: {output_dir}")
    if args.dry_run:
        print("  [DRY RUN]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
