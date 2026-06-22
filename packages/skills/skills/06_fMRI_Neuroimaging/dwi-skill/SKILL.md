---
name: dwi-skill
description: "Use this skill whenever the user wants to preprocess diffusion MRI / DWI data, compute diffusion metrics (FA/MD/AD/RD, etc.), extract ROI-wise diffusion features, or run tractography/connectome-related workflows. Triggers include: 'DWI', 'DTI', 'diffusion MRI', 'FA', 'MD', 'AD', 'RD', 'eddy', 'topup', 'QSIPrep', 'tractography', 'connectome', 'TBSS', 'white matter microstructure'. This is the NeuroClaw modality-layer interface: it plans WHAT to do and delegates execution to tool skills."
license: MIT License (NeuroClaw custom skill – freely modifiable within the project)
layer: subagent
skill_type: modality
dependencies:
  - qsiprep-tool
  - dipy-tool
  - fsl-tool
  - claw-shell
complementary_skills:
  - fmri-skill
  - smri-skill
---
# DWI Skill (Modality Layer)

## Overview
`dwi-skill` is the NeuroClaw **modality-layer** interface skill responsible for diffusion MRI (DWI/DTI) preprocessing and feature extraction.

It strictly follows NeuroClaw hierarchical design principles:
- This skill defines **WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code** and **no concrete shell commands**.
- All concrete execution is delegated to tool skills and routed through `claw-shell`.- Reference implementations (MATLAB, Python) are provided for user understanding but should be wrapped via tool skills in production workflows.
**Core workflow (never bypassed):**
1. Identify input type (DICOM / NIfTI / BIDS), single-shell vs multi-shell, reverse phase-encoded b0/fieldmaps availability.
2. Generate a **numbered execution plan** (steps, tools, outputs, runtime, risks).
3. Present the plan and wait for explicit user confirmation (“YES” / “execute” / “proceed”).
4. On confirmation, delegate each step to the relevant tool skill via `claw-shell`.
5. Save outputs into `dwi_output/`.

When the task includes tractography or connectome construction, default to the strongest task-faithful diffusion route available rather than a generic tensor-only fallback:
- Prefer `QSIPrep -> MRtrix3` style downstream processing with multi-tissue FOD, ACT, SIFT2, and `tck2connectome` when data quality and inputs support it.
- Use tensor-only DIPY/DTI examples as a fallback, not as the default full-pipeline answer, unless the data are truly limited or the user explicitly requests a lightweight DTI-only workflow.
- If atlas/parcellation, label tables, registration/alignment targets, or tractography-critical settings are missing, state `Missing required input` explicitly and ask the user to choose the key analysis options before execution instead of silently assuming weak defaults.

## Benchmark-Facing Default Mainline

For benchmark-style DWI prompts, choose one explicit diffusion mainline and keep unrelated modality or alternative preprocessing branches out of the primary answer.

- If the prompt asks for a full DWI pipeline ending in tractography or a connectome:
    - Default to `BIDS -> QSIPrep -> MRtrix3-style downstream tractography/connectome`.
    - Keep the mainline focused on preprocessing, tensor/derived maps if requested, atlas alignment, tractography, and connectome export.
    - Do not introduce fMRI, EEG, HCP multimodal, or generic nilearn connectivity branches.
- If the prompt asks only for preprocessing or tensor metrics:
    - Stop at `QSIPrep` or `FSL/DIPY` tensor outputs and do not expand into tractography.
- If the prompt starts from existing tensor metric maps or asks only for ROI-wise metric summaries:
    - Do not restart from raw DWI loading, preprocessing, tensor fitting, or tractography.
    - Stay on the downstream ROI-statistics path the task actually asks for.
- If the prompt already provides a tractogram or otherwise starts downstream of preprocessing:
    - Do not restart from raw DWI preprocessing or full tractography reconstruction.
    - Stay on the downstream mainline the task actually asks for, such as `tck2connectome` from an existing filtered tractogram plus atlas/parcellation.
- If the connectome-critical inputs are missing, such as atlas/parcellation, LUT, registration target, or shell/model constraints:
    - State `Missing required input` explicitly.
    - Do not replace the requested full pipeline with a weaker tensor-only pipeline unless the prompt explicitly allows that fallback.

Prefer one narrow answer pattern plus a short blocked-items note over a broad menu of QSIPrep/FSL/HCP/MRtrix alternatives.

### Existing-Metric ROI Statistics Path

When the task already provides one or more metric maps such as `FA`, `MD`, `AD`, or `RD` together with an atlas/label image, the default mainline should be:

1. verify atlas and metric-map space compatibility,
2. select only the provided metric subset,
3. compute per-label statistics on those metric maps,
4. write one CSV per selected metric,
5. report any geometry or missing-input blockers.

In this situation, do not broaden the answer into DWI preprocessing, bval/bvec handling, new tensor fitting, or tractography unless the prompt explicitly asks to regenerate those prerequisites.

### Existing-Tractography Connectome Path

When the task already provides a tractogram and asks for a structural connectome, the default mainline should be:

1. verify the tractogram format and atlas/parcellation space,
2. verify node labels/LUT or declare them missing,
3. run `tck2connectome` on the provided tractogram,
4. export `connectome.csv` and optional assignments/weighted outputs,
5. report any alignment or labeling blockers.

In this situation, do not broaden the answer into response estimation, CSD fitting, new whole-brain tractography generation, or unrelated preprocessing unless the prompt explicitly asks to regenerate those prerequisites.

**Research use only.**

---

## Quick Reference (Common DWI Tasks → Delegation Map)

| Task | What needs to be done (high level) | Delegate to which skill | Expected outputs |
|---|---|---|---|
| DICOM → NIfTI | Convert DICOM series to NIfTI + bval/bvec (+json) | `dcm2nii` | `*.nii.gz`, `*.bval`, `*.bvec`, `*.json` |
| Organize to BIDS | Build BIDS-compliant diffusion dataset | `bids-organizer` | `bids/sub-*/dwi/...` |
| **Best-practice DWI preprocessing (recommended)** | Run containerized BIDS-App with robust workflows + QC | **`qsiprep-tool`** | `derivatives/qsiprep/.../*preproc_dwi.nii.gz`, QC HTML |
| Manual FSL preprocessing | topup/eddy pipeline (expert/manual control) | `fsl-tool` | corrected DWI, rotated bvecs, QC (`eddy_quad`) |
| HCP-grade diffusion preprocessing | HCP diffusion pipeline end-to-end | `hcppipeline-tool` | HCP-style diffusion outputs |
| Tensor metrics | Fit DTI and compute FA/MD/AD/RD | `dipy-tool` (or `fsl-tool` dtifit) | `FA/MD/AD/RD.nii.gz` |
| ROI-wise diffusion features | Extract ROI stats from FA/MD/etc maps | `nilearn-tool` (or `fsl-tool`) | `roi_stats_*.csv` |
| **Tractography & connectome (MRtrix3-based)** | **FOD estimation, ACT-based tractography, SIFT filtering, connectome construction** | **`dipy-tool` (or `fsl-tool` bedpostx/probtrackx or dedicated MRtrix3 wrapper)** | **streamline tractograms (.tck), connectivity matrices, VTK visualization** |
| Fiber orientation distribution (FOD) | Compute multi-tissue CSD FODs from preprocessed DWI | `dipy-tool` (or MRtrix3 dwi2fod) | `WM_FODs.mif`, `GM.mif`, `CSF.mif` |
| Anatomically-Constrained Tractography (ACT) | Generate 5-tissue segmentation from T1w, seed probabilistic streamlines with constraints | `dipy-tool` (or MRtrix3 tckgen+5ttgen) | streamline tractograms (.tck), 5TT tissue maps |
| SIFT streamline filtering | Reduce quantization bias in streamlines via Shape-Preserving SIFT | `dipy-tool` (or MRtrix3 tcksift) | filtered tractogram (.tck), streamline counts |

---

## Recommended Default Strategy
- **Default benchmark route for full DWI/connectome tasks** → `qsiprep-tool` for preprocessing, then MRtrix3-style multi-tissue FOD + ACT + SIFT2 + `tck2connectome`
- **BIDS input + robust preprocessing + QC only** → `qsiprep-tool`
- **FSL eddy/topup + low-level control when explicitly requested** → `fsl-tool`
- **HCP-style preprocessing only when the prompt explicitly calls for HCP conventions or inputs** → `hcppipeline-tool`

### Preferred Full-Pipeline Answer Pattern
When the user asks for a full DWI pipeline that ends in tractography or connectome outputs, the plan should usually be framed as:
1. Organize raw inputs into BIDS.
2. Run `qsiprep-tool` preprocessing with rotated bvecs and QC.
3. Confirm structural/parcellation prerequisites for connectomics:
    - T1w image quality and space
    - FreeSurfer `aparc+aseg` or another atlas/parcellation
    - label table / LUT
    - DWI-space alignment target or registration route
4. Build an MRtrix3-style downstream workflow:
    - 5TT segmentation
    - label conversion to connectome nodes
    - response estimation
    - multi-tissue CSD FODs
    - ACT tractography with backtracking
    - SIFT2 weighting or SIFT filtering
    - `tck2connectome`
5. Only fall back to tensor-only tractography/connectivity if the data or missing inputs make the preferred route invalid.

### Missing Inputs And User Choices
If the task cannot be fully specified from the prompt alone, ask for the missing analysis-critical items before execution. Typical required user decisions include:
- Which atlas/parcellation to use for the connectome: FreeSurfer `aparc+aseg`, Desikan, Destrieux, Schaefer, AAL, or a user-supplied atlas
- Whether the atlas is already in DWI space, T1w space, or MNI space, and what registration path should be used
- Whether a labels/LUT CSV/TSV is available and which file should define ROI names/order
- Whether the acquisition is single-shell or multi-shell, which constrains DTI-only vs FOD/CSD modeling
- Tractography algorithm and scale choices when they materially affect the result, for example deterministic vs probabilistic tracking, target streamline count, minimum/maximum streamline length, cutoff threshold, SIFT vs SIFT2, and connectome weighting rule

If those inputs are missing, do both of the following:
1. State `Missing required input:` and list the exact missing files or decisions.
2. Offer the user a short menu of high-impact parameter choices instead of burying them in assumptions.

### HCP-Style MRtrix3 Tractography Workflow
Generate high-quality fiber tracts with FOD + ACT + SIFT2/SIFT filtering → VTK visualization and connectome generation.

**Inputs:** Preprocessed DWI (motion/eddy/distortion corrected), rotated bvecs, T1w (ACPC-aligned), FreeSurfer `aparc+aseg.nii.gz`, brain mask

**Processing:** Delegate to `dipy-tool` or MRtrix3-native wrapper:
1. 5TT tissue segmentation (CSF/GM/WM/pathological) from T1w
2. Parcellation relabeling (FreeSurfer → MRtrix3 connectome labels)
3. DWI format conversion to MIF with gradient info
4. Multi-tissue response functions (WM/GM/CSF) via `msmt_5tt`
5. Multi-tissue CSD FOD computation → WM_FODs, GM, CSF
6. ACT-constrained tractography with backtracking (50k streamlines or user-selected target)
7. Prefer SIFT2 streamline weighting; use SIFT filtering when a filtered tractogram file is specifically required
8. VTK format conversion for visualization
9. ROI connectome matrix via `tck2connectome`, ideally with SIFT2 weights when available

**Runtime:** 30–60 min/subject | **Disk:** ~30 GB/subject (intermediate MIF files) | **Memory:** 16–32 GB | **Cores:** 8–16 (multi-threaded)

---

## Installation (Ubuntu)

**MRtrix3 (Conda):**
```bash
conda install -c conda-forge -c mrtrix3 mrtrix3 libstdcxx-ng
conda update -c mrtrix3 mrtrix3
```

**FSL (includes FIRST for subcortical refinement):**
```bash
curl -Ls https://fsl.fmrib.ox.ac.uk/fsldownloads/fslconda/releases/getfsl.sh | sh -s
export FSLDIR=/usr/local/fsl
source $FSLDIR/etc/fslconf/fsl.sh && export PATH=$FSLDIR/bin:$PATH
```

**FreeSurfer Integration:** MRtrix3 uses `/usr/local/freesurfer/FreeSurferColorLUT.txt` and `share/mrtrix3/labelconvert/fs_default.txt`

---

## Complete HCP-Style MRtrix3 Tractography (Key Steps)

**Required inputs:** Preprocessed DWI.nii.gz, bvecs/bvals (rotated), T1w_acpc_dc_restore_brain.nii.gz, aparc+aseg.nii.gz, brain mask

| Step | Command | Input | Output | Purpose |
|---:|---|---|---|---|
| 1 | `5ttgen fsl T1w ... 5TT.mif -premasked` | T1w, mask | 5TT.mif | 5-tissue segmentation (CSF/GM/WM) → ACT seed |
| 2 | `labelconvert aparc+aseg.nii.gz ... nodes.mif` | parcellation | nodes.mif | FreeSurfer→MRtrix3 connectome labels |
| 3 | `mrconvert DWI.nii.gz DWI.mif -fslgrad bvecs bvals` | DWI | DWI.mif | Embed gradients; standardize format |
| 4 | `dwi2response msmt_5tt DWI.mif 5TT.mif RF_*.txt` | DWI, 5TT | RF_WM/GM/CSF.txt | Multi-tissue response functions |
| 5 | `dwi2fod msmt_csd DWI.mif RF_*.txt WM_FODs.mif ...` | DWI, responses | WM_FODs.mif | FOD computation (multi-tissue CSD) |
| 6 | `tckgen WM_FODs.mif 5W.tck -act 5TT.mif -backtrack ...` | FOD, 5TT | 5W.tck | 50k streamlines w/ ACT constraints; backtrack, minlength 15, maxlength 600, **cutoff 0.06** |
| 7 | `tcksift2 5W.tck WM_FODs.mif sift2_weights.txt -act ...` | tractogram, FOD | sift2_weights.txt | Preferred quantitative weighting for connectome construction |
| 8 | `trk2vtk 5W.tck fiber_*.vtk` | tractogram | VTK file | Visualization in ParaView/TrackVis |
| 9 | `tck2connectome 5W.tck nodes.mif connectome.csv -tck_weights_in sift2_weights.txt` | tractogram, parcels, SIFT2 weights | connectome.csv | Preferred ROI×ROI structural connectome |

If the user explicitly wants a filtered tractogram artifact, an additional SIFT run is still valid:
- `tcksift 5W.tck WM_FODs.mif 5W_SIFT_v2.tck -act 5TT.mif`

---

## Reference Implementation (Batch Processing via MATLAB)

```matlab
%% Fiber_Tracking_Batch.m - Batch MRtrix3 tractography (HCP reference)
% NOTE: For reference only; delegate actual execution to tool skills.

clc; source_data_path = '/media/hzb/S900-1-1/';
output_dir = '/media/disk10t/hzb/data/HCP_s900_data/MRtrix_fiber';
cd(output_dir);

%% Batch loop: iterate subjects by ID prefix (1*...9*)
for num_begin = 1:9
    tt = [num2str(num_begin), '*'];
    File = dir(fullfile(source_data_path, tt));
    FileNames = {File.name}';
    
    for file = 1:size(FileNames, 1)
        fprintf('Processing: %s\n', FileNames{file,1});
        orig_data_dir = [source_data_path FileNames{file,1}];
        
        % Skip if input missing
        if ~exist([orig_data_dir '/T1w/Diffusion/data.nii.gz']), continue; end
        
        % CHECKPOINT: skip if already processed
        if exist([output_dir '/' FileNames{file,1} '/5TT.mif']), continue; end
        
        out_sbj_dir = [output_dir '/' FileNames{file,1}];
        mkdir(out_sbj_dir); cd(out_sbj_dir);
        
        % Copy 6 input files from HCP source
        copyfile([orig_data_dir '/T1w/Diffusion/bvals'], [out_sbj_dir '/bvals']);
        copyfile([orig_data_dir '/T1w/Diffusion/bvecs'], [out_sbj_dir '/bvecs']);
        copyfile([orig_data_dir '/T1w/Diffusion/data.nii.gz'], [out_sbj_dir '/data.nii.gz']);
        copyfile([orig_data_dir '/T1w/Diffusion/nodif_brain_mask.nii.gz'], [out_sbj_dir '/nodif_brain_mask.nii.gz']);
        copyfile([orig_data_dir '/T1w/T1w_acpc_dc_restore_brain.nii.gz'], [out_sbj_dir '/T1w_acpc_dc_restore_brain.nii.gz']);
        copyfile([orig_data_dir '/T1w/aparc+aseg.nii.gz'], [out_sbj_dir '/aparc+aseg.nii.gz']);
        
        try
            % Steps 1-9: MRtrix3 pipeline
            system('5ttgen fsl T1w_acpc_dc_restore_brain.nii.gz 5TT.mif -premasked');
            system('labelconvert aparc+aseg.nii.gz /usr/local/freesurfer/FreeSurferColorLUT.txt /home/hzb/anaconda3/share/mrtrix3/labelconvert/fs_default.txt nodes.mif');
            system('mrconvert data.nii.gz DWI.mif -fslgrad bvecs bvals -datatype float32 -strides 0,0,0,1');
            system('dwiextract DWI.mif - -bzero | mrmath - mean meanb0.mif -axis 3');
            system('dwi2response msmt_5tt DWI.mif 5TT.mif RF_WM.txt RF_GM.txt RF_CSF.txt -voxels RF_voxels.mif');
            system('dwi2fod msmt_csd DWI.mif RF_WM.txt WM_FODs.mif RF_GM.txt GM.mif RF_CSF.txt CSF.mif -mask nodif_brain_mask.nii.gz');
            system('tckgen WM_FODs.mif 5W.tck -act 5TT.mif -backtrack -crop_at_gmwmi -seed_dynamic WM_FODs.mif -minlength 15 -maxlength 600 -select 50000 -cutoff 0.06');
            system('tcksift 5W.tck WM_FODs.mif 5W_SIFT_v2.tck -act 5TT.mif -term_number 50000');
            trk2vtk('5W_SIFT_v2.tck', [out_sbj_dir '/' FileNames{file,1} '_fiber_mrtrix_5W_SIFT_v2.vtk']);
            
            % Optional: connectome
            % system('tck2connectome 5W_SIFT_v2.tck nodes.mif connectome.csv -symmetric -zero_diagonal');
            
            fprintf('  ✓ Complete\n\n');
        catch ME
            fprintf('  ERROR: %s. Skipping.\n\n', ME.message);
            continue
        end
    end
end
fprintf('Batch complete!\n');
```

**Key features:** Checkpoint-based skip logic (5TT.mif exists → skip), file auto-copy, error handling (try-catch), progress reporting. **Specs:** 30–60 min/subject, ~30 GB disk, 16–32 GB RAM, 8–16 cores ideal.

---

## Standard Output Layout (Recommended)
All outputs must be written under `./dwi_output/`:
- `dwi_output/bids/`        (optional local BIDS copy/staging)
- `dwi_output/preproc/`     (QSIPrep/FSL/HCP outputs + QC pointers)
- `dwi_output/dti/`         (FA/MD/AD/RD maps)
- `dwi_output/roi/`         (ROI summary CSVs)
- `dwi_output/mrtrix3/`     (MRtrix3-specific outputs)
  - `mrtrix3/5TT.mif`                    (5-tissue tissue segmentation map)
  - `mrtrix3/nodes.mif`                  (parcellation in connectome space)
  - `mrtrix3/DWI.mif`                    (DWI data in MRtrix3 format)
  - `mrtrix3/RF_WM.txt`, `RF_GM.txt`, `RF_CSF.txt` (tissue-specific response functions)
  - `mrtrix3/WM_FODs.mif`                (white matter fiber orientation distribution)
  - `mrtrix3/GM.mif`, `CSF.mif`          (tissue density maps)
  - `mrtrix3/5W.tck`                     (raw tractogram, 50k streamlines)
    - `mrtrix3/sift2_weights.txt`          (preferred SIFT2 streamline weights)
    - `mrtrix3/5W_SIFT_v2.tck`             (optional SIFT-filtered tractogram when explicitly requested)
  - `mrtrix3/fiber_mrtrix_5W_SIFT_v2.vtk` (VTK format for visualization)
    - `mrtrix3/connectome.csv`             (ROI×ROI connectivity matrix, preferably SIFT2-weighted)
- `dwi_output/logs/`        (claw-shell logs/tags, MRtrix3 command logs)

---

## Important Notes & Limitations

**General preprocessing:**
- Preprocessing critical: motion, eddy, distortion sensitivity
- Use **rotated bvecs** (not original) after correction for downstream fitting
- Reverse PE or fieldmaps strongly improve distortion correction
- Single-shell (b=1000) allows DTI; multi-shell enables higher-order models (FOD, HARDI, CSD)

**MRtrix3 tractography:**
- Tissue segmentation quality paramount: poor T1w or FreeSurfer → anatomically implausible tracts
- **msmt_5tt** (multi-tissue, 5TT-constrained) most robust; requires 5TT from structural pipeline
- **Multi-tissue CSD** (msmt_csd) decomposes WM/GM/CSF jointly; improves specificity
- **ACT:** enforces WM→GM interface endings; **backtrack** allows complex anatomy
- **Cutoff 0.06** typical for single-shell; adjust for multi-shell or high b-value
- **SIFT2 weighting:** usually preferred for quantitative connectomes; preserve the full tractogram and pass weights into `tck2connectome`
- **SIFT filtering:** still useful when the downstream consumer explicitly needs a filtered tractogram file
- **Runtime:** 30–60 min/subject; **disk:** ~30 GB; **RAM:** 16–32 GB; **cores:** 8–16 (multi-threaded)

**Limitations:**
- MRtrix3 requires single/multi-shell HARDI; not suitable for low-angular-resolution DWI
- Tractography inherently ambiguous: streamlines are probabilistic reconstructions, not ground truth; crossing-fiber challenges remain
- Connectome counts depend on seeding, filtering, anatomy; not directly comparable across studies without normalization
- DWI preprocessing (eddy/topup) and FOD are computational bottlenecks
- **Research use only;** not validated for clinical navigation or surgical planning

---

## When to Call This Skill
- The user requests DWI/DTI preprocessing (QSIPrep, FSL eddy/topup, HCP) or diffusion feature extraction (FA/MD/AD/RD).
- The user wants **fiber tractography** with anatomical constraints (MRtrix3 ACT + SIFT).
- The user wants ROI-based diffusion statistics, **connectome matrices**, or **VTK fiber visualization**.
- After `research-idea` or `method-design` when the study involves white matter microstructure or structural connectivity.

---

## Complementary / Related Skills
- `qsiprep-tool` → recommended BIDS-App diffusion preprocessing + QC reports
- `fsl-tool` → topup/eddy, dtifit, bedpostx/probtrackx, diffusion utilities; **FIRST** used for subcortical segmentation in MRtrix3 pipelines
- `hcppipeline-tool` → HCP diffusion preprocessing alternative
- `dipy-tool` → tensor metrics (FA/MD/AD/RD), custom diffusion fitting, scalar map generation; can also implement MRtrix3 workflows (alternative to shell commands)
- `smri-skill` → T1w structural preprocessing (critical for 5TT segmentation and FreeSurfer parcellation in MRtrix3 tractography)
- `nilearn-tool` → ROI/atlas feature extraction from diffusion scalar maps (NIfTI)
- `bids-organizer` → create/validate BIDS dataset
- `dcm2nii` → DICOM → NIfTI conversion (upstream for diffusion data)
- `dependency-planner` + `conda-env-manager` → MRtrix3 & FSL installation/environment management
- `docker-env-manager` → used when QSIPrep or other containerized tools need Docker planning

---

## Reference
Aligned with NeuroClaw modality-skill pattern (see `fmri-skill`, `smri-skill`, `eeg-skill`).  
**Validated pipeline**: HCP-style MRtrix3 fiber tractography (5TT + multi-tissue CSD FOD + ACT + SIFT filtering).  
Core tools used:
- `qsiprep-tool` (v0.16+): BIDS-App diffusion preprocessing + QC
- `fsl-tool`: eddy/topup motion & distortion correction, FIRST subcortical segmentation
- `mrtrix3` (v3.0+): tissue segmentation, FOD, tractography, SIFT filtering
- `freesurfer-tool`: cortical/subcortical segmentation (aparc+aseg parcellation)
- `dipy`: Python diffusion modeling library (alternative implementation)
- `nilearn`: Atlas-based ROI extraction from scalar maps

**Key references**:
- Jeurissen et al. (2014): Multi-tissue CSD for robust FOD estimation
- Smith et al. (2012): Anatomically-Constrained Tractography (ACT) principles
- Smith et al. (2015): SIFT quantitative fiber tractography
- Fischl et al. (2002): FreeSurfer cortical parcellation

---
Created At: 2026-03-26 01:01 HKT
Last Updated At: 2026-03-28 18:08 HKT
Author: chengwang96