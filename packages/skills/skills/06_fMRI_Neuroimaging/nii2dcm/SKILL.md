---
name: nii2dcm
description: "Use this skill whenever the user wants to convert NIfTI files (.nii or .nii.gz) to DICOM format, create DICOM series from processed neuroimaging results, write segmentation/registration/analysis outputs back to DICOM for PACS compatibility or clinical viewer comparison, or transfer metadata from reference DICOM files. Triggers include: mentions of 'NIfTI to DICOM', 'nii to dcm', 'convert nii.gz to DICOM', 'dicomify segmentation', 'nii2dcm', 'bring results back to DICOM', 'create DICOM from NIfTI', 'nii to dicom series', or any request to take post-processed neuroimaging results (segmentation, registration, bias field correction, synthesis, etc.) and store/view them alongside original patient DICOM data. Also use when modality-specific metadata (especially MR, SVR) or preservation of patient/study information from a reference DICOM is needed. Do NOT use for the reverse conversion (DICOM to NIfTI), non-medical imaging file conversions, or any clinical diagnostic or treatment-related workflows."
license: BSD 3-Clause (original nii2dcm license). See https://github.com/tomaroberts/nii2dcm/blob/main/LICENSE for complete terms.
layer: base
skill_type: tool
dependencies:
  - claw-shell
---
# NIfTI to DICOM conversion

## Overview

A NIfTI file (.nii/.nii.gz) is a compact format widely used in neuroimaging research, typically stripped of patient metadata.  
DICOM is the clinical standard for medical images, including rich metadata and interoperability with PACS/hospital systems.

This skill wraps `nii2dcm` (v0.1.6, May 2025) to convert NIfTI volumes into single-frame DICOM series (multi-slice 2D), primarily for MRI-derived data.  
It supports modality-specific metadata (MR, SVR) and optional metadata transfer from a reference DICOM file.

**Research use only** — not certified for clinical diagnosis, treatment, or patient care.

## Quick Reference

| Task                          | Approach / Command Flag                  |
|-------------------------------|------------------------------------------|
| Basic conversion (generic)    | `nii2dcm input.nii.gz output_dir/`       |
| MRI multi-slice series        | `--dicom-type MR` or `-d MR`             |
| SVR (3D swept volume recon)   | `--dicom-type SVR` or `-d SVR`           |
| Copy patient/study metadata   | `--ref-dicom ref.dcm` or `-r ref.dcm`    |
| Custom series description     | Add via wrapper or post-process          |
| Verify output                 | Open in Horos, 3D Slicer, ITK-Snap       |

## Installation

### Via pip (recommended for NeuroClaw)
```bash
pip install nii2dcm>=0.1.6
# or latest
pip install git+https://github.com/tomaroberts/nii2dcm.git
```

### From source (for customization / debugging)
```bash
git clone https://github.com/tomaroberts/nii2dcm.git
cd nii2dcm
python -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
pip install .
nii2dcm -h   # Verify
```

Core dependencies (automatically installed):
- highdicom >= 0.9.0
- SimpleITK >= 2.2.0
- pydicom
- numpy

Docker alternative (if preferred in containerized env):
```bash
docker pull ghcr.io/tomaroberts/nii2dcm:latest
docker tag ghcr.io/tomaroberts/nii2dcm:latest nii2dcm
docker run nii2dcm -v   # check version
```

## Usage Examples

Core command pattern:
```bash
nii2dcm <input.nii[.gz]> <output_directory> [options]
```

### Create standard MRI DICOM series
```bash
nii2dcm processed_t1.nii.gz dicom_mr/ -d MR
```

### Create SVR (swept volume reconstruction) series
```bash
nii2dcm svr_recon.nii.gz dicom_svr/ -d SVR
```

### Generic conversion (no modality metadata)
```bash
nii2dcm seg_result.nii.gz dicom_generic/
```

### With reference DICOM (copy patient/study metadata)
```bash
nii2dcm hippocampus_seg.nii.gz dicom_seg/ -d MR -r original_T1_001.dcm
```

Transferred attributes (from DicomMRI class, see source):
- PatientName, PatientID, PatientBirthDate, PatientSex
- StudyInstanceUID, StudyDate, StudyTime, StudyDescription
- SeriesInstanceUID, SeriesNumber, SeriesDescription, etc.
(Full list: https://github.com/tomaroberts/nii2dcm/blob/main/nii2dcm/dcm.py#L236)

### NeuroClaw recommended wrapper (simpler for agent calling)
Use a thin wrapper script (to be provided in skill dir):
```bash
python nii2dcm_wrapper.py \
  --input seg_postop.nii.gz \
  --output-dir dicom_results/ \
  --modality MR \
  --ref-dcm ref_series/0001.dcm \
  --series-desc "U-Net v3 Segmentation"
```

## Important Notes & Limitations

- Supports only **3D single-volume → multi-slice 2D DICOM series** (common in structural MRI, segmentations)
- **No 4D support** (fMRI, DWI, perfusion, DTI) — split volumes first if needed
- Without `--dicom-type`, output is generic (lacks modality-specific tags)
- Without `--ref-dicom`, patient/study info is anonymized/generic
- Orientation, spacing, slice thickness read from NIfTI; verify alignment
- **Always visually validate** output in DICOM viewer (Horos, 3D Slicer, ITK-Snap, MITK)
- Project still in early stage — expect occasional bugs
- **Research purpose only** — not a clinical tool

## When to Call This Skill

- Finished NIfTI-space processing (bias correction, registration, segmentation, synthesis, etc.)
- Need to compare AI/model outputs visually with original clinical DICOM images
- Want to store results in same format/framework as source study
- Preparing outputs for PACS import, clinical collaboration, or archiving

## Complementary / Related Skills
- `dependency-planner`    → install dependencies
- `claw-shell`            → safe execution of conversion commands

## Reference

Original: https://github.com/tomaroberts/nii2dcm (v0.1.6, May 2025)  
Built on: highdicom (DICOM creation), SimpleITK (image I/O)  
Inspired by: dcm2niix (reverse tool), SVRTK project

Report issues or request extensions (e.g., CT support, 4D handling) in NeuroClaw repo.

Created At: 2026-03-18 20:09 HKT
Last Updated At: 2026-03-26 00:21 HKT  
Author: chengwang96