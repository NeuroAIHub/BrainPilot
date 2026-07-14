# Outputs Reference

fMRIPrep emits three broad classes of output:
1. **Visual QA reports** — one HTML per subject (`sub-XX.html`).
2. **Derivatives** — preprocessed NIfTI/GIFTI/CIFTI + JSON sidecars.
3. **Confounds** — nuisance regressor TSVs (with JSON metadata).

Everything follows the [BIDS-Derivatives](https://bids-specification.readthedocs.io/en/stable/05-derivatives/01-introduction.html)
spec (plus BEP-011/012 for functional/structural extensions).

## Table of Contents
1. [Top-level layout](#top-level-layout)
2. [Anatomical derivatives (per subject)](#anatomical-derivatives-per-subject)
3. [FreeSurfer derivatives](#freesurfer-derivatives)
4. [Functional derivatives (per BOLD run)](#functional-derivatives-per-bold-run)
5. [Motion / coregistration / fieldmap transforms](#motion--coregistration--fieldmap-transforms)
6. [Confounds files](#confounds-files)
7. [Multi-echo derivatives](#multi-echo-derivatives)
8. [Surface / GIFTI derivatives](#surface--gifti-derivatives)
9. [CIFTI grayordinate derivatives](#cifti-grayordinate-derivatives)
10. [Reports and boilerplate](#reports-and-boilerplate)
11. [Filename entities cheat-sheet](#filename-entities-cheat-sheet)
12. [Legacy layout (pre-21.0)](#legacy-layout-pre-210)

---

## Top-level layout

Default (`--output-layout bids`, since 21.0.x):

```
<output_dir>/
    dataset_description.json      # BIDS-Derivatives metadata; PipelineDescription = "fMRIPrep"
    .bidsignore
    logs/
        CITATION.md               # Boilerplate for methods sections
        CITATION.html
        CITATION.tex
        (Nipype crash files if any)
    sub-<label>/
        anat/
        func/
        (figures/)                # HTML reportlets
    sub-<label>.html              # Per-subject visual report
    sourcedata/
        freesurfer/               # If reconstructor ran or was reused
```

- Output dir is itself a valid BIDS derivative dataset — can be nested with other BIDS-Derivatives (smriprep, MRIQC, etc.).
- `sub-<label>.html` is the visual QA report — open in any browser.

---

## Anatomical derivatives (per subject)

Under `sub-<label>/anat/`:

```
sub-<label>[_space-<space>]_desc-preproc_T1w.nii.gz
sub-<label>[_space-<space>]_desc-preproc_T2w.nii.gz         # if T2w + FS enabled
sub-<label>[_space-<space>]_desc-brain_mask.nii.gz
sub-<label>[_space-<space>]_dseg.nii.gz                     # discrete seg (CSF/GM/WM)
sub-<label>[_space-<space>]_label-CSF_probseg.nii.gz
sub-<label>[_space-<space>]_label-GM_probseg.nii.gz
sub-<label>[_space-<space>]_label-WM_probseg.nii.gz
```

- Absence of `space-` = native T1w space.
- Common `space-*`: `MNI152NLin2009cAsym`, `MNI152NLin6Asym`, ...

**T1w↔MNI transforms** (composite HDF5, both directions):

```
sub-<label>_from-MNI152NLin2009cAsym_to-T1w_mode-image_xfm.h5
sub-<label>_from-T1w_to-MNI152NLin2009cAsym_mode-image_xfm.h5
```

**Surface files** (if FreeSurfer enabled):

```
sub-<label>_hemi-[LR]_white.surf.gii
sub-<label>_hemi-[LR]_midthickness.surf.gii
sub-<label>_hemi-[LR]_pial.surf.gii
sub-<label>_hemi-[LR]_desc-reg_sphere.surf.gii              # fsaverage reg sphere
sub-<label>_hemi-[LR]_space-fsLR_desc-reg_sphere.surf.gii
sub-<label>_hemi-[LR]_space-fsLR_desc-msmsulc_sphere.surf.gii   # if MSMSulc enabled
sub-<label>_hemi-[LR]_desc-cortex_mask.label.gii
```

**T1w ↔ fsnative** transforms (affine):

```
sub-<label>_from-fsnative_to-T1w_mode-image_xfm.txt
sub-<label>_from-T1w_to-fsnative_mode-image_xfm.txt
```

**Shape metrics** (per hemisphere GIFTI + fsLR-32k CIFTI dscalar):

```
sub-<label>_hemi-[LR]_thickness.shape.gii
sub-<label>_hemi-[LR]_curv.shape.gii
sub-<label>_hemi-[LR]_sulc.shape.gii
sub-<label>_space-fsLR_den-32k_thickness.dscalar.nii
sub-<label>_space-fsLR_den-32k_curv.dscalar.nii
sub-<label>_space-fsLR_den-32k_sulc.dscalar.nii
```

⚠️ HCP inverts curv/sulc signs vs FreeSurfer; fMRIPrep follows HCP conventions
in CIFTI dscalars and masks the medial wall.

---

## FreeSurfer derivatives

Full FreeSurfer subjects tree (uncompressed, ~600 MB per subject):

```
<output_dir>/
    sourcedata/
        freesurfer/
            fsaverage/           # copies as needed
            fsaverage5/
            fsaverage6/
            sub-<label>/
                mri/  surf/  label/  stats/  scripts/  touch/ ...
    desc-aparc_dseg.tsv          # aparc label ↔ integer lookup
    desc-aparcaseg_dseg.tsv      # aparc+aseg label ↔ integer lookup
```

Placement:
- Default (`--output-layout bids`): `sourcedata/freesurfer/`.
- Legacy (`--output-layout legacy`): `<output>/freesurfer/`.
- Override with `--fs-subjects-dir /custom/path` (path is created if missing).

The `sourcedata/` prefix marks FreeSurfer outputs as an *input* to fMRIPrep
(they are re-consumable across runs). If reused across runs, keep the same
`--fs-subjects-dir`.

---

## Functional derivatives (per BOLD run)

Common entities per BOLD run: `task-<task>[_run-<idx>][_ses-<ses>][_dir-<dir>][_acq-<acq>][_echo-<n>]`.
Denoted `[specifiers]` below.

Under `sub-<label>/func/`:

**Volumetric BOLD** (one file per `--output-spaces` volumetric target, at `--level full`):

```
sub-<label>_[specifiers]_space-<space>_desc-preproc_bold.nii.gz    # main preprocessed BOLD
sub-<label>_[specifiers]_space-<space>_desc-brain_mask.nii.gz      # matching mask (minimal level)
sub-<label>_[specifiers]_space-<space>_boldref.nii.gz              # reference in same space
```

**FreeSurfer segmentations in BOLD space** (if FS enabled, `--level full`):

```
sub-<label>_[specifiers]_space-T1w_desc-aparcaseg_dseg.nii.gz
sub-<label>_[specifiers]_space-T1w_desc-aseg_dseg.nii.gz
```

**Fieldmap-corrected reference** (if a fieldmap was used):

```
sub-<label>_[specifiers]_space-<space>_desc-fmapref_bold.nii.gz
```

---

## Motion / coregistration / fieldmap transforms

Available at every `--level` (part of "minimal"):

**HMC** — reference image and per-volume rigid transform (ITK txt format,
`from-orig` = raw BOLD grid, `to-boldref` = HMC target reference):

```
sub-<label>_[specifiers]_desc-hmc_boldref.nii.gz
sub-<label>_[specifiers]_from-orig_to_boldref_mode-image_desc-hmc_xfm.txt
```

**Coregistration** — BOLD ref → T1w affine:

```
sub-<label>_[specifiers]_desc-coreg_boldref.nii.gz
sub-<label>_[specifiers]_from-boldref_to-T1w_mode-image_desc-coreg_xfm.txt
```

**Fieldmap registration** — if SDC ran:

```
# If fieldmap is B0Identifier=TOPUP:
sub-<label>_[specifiers]_from-boldref_to-TOPUP_mode-image_xfm.txt

# If fieldmap is found via IntendedFor (auto-generated ID):
sub-<label>_[specifiers]_from-boldref_to-auto000XX_mode-image_xfm.txt
```

These transforms let downstream tools reproduce the exact preprocessing chain.

---

## Confounds files

For every BOLD run:

```
sub-<label>_[specifiers]_desc-confounds_timeseries.tsv
sub-<label>_[specifiers]_desc-confounds_timeseries.json      # column metadata
```

Row = timepoint (in the original series length; nonsteady-state and dummy rows
often have `n/a` for framewise-derived measures). See `references/confounds.md`
for the full column reference and typical denoising strategies.

Excerpt of a typical TSV (columns truncated):

```
csf   white_matter  global_signal  std_dvars  dvars   framewise_displacement  t_comp_cor_00  ...  a_comp_cor_00  ...  non_steady_state_outlier00  trans_x  trans_y  trans_z  rot_x  rot_y  rot_z
682.7 0.0           491.6          n/a        n/a     n/a                     0.0            ...  0.0            ...  1                            0.0      0.0      0.0      -1e-4  0      0
669.1 0.0           489.4          1.168      17.58   0.0721                  -0.451         ...  -0.032         ...  0                            0.021    0.046    0.0003   0      0      0
```

---

## Multi-echo derivatives

For inputs `sub-01_task-rest_echo-{1,2,3}_bold.nii.gz`:

Base outputs (from the optimally combined series):

```
sub-01_task-rest_boldref.nii.gz
sub-01_task-rest_desc-brain_mask.nii.gz
sub-01_task-rest_T2starmap.nii.gz                                  # tedana T2* estimate
sub-01_task-rest_space-<space>_desc-preproc_bold.nii.gz            # combined + preprocessed
```

If `--me-output-echos` (or `--level resampling`), per-echo preprocessed series:

```
sub-01_task-rest_echo-1_desc-preproc_bold.nii.gz
sub-01_task-rest_echo-2_desc-preproc_bold.nii.gz
sub-01_task-rest_echo-3_desc-preproc_bold.nii.gz
```

Feed these to `tedana` for downstream denoising.

---

## Surface / GIFTI derivatives

When `fsnative` / `fsaverage*` is in `--output-spaces`:

```
sub-<label>_[specifiers]_hemi-[LR]_space-<surface_space>_bold.func.gii
```

- `<surface_space>`: `fsnative` (full-density subject mesh), `fsaverage`
  (164k), `fsaverage6` (41k), `fsaverage5` (10k, default when `fsaverage` given
  without density modifier).
- One file per hemisphere per run per space.
- If `--medial-surface-nan`, medial-wall vertices contain NaN.

---

## CIFTI grayordinate derivatives

When `--cifti-output` is set (91k default; 170k available):

```
sub-<label>_[specifiers]_space-fsLR_den-91k_bold.dtseries.nii
sub-<label>_[specifiers]_space-fsLR_den-91k_bold.json
```

Structure:
- Cortical grayordinates on the fsLR mesh (32k-per-hemisphere for 91k output,
  164k-per-hemisphere for 170k; medial wall is masked out).
- Subcortical grayordinates on a MNI152NLin6Asym volumetric grid at 2 mm
  (91k output) or 1.6 mm (170k output).
- Total: 91,282 grayordinates for 91k output; 170,494 for 170k output.
- Compatible with HCP Pipelines and Connectome Workbench.

---

## Reports and boilerplate

**Visual QA report**: `<output_dir>/sub-<label>.html`
- Standalone HTML — embedded SVG reportlets. Open in any modern browser.
- If sessions exceed `--aggregate-session-reports N` (default 4), splits into
  `sub-<label>_ses-<ses>.html` files.

**Reportlets** live under `sub-<label>/figures/` (SVG + small HTML fragments).
They are the pieces the report is assembled from — usable independently in
supplementary materials.

**Boilerplate citations** in `<output_dir>/logs/`:

```
CITATION.md      # Markdown - authoritative source
CITATION.html    # Rendered HTML
CITATION.tex     # LaTeX
```

Copy the boilerplate verbatim into your methods section — it's CC0-licensed
public domain, drafted specifically to cite every tool used with the exact
versions from this run. See `references/citation.md`.

---

## Filename entities cheat-sheet

BIDS-Derivatives filename entities in fMRIPrep output, in canonical order:

| Entity | Meaning | Example |
|--------|---------|---------|
| `sub-` | Subject | `sub-01` |
| `ses-` | Session | `ses-01` |
| `task-` | Task | `task-rest` |
| `acq-` | Acquisition variant | `acq-mb4` |
| `ce-` | Contrast agent | `ce-gadolinium` |
| `rec-` | Reconstruction | `rec-magnitude` |
| `dir-` | Phase-encoding dir | `dir-AP` |
| `run-` | Run index | `run-01` |
| `mod-` | Modality label | `mod-T1w` |
| `echo-` | Echo index | `echo-1` |
| `part-` | Complex-data part | `part-mag`, `part-phase` |
| `hemi-` | Hemisphere | `hemi-L`, `hemi-R` |
| `space-` | Spatial reference | `space-MNI152NLin2009cAsym` |
| `atlas-` | Atlas | `atlas-HCP` |
| `res-` | Resolution index | `res-2` |
| `den-` | Surface density | `den-32k` |
| `label-` | Anatomical label | `label-GM` |
| `desc-` | Free-form descriptor | `desc-preproc`, `desc-brain`, `desc-confounds` |
| `from-` / `to-` / `mode-` | Transform meta | `from-T1w_to-MNI152NLin2009cAsym_mode-image` |
| `_suffix` | Modality/data type | `_bold`, `_T1w`, `_dseg`, `_probseg`, `_mask`, `_xfm`, `_timeseries`, `_boldref` |

Extensions:
- `.nii.gz` — volumes
- `.surf.gii` — surface meshes
- `.func.gii` / `.shape.gii` / `.label.gii` — data on surfaces
- `.dtseries.nii` / `.dscalar.nii` — CIFTI-2
- `.h5` — ANTs composite transforms
- `.txt` — ITK affine transforms (or `.mat`)
- `.tsv` + `.json` — tables + sidecars

Filename entity dictionary:
https://bids-specification.readthedocs.io/en/stable/appendices/entity-table.html

---

## Legacy layout (pre-21.0)

Enable with `--output-layout legacy`:

```
<output_dir>/
    fmriprep/               # fMRIPrep derivatives (as if `<output>/` in bids layout)
    freesurfer/             # FreeSurfer subjects (instead of sourcedata/freesurfer)
```

Identical contents to the bids layout — only the folder wrapping differs. Can
be reproduced from a bids-layout run by pointing subsequent tools to
`<output>/` and `<output>/sourcedata/freesurfer/` respectively.

The bids layout is preferred because the output directory is itself a valid
BIDS-Derivatives dataset (needed by BIDS-Derivatives-consuming tools like
XCP-D, fmripost-*, and Nilearn's dataset loaders).
