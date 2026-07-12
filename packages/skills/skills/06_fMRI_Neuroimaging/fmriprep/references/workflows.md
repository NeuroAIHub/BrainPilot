# Workflow Internals

The fMRIPrep pipeline is a Nipype workflow graph. This reference maps each
stage to its Python entry point (so you can read the source) and describes
the algorithms in enough depth to write a methods section or troubleshoot a
node failure.

Source root: `fmriprep/workflows/` — `base.py` (top-level), `bold/` (BOLD
per-run subworkflows). Anatomical workflows live in `smriprep` (sister package),
distortion-correction in `sdcflows`, common utilities in `niworkflows`.

## Table of Contents
1. [Top-level flow](#1-top-level-flow)
2. [Anatomical pipeline](#2-anatomical-pipeline)
3. [BOLD pipeline overview (fit vs apply)](#3-bold-pipeline-overview-fit-vs-apply)
4. [BOLD reference-image estimation](#4-bold-reference-image-estimation)
5. [Head-motion correction (HMC)](#5-head-motion-correction-hmc)
6. [Slice-timing correction (STC)](#6-slice-timing-correction-stc)
7. [Susceptibility distortion correction (SDC)](#7-susceptibility-distortion-correction-sdc)
8. [Pre-processed BOLD in native space](#8-pre-processed-bold-in-native-space)
9. [EPI-to-T1w registration (BBR)](#9-epi-to-t1w-registration-bbr)
10. [Resampling to standard/native volumetric spaces](#10-resampling-to-standardnative-volumetric-spaces)
11. [Surface sampling (FreeSurfer)](#11-surface-sampling-freesurfer)
12. [HCP grayordinates / CIFTI-2](#12-hcp-grayordinates--cifti-2)
13. [T2*-driven multi-echo combination](#13-t2-driven-multi-echo-combination)
14. [Confounds estimation](#14-confounds-estimation)
15. [Reports (nireports)](#15-reports-nireports)
16. [Processing levels (`--level`)](#16-processing-levels---level)

---

## 1. Top-level flow

```
init_fmriprep_wf                    (per-run entry)
 └─ init_single_subject_wf          (fmriprep/workflows/base.py)
     ├─ init_anat_preproc_wf        (smriprep.workflows.anatomical)
     ├─ init_bold_wf                (fmriprep/workflows/bold/base.py)  ── one per BOLD run
     │   ├─ init_bold_fit_wf        (fmriprep/workflows/bold/fit.py)
     │   ├─ init_bold_native_wf     (fmriprep/workflows/bold/fit.py)
     │   ├─ init_bold_volumetric_resample_wf   (fmriprep/workflows/bold/apply.py)
     │   ├─ init_bold_surf_wf                  (fmriprep/workflows/bold/resampling.py)
     │   ├─ init_bold_fsLR_resampling_wf       (fmriprep/workflows/bold/resampling.py)
     │   └─ init_bold_confs_wf                 (fmriprep/workflows/bold/confounds.py)
     └─ ds_report_* nodes → visual report reportlets
```

Workflow naming conventions:
- Names end in `_wf`, built by `init_<name>_wf` functions.
- `inputnode` / `outputnode` = workflow "arguments"/"returns".
- `ds_*` nodes write to `<output_dir>/`; `ds_report_*` write reportlets.
- Node/label paths in the graph include `(module)` markers referencing where the
  interface is defined (e.g. `about (reports)`).

---

## 2. Anatomical pipeline
*Entry: `smriprep.workflows.anatomical.init_anat_preproc_wf`*

Steps (in order):

1. **Conform + average T1w** — reorient to RAS, resample to common voxel size,
   optionally average (or unbiased-template) multiple T1w runs.
   - `--subject-anatomical-reference first-lex` (default): register to first (lex) image.
   - `--subject-anatomical-reference unbiased`: `mri_robust_template` unbiased template.
   - `--subject-anatomical-reference sessionwise`: independent per session.

2. **T2w merge/coregistration** — if T2w available, aligned to T1w space. Used
   downstream by FreeSurfer for pial refinement.

3. **N4 bias-field correction** — ANTs `N4BiasFieldCorrection`.

4. **Skull-stripping** — Nipype implementation of `antsBrainExtraction.sh` on
   OASIS30ANTs template (or `--skull-strip-template ...`).
   - `--skull-strip-t1w force` (default) always strips.
   - `--skull-strip-t1w auto` uses a heuristic to detect pre-stripped inputs.
   - `--skull-strip-t1w skip` bypasses stripping entirely.

5. **Tissue segmentation** — FSL `FAST` produces 3-class (CSF/GM/WM) probability
   maps and a discrete segmentation.

6. **Spatial normalization** — ANTs `antsRegistration` multi-scale mutual-info
   nonlinear registration to every requested standard space
   (`--output-spaces MNI152NLin2009cAsym`, etc.). Produces `.h5` composite
   transforms both directions.

7. **Optional lesion cost-function masking** — if
   `sub-XX/anat/sub-XX_label-lesion_roi.nii.gz` exists, ANTs uses it to avoid
   warping healthy tissue into damage (Brett et al. 2001).

8. **Surface reconstruction** — FreeSurfer `recon-all`, three phases:
   - Phase 1: `autorecon1 -noskullstrip` — brain mask from step 4 is injected.
   - Phase 2: import brainmask.
   - Phase 3: resume, using T2w/FLAIR for pial refinement when available.
   - Submillimeter recon triggered automatically if voxels <1 mm, unless
     `--no-submm-recon`. Disable entirely with `--fs-no-reconall`.
   - Reused if outputs already exist in `<output>/sourcedata/freesurfer/sub-XX`.

9. **MSMSulc surface registration** — Multimodal Surface Matching (MSM) using
   sulcal depth to register subject spheres to `fsLR` (HCP convention).
   Disable with `--no-msm`.

10. **Brain-mask refinement** — When FreeSurfer runs, replace the ANTs-derived
    mask with one derived from `mri/aseg.mgz` (better inclusion of deep-brain
    structures).

11. **Cortical thickness / curvature / sulcal-depth conversion** — GIFTI shape
    files plus fsLR-32k CIFTI dscalar summaries.

12. **Outputs** — see `references/outputs.md` for the full naming schema.

---

## 3. BOLD pipeline overview (fit vs apply)
*Entry: `fmriprep/workflows/bold/base.py :: init_bold_wf`*

Since 23.2.0 the BOLD workflow is split for clarity and to enable `--level`
partial runs:

```
BOLD series ──▶ init_bold_fit_wf ──▶ init_bold_native_wf ──▶ init_bold_volumetric_resample_wf
                                                          └▶ init_bold_surf_wf
                                                          └▶ init_bold_fsLR_resampling_wf
                                                          └▶ init_bold_confs_wf
```

- **`bold_fit_wf`** (`fit.py`) — resolves all transforms without saving heavy
  intermediate BOLD data. Outputs reference images, HMC transforms, BBR transform,
  and (when applicable) the fieldmap→BOLDref transform.
- **`bold_native_wf`** (`fit.py`) — applies STC and HMC/SDC in native BOLD space.
  This is the input to all downstream resamplers.
- **`bold_volumetric_resample_wf`** (`apply.py`) — resamples native BOLD into
  each `--output-spaces` template space.
- **`bold_surf_wf`** / **`bold_fsLR_resampling_wf`** — surface / CIFTI paths.
- **`bold_confs_wf`** (`confounds.py`) — confounds table.

At `--level minimal`, only transforms and refs are saved; the resamplers still
run internally when needed for QC plots but their outputs are discarded.

---

## 4. BOLD reference-image estimation
*Entry: `fmriprep/workflows/bold/reference.py :: init_raw_boldref_wf`*

Chooses a per-run reference volume:

- If T1-saturation "dummy scans" are detected (non-steady-state), they are
  averaged (superior tissue contrast).
- Otherwise, median of a motion-corrected volume subset.

For BBR registration a distinct reference is used:
- Prefers a single-band reference (`sbref`) if the dataset provides one.
- Contrast-enhanced and skull-stripped via
  `niworkflows.func.util.init_enhance_and_skullstrip_bold_wf`.
- If fieldmaps present, the stripped reference is SDC-corrected before BBR.

Number of non-steady-state volumes: auto-detected unless `--dummy-scans N`
forces it.

---

## 5. Head-motion correction (HMC)
*Entry: `fmriprep/workflows/bold/hmc.py :: init_bold_hmc_wf`*

- Tool: FSL `mcflirt`.
- Reference: BOLD reference from §4.
- Motion **parameters are estimated on the raw (un-STC) BOLD** so that
  slice-timing interpolation does not alias motion into the estimates
  (Power 2017 recommendation). The motion transforms are then applied jointly
  with STC and SDC downstream (single-interpolation resampling).
- Emits:
  - 6-parameter rigid transforms per volume (`trans_x/y/z`, `rot_x/y/z`).
  - `framewise_displacement`, `rmsd` — pushed to the confounds workflow.
  - `hmc_boldref` (aligned template) — pushed to BBR.

---

## 6. Slice-timing correction (STC)
*Entry: `fmriprep/workflows/bold/stc.py :: init_bold_stc_wf`*

- Tool: AFNI `3dTShift`.
- **Only runs** if `SliceTiming` metadata is present AND ≥5 usable (post-dummy)
  volumes exist.
- Reference slice controlled by `--slice-time-ref` (default `0.5` = middle):
  - `0` / `start` — TR onset (matches raw acquisition; no volume onset shift)
  - `0.5` / `middle` — middle of TR (default; shifts volume onsets by 0.5 TR
    — remember to adjust your first-level model)
  - `1` — end of TR
- Disable with `--ignore slicetiming`.

STC is applied to the raw (validated) BOLD *before* HMC/SDC transforms are
applied — HMC/SDC transforms are then composed and applied together in a
single interpolation step (see §8 / §10). This ordering (STC on raw data →
HMC/SDC on STC-corrected data) is why HMC motion *parameters* are estimated
on the un-STC data in §5.

---

## 7. Susceptibility distortion correction (SDC)
*Delegated to the `sdcflows` package (`sdcflows.workflows.*`).*
See `references/sdc-fieldmaps.md` for user-facing SDC guidance.

Supported estimators (auto-selected from BIDS metadata):

| BIDS fieldmap type | Estimator | Notes |
|--------------------|-----------|-------|
| **PEPOLAR** (opposite phase-encoding EPI) | TOPUP-based | Preferred when available |
| **Phase-difference + magnitude** (`phasediff` or `phase1/phase2`) | PRELUDE→FUGUE | Requires 2 echo times in JSON |
| **Precomputed fieldmap** (`fieldmap` suffix) | FUGUE | User-supplied |
| **Fieldmap-less (SyN)** | ANTs SyN vs anatomical | Enabled by `--use-syn-sdc`, `--force syn-sdc` |

Fieldmap association (SDCFlows preference order):
1. `B0FieldIdentifier` / `B0FieldSource` metadata (BIDS ≥1.6). **If present anywhere in the dataset, `IntendedFor` is ignored.**
2. `IntendedFor` metadata on the fieldmap JSON.

Fieldmap Jacobian modulation is applied by default; disable with
`--ignore fmap-jacobian` (or force with `--force fmap-jacobian`).

---

## 8. Pre-processed BOLD in native space
*Entry: `fmriprep/workflows/bold/fit.py :: init_bold_native_wf`*

Applies HMC + (if any) SDC in **one interpolation step**, concatenating the
composed transforms to minimize resampling blur. The volumetric resampler is
`fmriprep.interfaces.resampling.ResampleSeries` (built on `nitransforms`),
default order-3 **cubic B-spline** interpolation with `grid-constant` boundary
mode (the default since 25.2.0). Output stays in the original BOLD grid.

Note: Lanczos-windowed sinc interpolation is used by fMRIPrep in some
non-volumetric places (e.g. `outputs.py` ANTs `ApplyTransforms` calls for
resampling anat images to output spaces) but the BOLD series itself is
resampled with cubic B-spline.

---

## 9. EPI-to-T1w registration (BBR)
*Entry: `fmriprep/workflows/bold/registration.py :: init_bbreg_wf` (FS on) or `init_fsl_bbr_wf` (FS off).*

With FreeSurfer enabled:
- `bbregister` aligns BOLD reference to the `?h.white` surfaces using
  boundary-based registration.
- `--bold2anat-init` picks the initial reference: `auto` (T2w if available,
  else T1w — default), `t1w`, `t2w`, or `header` (skip init reg).
- `--bold2anat-dof` picks DOF: 6 (rigid, default), 9, or 12.

Without FreeSurfer:
- FSL `flirt` with the BBR cost function (`bbr.sch`, ships in `fmriprep/data/flirtsch/`)
  and the FAST WM segmentation as boundary.

**Fallback**: The BBR result is compared to the initial affine; excessive
deviation rejects BBR and uses the initial affine instead. Override with
`--force bbr` or `--force no-bbr`.

---

## 10. Resampling to standard/native volumetric spaces
*Entry: `fmriprep/workflows/bold/apply.py :: init_bold_volumetric_resample_wf`*

Concatenates: HMC ∘ SDC ∘ BBR ∘ T1w-to-standard, applied in a **single
cubic B-spline** interpolation (nitransforms `ResampleSeries`, order-3,
`grid-constant` boundary mode) for each `--output-spaces` entry. The boilerplate
records this as: "Gridded (volumetric) resamplings were performed using
nitransforms, configured with cubic B-spline interpolation."

`res-*` and other modifiers on `--output-spaces` control resampling grid; see
`references/spaces.md`.

Also produces the T1w brain mask resampled to each target space (using
ANTs `ApplyTransforms` with `MultiLabel` interpolation to preserve label integrity).

---

## 11. Surface sampling (FreeSurfer)
*Entry: `fmriprep/workflows/bold/resampling.py :: init_bold_surf_wf`*

Only runs when FreeSurfer is enabled and `fsnative`/`fsaverage*` is in
`--output-spaces` (or when `--cifti-output` is set).

- Samples cortical ribbon at 6 intervals normal to the white surface, extending
  to the pial surface, and averages — one value per vertex per timepoint.
- Emits GIFTI (`.func.gii`) for both hemispheres.
- Native subject-mesh (`fsnative`), plus `fsaverage` and downsampled
  `fsaverage6` (41k) / `fsaverage5` (10k, default).
- `--medial-surface-nan` replaces medial-wall vertices with NaN.
- `--project-goodvoxels` masks locally high-CoV voxels ("goodvoxels" heuristic).

---

## 12. HCP grayordinates / CIFTI-2
*Entry: `fmriprep/workflows/bold/resampling.py :: init_bold_fsLR_resampling_wf`*

When `--cifti-output` is set:
1. Native BOLD → subject-native surface via §11.
2. Dilate to fill sampling holes.
3. Resample to `fsLR` mesh using Connectome Workbench (aligned L/R).
4. Combine with volumetric subcortical time series (resampled to a
   MNI152NLin6Asym grid) into a CIFTI-2 dense time series.

Resolutions:
- `--cifti-output 91k` — 91,282 grayordinates, 2 mm subcortical (default).
- `--cifti-output 170k` — 170,494 grayordinates, 1.6 mm subcortical.

Uses `wb_command` from Connectome Workbench (v1.5.0+).

---

## 13. T2*-driven multi-echo combination
*Entry: `fmriprep/workflows/bold/t2s.py :: init_bold_t2s_wf`*

For datasets with ≥3 echoes (`echo-N_bold`):
- Uses `tedana`'s `t2smap_workflow` to estimate adaptive T2* and S0 maps.
- Produces an **optimally combined** BOLD series that replaces the per-echo
  data for all downstream steps.
- Method controlled by `--me-t2s-fit-method`:
  - `curvefit` (default) — nonlinear regression; slower, more accurate.
  - `loglin` — log-linear regression; faster.
- `--me-output-echos` also saves per-echo STC/HMC/SDC-corrected series for
  downstream tedana denoising.

Two-echo data is **rejected** since 25.2.4 (tedana requires ≥3 echoes to fit T2*).

---

## 14. Confounds estimation
*Entry: `fmriprep/workflows/bold/confounds.py :: init_bold_confs_wf`*

Given motion-corrected BOLD, brain mask, HMC parameters, and tissue seg,
computes per-timepoint nuisance signals. See `references/confounds.md` for the
full column dictionary. Highlights:

- **Motion**: 6 rigid params (+ derivatives + squares → 24-parameter model).
- **Global signals**: `csf`, `white_matter`, `global_signal` (+ derivatives + squares).
- **Framewise displacement** (Power 2012), **RMSD** (Jenkinson 2002).
- **DVARS** / **std_dvars** (Power 2012).
- **CompCor**:
  - `a_comp_cor_XX` — anatomical, **combined** WM ∪ CSF mask (Behzadi original).
  - `c_comp_cor_XX` — anatomical, **CSF-only** mask (Muschelli refinement).
  - `w_comp_cor_XX` — anatomical, **WM-only** mask (Muschelli refinement).
  - `t_comp_cor_XX` — temporal, top-variance voxels.
  - High-pass filter applied before decomposition; corresponding
    `cosine_XX` DCT regressors are output — include them in your GLM if using
    CompCor.
- **Non-steady-state outliers**: `non_steady_state_outlier_XX` (one column per detected outlier).
- **Motion spike regressors**: `motion_outlier_XX`, flagged when
  FD > `--fd-spike-threshold` OR std-DVARS > `--dvars-spike-threshold`.
- **Edge / crown PCA**: `edge_comp_XX` — 24 components from an "outer brain
  edge" (crown) mask, tagged in the JSON with `Method: EdgeRegressor`
  (Patriat 2017 / Provins 2022).

By default, only components explaining the top 50% of ROI variance are
retained; `--return-all-components` keeps all (dropped ones are still tracked
in the JSON metadata).

---

## 15. Reports (nireports)

Each subject gets `<output>/sub-XX.html` (or split across sessions if
`--aggregate-session-reports` is exceeded).

Report structure defined by:
- `fmriprep/data/reports-spec.yml` (top-level)
- `fmriprep/data/reports-spec-anat.yml` (anatomical section)
- `fmriprep/data/reports-spec-func.yml` (per-run functional section)

Reportlets included (per subject / per BOLD run):
- Summary tables + BIDS validation warnings
- Anatomical conformation, skull-strip, tissue segmentation, MNI normalization animations
- FreeSurfer recon overlay
- Per-run BOLD validation, BBR alignment overlay, SDC before/after (if applicable)
- Carpetplot with FD/DVARS/GS strips (Power 2016)
- ROI overlay (tCompCor blue, aCompCor magenta)
- CompCor cumulative-variance curves
- Confound correlation matrix + global-signal correlation
- Multi-echo: T2*/S0 map, per-echo histogram, ICA_AROMA plot (legacy)
- Boilerplate citations (`CITATION.md/html/tex`)

Sample report: https://fmriprep.org/en/latest/_static/SampleReport/sample_report.html

---

## 16. Processing levels (`--level`)

| Level | What's saved | Use case |
|-------|--------------|----------|
| `minimal` | Transforms, references, brain masks. No resampled BOLD in outputs. All QC-relevant reportlets except carpetplot / confounds are still generated. | Large datasets, disk-constrained; also anatomical-only-adjacent flows. |
| `resampling` | + intermediate NIfTIs helpful for third-party resampling. If multi-echo, individual echos are saved after STC/HMC/SDC (like `--me-output-echos`). | You plan to do your own resampling downstream. |
| `full` (default) | + resampled BOLD in every `--output-spaces` target; CIFTI (if enabled); all confounds artifacts and carpetplots. | Standard use. |

Combine `--level minimal` with `--derivatives fmriprep=<path>` in a later run
to add outputs on demand.
