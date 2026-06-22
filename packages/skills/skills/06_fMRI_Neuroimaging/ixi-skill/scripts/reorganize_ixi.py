#!/usr/bin/env python3
"""Reorganize IXI native layout to BIDS structure.

Converts IXI directory layout (e.g., IXI002/, IXI002-T1.nii.gz, IXI002-T2.nii.gz)
to BIDS-compliant structure (sub-IXI002/anat/).
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

# Site mapping based on subject ID prefix
SITE_MAP = {
    "HH": {"name": "Hammersmith Hospital", "scanner": "Philips", "field_strength": "3T"},
    "Guy": {"name": "Guy's Hospital", "scanner": "Philips", "field_strength": "1.5T"},
    "IOP": {"name": "Institute of Psychiatry", "scanner": "GE", "field_strength": "1.5T"},
}


def detect_site(subject_id: str) -> str:
    """Detect site from subject ID."""
    for prefix in SITE_MAP:
        if subject_id.startswith(prefix):
            return prefix
    return "Unknown"


def normalize_subject_id(ixi_id: str) -> str:
    """Convert IXI subject ID to BIDS format."""
    return f"sub-{ixi_id.strip()}"


def find_subjects(input_dir: Path) -> list:
    """Find IXI subject files."""
    # IXI files are typically named IXI002-T1.nii.gz, IXI002-T2.nii.gz, etc.
    subjects = set()
    for f in input_dir.glob("IXI*-*.nii.gz"):
        # Extract subject ID (e.g., IXI002 from IXI002-T1.nii.gz)
        parts = f.stem.split("-")
        if len(parts) >= 2:
            subjects.add(parts[0])
    return sorted(list(subjects))


def reorganize_subject(input_dir: Path, subject_id: str, output_dir: Path, dry_run: bool = False) -> dict:
    """Reorganize a single IXI subject to BIDS."""
    bids_id = normalize_subject_id(subject_id)
    sub_dir = output_dir / bids_id
    report = {"subject": subject_id, "files_created": 0, "warnings": []}

    if not dry_run:
        (sub_dir / "anat").mkdir(parents=True, exist_ok=True)

    # Map IXI modality suffixes to BIDS
    modality_map = {
        "T1": "T1w",
        "T2": "T2w",
        "MRA": "MRA",
        "PD": "PD",
        "DTI": "dwi",
    }

    for ixi_suffix, bids_suffix in modality_map.items():
        src_candidates = list(input_dir.glob(f"{subject_id}-{ixi_suffix}.nii.gz"))
        if not src_candidates:
            src_candidates = list(input_dir.glob(f"{subject_id}-{ixi_suffix.lower()}.nii.gz"))

        for src in src_candidates:
            if bids_suffix == "dwi":
                dst = sub_dir / "dwi" / f"{bids_id}_{bids_suffix}.nii.gz"
                if not dry_run:
                    (sub_dir / "dwi").mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, dst)
            else:
                dst = sub_dir / "anat" / f"{bids_id}_{bids_suffix}.nii.gz"
                if not dry_run:
                    shutil.copy2(src, dst)
            report["files_created"] += 1

    # Check for missing modalities
    if report["files_created"] == 0:
        report["warnings"].append("No modality files found")

    return report


def create_dataset_description(output_dir: Path, n_subjects: int, sites: dict):
    """Create BIDS dataset_description.json."""
    desc = {
        "Name": "IXI (Information eXtraction from Images)",
        "BIDSVersion": "1.8.0",
        "DatasetType": "raw",
        "License": "CC0",
        "Authors": ["IXI Consortium"],
        "HowToAcknowledge": "Please cite the IXI dataset.",
        "ReferencesAndLinks": ["https://brain-development.org/ixi-dataset/"],
        "Subjects": n_subjects,
        "Sites": sites,
    }
    with open(output_dir / "dataset_description.json", "w", encoding="utf-8") as f:
        json.dump(desc, f, indent=2)


def create_participants_tsv(output_dir: Path, subjects: list, input_dir: Path):
    """Create participants.tsv with site information."""
    with open(output_dir / "participants.tsv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["participant_id", "site", "scanner", "field_strength"])
        writer.writeheader()
        for subj in subjects:
            site = detect_site(subj)
            site_info = SITE_MAP.get(site, {"name": "Unknown", "scanner": "Unknown", "field_strength": "Unknown"})
            writer.writerow({
                "participant_id": normalize_subject_id(subj),
                "site": site_info["name"],
                "scanner": site_info["scanner"],
                "field_strength": site_info["field_strength"],
            })


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Reorganize IXI native layout to BIDS."
    )
    parser.add_argument("--input", required=True, help="Path to IXI raw directory")
    parser.add_argument("--output", required=True, help="Output BIDS directory")
    parser.add_argument("--dry-run", action="store_true", help="Preview without copying")
    args = parser.parse_args()

    input_dir = Path(args.input).resolve()
    output_dir = Path(args.output).resolve()

    if not input_dir.exists():
        print(f"Input directory not found: {input_dir}", file=sys.stderr)
        return 1

    # Find subjects
    subjects = find_subjects(input_dir)
    print(f"Found {len(subjects)} subjects in {input_dir}")

    if not subjects:
        print("No subjects found. Check input directory structure.", file=sys.stderr)
        return 1

    if not args.dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)

    # Process each subject
    total_files = 0
    all_warnings = []
    site_counts = {}

    for i, subj in enumerate(subjects):
        report = reorganize_subject(input_dir, subj, output_dir, dry_run=args.dry_run)
        total_files += report["files_created"]
        if report["warnings"]:
            all_warnings.extend([f"{report['subject']}: {w}" for w in report["warnings"]])

        # Track site counts
        site = detect_site(subj)
        site_counts[site] = site_counts.get(site, 0) + 1

        if (i + 1) % 100 == 0 or (i + 1) == len(subjects):
            print(f"  Processed {i + 1}/{len(subjects)} subjects ({total_files} files)")

    # Create metadata
    if not args.dry_run:
        create_dataset_description(output_dir, len(subjects), site_counts)
        import csv
        create_participants_tsv(output_dir, subjects, input_dir)

    # Summary
    print(f"\nBIDS Staging Summary:")
    print(f"  Subjects: {len(subjects)}")
    print(f"  Files created: {total_files}")
    print(f"  Sites: {site_counts}")
    print(f"  Output: {output_dir}")
    if args.dry_run:
        print("  [DRY RUN - no files were copied]")

    if all_warnings:
        print(f"\n  Warnings ({len(all_warnings)}):")
        for w in all_warnings[:20]:
            print(f"    - {w}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
