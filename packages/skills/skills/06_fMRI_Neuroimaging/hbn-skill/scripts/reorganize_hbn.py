#!/usr/bin/env python3
"""Reorganize HBN raw data into BIDS-compliant directory structure."""
import argparse
import csv
import json
import re
import shutil
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

SIDECAR_EXTENSIONS = [".json", ".bval", ".bvec", ".tsv"]
MODALITY_MAP = {
    "T1w": ("T1w", "anat"),
    "T2w": ("T2w", "anat"),
    "dwi": ("dwi", "dwi"),
    "bold": ("task-rest_bold", "func"),
    "task-rest_bold": ("task-rest_bold", "func"),
    "task-rest_run-1_bold": ("task-rest_run-1_bold", "func"),
    "task-rest_run-2_bold": ("task-rest_run-2_bold", "func"),
}


def normalize_subject_id(raw_id: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9]", "", str(raw_id).strip())
    return f"sub-{clean}"


def detect_task_name(filename: str) -> Optional[str]:
    match = re.search(r"task-([a-zA-Z0-9]+)", filename)
    return match.group(1) if match else None


def detect_modality(filename: str) -> Optional[Tuple[str, str]]:
    name_lower = filename.lower()
    for key, (bids_suffix, bids_folder) in MODALITY_MAP.items():
        if key.lower() in name_lower:
            return (bids_suffix, bids_folder)
    if "eeg" in name_lower:
        return ("eeg", "eeg")
    return None


def find_nifti_files(directory: Path) -> List[Path]:
    return [f for f in directory.rglob("*") if f.is_file() and (f.name.endswith(".nii") or f.name.endswith(".nii.gz"))]


def copy_with_sidecars(src_nifti: Path, dst_dir: Path, dst_stem: str) -> None:
    dst_dir.mkdir(parents=True, exist_ok=True)
    ext = ".nii.gz" if src_nifti.name.endswith(".nii.gz") else ".nii"
    dst_nifti = dst_dir / f"{dst_stem}{ext}"
    if not dst_nifti.exists():
        shutil.copy2(str(src_nifti), str(dst_nifti))
    src_stem = src_nifti.name[:-7] if src_nifti.name.endswith(".nii.gz") else src_nifti.name[:-4]
    for sidecar_ext in SIDECAR_EXTENSIONS:
        src_sidecar = src_nifti.parent / f"{src_stem}{sidecar_ext}"
        if src_sidecar.exists():
            dst_sidecar = dst_dir / f"{dst_stem}{sidecar_ext}"
            if not dst_sidecar.exists():
                shutil.copy2(str(src_sidecar), str(dst_sidecar))


def write_dataset_description(bids_root: Path) -> None:
    desc = {
        "Name": "Healthy Brain Network (HBN)",
        "BIDSVersion": "1.8.0",
        "DatasetType": "raw",
        "GeneratedBy": [{"Name": "NeuroClaw hbn-skill", "Version": "1.0.0"}],
    }
    (bids_root / "dataset_description.json").write_text(json.dumps(desc, indent=2), encoding="utf-8")


def write_participants_tsv(bids_root: Path, participants: List[Dict[str, str]]) -> None:
    tsv_path = bids_root / "participants.tsv"
    with open(tsv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, delimiter="\t")
        writer.writerow(["participant_id"])
        seen = set()
        for p in participants:
            pid = p["participant_id"]
            if pid not in seen:
                writer.writerow([pid])
                seen.add(pid)


def main() -> int:
    parser = argparse.ArgumentParser(description="Reorganize HBN raw data into BIDS structure.")
    parser.add_argument("--input", required=True, help="Path to HBN raw data directory")
    parser.add_argument("--output", required=True, help="Path to output BIDS directory")
    parser.add_argument("--dry-run", action="store_true", help="Preview without copying")
    args = parser.parse_args()

    input_dir = Path(args.input).resolve()
    output_dir = Path(args.output).resolve()
    if not input_dir.exists():
        print(f"Input directory does not exist: {input_dir}", file=sys.stderr)
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)
    participants: List[Dict[str, str]] = []
    converted = skipped = failed = 0

    for subject_dir in sorted(p for p in input_dir.iterdir() if p.is_dir() and not p.name.startswith(".")):
        sub_label = normalize_subject_id(subject_dir.name)
        participants.append({"participant_id": sub_label})

        # HBN may have session directories (ses-1, ses-2, etc.)
        session_dirs = [d for d in subject_dir.iterdir() if d.is_dir() and d.name.startswith("ses-")]
        if not session_dirs:
            session_dirs = [subject_dir]

        for ses_dir in session_dirs:
            ses_label = ses_dir.name if ses_dir.name.startswith("ses-") else "ses-1"
            for nifti in find_nifti_files(ses_dir):
                result = detect_modality(nifti.name)
                if result is None:
                    result = detect_modality(nifti.parent.name)
                if result is None:
                    failed += 1
                    continue

                bids_suffix, bids_folder = result

                # Handle task-fMRI: extract task name from filename
                task_name = detect_task_name(nifti.name)
                if task_name and bids_folder == "func":
                    bids_suffix = f"task-{task_name}_bold"

                bids_sub_dir = output_dir / sub_label / ses_label / bids_folder
                dst_stem = f"{sub_label}_{ses_label}_{bids_suffix}"
                if (bids_sub_dir / f"{dst_stem}.nii.gz").exists():
                    skipped += 1
                    continue
                if args.dry_run:
                    print(f"[DRY] {sub_label}/{ses_label}/{bids_folder}/{dst_stem}")
                else:
                    copy_with_sidecars(nifti, bids_sub_dir, dst_stem)
                    print(f"[OK] {sub_label} / {ses_label} / {bids_folder} / {dst_stem}")
                converted += 1

    if not args.dry_run and converted > 0:
        write_dataset_description(output_dir)
        write_participants_tsv(output_dir, participants)

    print(f"\nDone. Converted={converted}, Skipped={skipped}, Failed={failed}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
