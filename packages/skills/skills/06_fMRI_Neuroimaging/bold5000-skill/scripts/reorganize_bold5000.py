#!/usr/bin/env python3
"""Verify and reorganize BOLD5000 data into BIDS-compliant layout.

BOLD5000 from OpenNeuro is already in BIDS format; this script validates
and optionally copies/reorganizes the structure.
"""
import argparse
import json
import shutil
import sys
from pathlib import Path


def validate_bids_structure(root: Path) -> list:
    """Validate BIDS structure and return list of issues."""
    issues = []
    desc = root / "dataset_description.json"
    if not desc.exists():
        issues.append("Missing dataset_description.json")
    else:
        try:
            data = json.loads(desc.read_text(encoding="utf-8"))
            if "BIDSVersion" not in data:
                issues.append("dataset_description.json missing BIDSVersion")
        except Exception:
            issues.append("dataset_description.json is not valid JSON")

    participants = root / "participants.tsv"
    if not participants.exists():
        issues.append("Missing participants.tsv")

    subject_dirs = sorted(root.glob("sub-*"))
    if not subject_dirs:
        issues.append("No subject directories found (sub-*)")
    else:
        for sub_dir in subject_dirs:
            if not sub_dir.is_dir():
                continue
            anat = sub_dir / "anat"
            func = sub_dir / "func"
            if not anat.exists() and not func.exists():
                # Check for session directories
                ses_dirs = list(sub_dir.glob("ses-*"))
                if not ses_dirs:
                    issues.append(f"{sub_dir.name}: no anat/, func/, or ses-* directories")
                else:
                    for ses in ses_dirs:
                        if not (ses / "anat").exists() and not (ses / "func").exists():
                            issues.append(f"{sub_dir.name}/{ses.name}: no anat/ or func/ directories")

    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify and reorganize BOLD5000 BIDS data.")
    parser.add_argument("--input", required=True, help="Path to BOLD5000 data directory")
    parser.add_argument("--output", help="Path to output BIDS directory (if copy needed)")
    parser.add_argument("--validate-only", action="store_true", help="Only validate, do not copy")
    parser.add_argument("--dry-run", action="store_true", help="Preview without copying")
    args = parser.parse_args()

    input_dir = Path(args.input).resolve()
    if not input_dir.exists():
        print(f"Input directory does not exist: {input_dir}", file=sys.stderr)
        return 1

    print(f"Validating BIDS structure at {input_dir}...")
    issues = validate_bids_structure(input_dir)

    if issues:
        print(f"\nFound {len(issues)} issue(s):")
        for issue in issues:
            print(f"  - {issue}")
    else:
        print("BIDS structure is valid.")

    if args.validate_only:
        return 1 if issues else 0

    output_dir = Path(args.output).resolve() if args.output else None
    if output_dir:
        print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Copying to {output_dir}...")
        if not args.dry_run:
            output_dir.mkdir(parents=True, exist_ok=True)
            # Copy BIDS structure
            for item in input_dir.iterdir():
                dst = output_dir / item.name
                if item.is_dir():
                    if not dst.exists():
                        shutil.copytree(str(item), str(dst))
                else:
                    if not dst.exists():
                        shutil.copy2(str(item), str(dst))
            print("Copy complete.")
        else:
            print("[DRY RUN] Would copy all BIDS files to output directory.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
