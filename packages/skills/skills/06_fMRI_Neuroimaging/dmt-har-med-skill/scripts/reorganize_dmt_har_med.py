#!/usr/bin/env python3
"""Validate and optionally reorganize DMT-HAR-MED OpenNeuro BIDS data."""
import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Dict, List, Optional

BIDS_MODALITIES = {"T1w": "anat", "T2w": "anat", "FLAIR": "anat",
                   "task-rest_bold": "func", "task-*_bold": "func",
                   "dwi": "dwi", "bold": "func"}


def validate_bids(bids_root: Path) -> Dict[str, List[str]]:
    """Validate BIDS structure and return report."""
    issues: Dict[str, List[str]] = {"errors": [], "warnings": []}
    if not (bids_root / "dataset_description.json").exists():
        issues["errors"].append("Missing dataset_description.json")
    participants_tsv = bids_root / "participants.tsv"
    if not participants_tsv.exists():
        issues["warnings"].append("Missing participants.tsv")
    subject_dirs = sorted(d for d in bids_root.iterdir() if d.is_dir() and d.name.startswith("sub-"))
    if not subject_dirs:
        issues["errors"].append("No subject directories found")
    for sub_dir in subject_dirs:
        session_dirs = [d for d in sub_dir.iterdir() if d.is_dir() and d.name.startswith("ses-")]
        if not session_dirs:
            session_dirs = [sub_dir]
        for ses_dir in session_dirs:
            func_dir = ses_dir / "func"
            anat_dir = ses_dir / "anat"
            if not func_dir.exists() and not anat_dir.exists():
                issues["warnings"].append(f"{sub_dir.name}/{ses_dir.name}: no func/ or anat/ directory")
    return issues


def collect_nifti_manifest(bids_root: Path) -> List[Dict[str, str]]:
    """Collect all NIfTI files in BIDS directory."""
    manifest = []
    for nifti in sorted(bids_root.rglob("*.nii.gz")):
        rel = nifti.relative_to(bids_root)
        parts = rel.parts
        subject = next((p for p in parts if p.startswith("sub-")), "unknown")
        session = next((p for p in parts if p.startswith("ses-")), "")
        modality_dir = next((p for p in parts if p in ("anat", "func", "dwi", "fmap")), "unknown")
        manifest.append({
            "subject": subject,
            "session": session,
            "modality": modality_dir,
            "filename": nifti.name,
            "path": str(rel),
        })
    return manifest


def copy_to_output(bids_root: Path, output_dir: Path, manifest: List[Dict[str, str]]) -> int:
    """Copy BIDS files to output directory."""
    output_dir.mkdir(parents=True, exist_ok=True)
    copied = 0
    for entry in manifest:
        src = bids_root / entry["path"]
        dst = output_dir / entry["path"]
        dst.parent.mkdir(parents=True, exist_ok=True)
        if not dst.exists():
            shutil.copy2(str(src), str(dst))
            copied += 1
    return copied


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate/reorganize DMT-HAR-MED BIDS data.")
    parser.add_argument("--input", required=True, help="Path to DMT-HAR-MED BIDS directory")
    parser.add_argument("--output", help="Output path for reorganized BIDS directory")
    parser.add_argument("--validate-only", action="store_true", help="Only validate, don't copy")
    parser.add_argument("--manifest-output", help="Output path for NIfTI manifest TSV")
    args = parser.parse_args()

    input_dir = Path(args.input).resolve()
    if not input_dir.exists():
        print(f"Input directory not found: {input_dir}", file=sys.stderr)
        return 1

    print(f"Validating BIDS structure at {input_dir}...")
    issues = validate_bids(input_dir)

    if issues["errors"]:
        print(f"\n[ERRORS] ({len(issues['errors'])}):")
        for e in issues["errors"]:
            print(f"  - {e}")
    if issues["warnings"]:
        print(f"\n[WARNINGS] ({len(issues['warnings'])}):")
        for w in issues["warnings"]:
            print(f"  - {w}")
    if not issues["errors"] and not issues["warnings"]:
        print("  BIDS structure looks valid.")

    manifest = collect_nifti_manifest(input_dir)
    print(f"\nFound {len(manifest)} NIfTI files")

    subjects = set(e["subject"] for e in manifest)
    modalities = set(e["modality"] for e in manifest)
    print(f"  Subjects: {len(subjects)}")
    print(f"  Modalities: {', '.join(sorted(modalities))}")

    if args.manifest_output:
        import csv
        manifest_path = Path(args.manifest_output).resolve()
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        with open(manifest_path, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=manifest[0].keys(), delimiter="\t")
            writer.writeheader()
            writer.writerows(manifest)
        print(f"  Manifest: {manifest_path}")

    if not args.validate_only and args.output:
        output_dir = Path(args.output).resolve()
        copied = copy_to_output(input_dir, output_dir, manifest)
        print(f"\nCopied {copied} files to {output_dir}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
