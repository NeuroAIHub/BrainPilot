---
name: "fmriprep"
description: "Preprocess task-based or resting-state fMRI data with fMRIPrep — a robust, BIDS-App preprocessing pipeline built on FSL, ANTs, FreeSurfer, AFNI, and Nilearn. Use this skill whenever the user asks to preprocess fMRI/BOLD data, run fMRIPrep on a BIDS dataset, set up Docker/Singularity/Apptainer containers for fMRIPrep, choose output spaces (MNI152NLin2009cAsym, fsaverage, fsLR/CIFTI), configure susceptibility distortion correction (SDC), extract or interpret the confounds table, resample to surface/grayordinates, cite fMRIPrep and its dependencies, or debug fMRIPrep crashes and hangs."
domain: "fmri-neuroimaging"
version: "1.0.0"
authors:
  - "Claude (AI-assisted)"
review_status: "ai-generated"
---

# fMRIPrep: Robust fMRI Preprocessing Pipeline

## Purpose

This skill encodes complete operational knowledge of **fMRIPrep** — the NiPreps
BIDS-App for preprocessing task and resting-state fMRI. It covers installation
(Docker/Apptainer/pip), the full CLI, workflow internals, output layout, the
confounds table, output spaces / TemplateFlow, susceptibility distortion
correction, BIDS filters, troubleshooting, and how to cite. It is derived from
the fMRIPrep 25.2.x (LTS) source tree (https://github.com/nipreps/fmriprep).

## When to Use This Skill

Activate when the user:

- Wants to run fMRIPrep on a BIDS dataset (Docker, Singularity/Apptainer, pip)
- Asks how to install fMRIPrep or set up dependencies (FreeSurfer license, TemplateFlow)
- Needs help choosing `--output-spaces`, `--cifti-output`, or surface targets (fsaverage, fsLR)
- Needs help with SDC / fieldmap issues (`--use-syn-sdc`, `--force syn-sdc`, `IntendedFor`, `B0FieldIdentifier`)
- Asks about the confounds file (`~_desc-confounds_timeseries.tsv`), aCompCor/tCompCor, motion parameters
- Debugs a crashing/hanging fMRIPrep run, FreeSurfer `IsRunning` errors, or race conditions
- Wants to reuse pre-computed derivatives (`--derivatives`), an existing FreeSurfer subject dir, or a partial run
- Needs a BIDS filter file (`--bids-filter-file`) or wants to select tasks/sessions/echoes
- Needs a citation/boilerplate for a paper or grant proposal
- Wants to interpret the HTML visual report

## Reference Files (Progressive Disclosure)

| Topic | File | When to Read |
|-------|------|--------------|
| Installation (Docker, Apptainer, pip, wrapper, FreeSurfer license) | `references/installation.md` | User asks how to install/set up fMRIPrep, or hits license/permission errors |
| Complete CLI reference (every flag, defaults, choices) | `references/cli-reference.md` | User asks "what does flag X do?" or needs the full option table |
| Practical invocation examples (single subject, batch, HPC SLURM, Docker) | `references/usage-examples.md` | User asks "how do I actually run it on my data?" |
| Workflow internals (anat + BOLD stages, HMC, BBR, SDC, surface, CIFTI) | `references/workflows.md` | User asks what fMRIPrep does under the hood, or wants a step-by-step methods section |
| Output layout and derivatives naming | `references/outputs.md` | User asks what files fMRIPrep produces, or how to find a specific derivative |
| Confounds table (aCompCor, tCompCor, motion, FD, DVARS, spike regressors) | `references/confounds.md` | User asks which columns of the confounds TSV to use for denoising |
| Output spaces / TemplateFlow (MNI152NLin2009cAsym, fsLR, fsaverage, custom) | `references/spaces.md` | User asks how to specify `--output-spaces`, use custom templates, or pre-fetch templates |
| Susceptibility distortion correction (fieldmaps, PEPOLAR, phase-diff, SyN) | `references/sdc-fieldmaps.md` | User has fieldmaps, wants fieldmap-less SDC, or SDC-related errors |
| BIDS filter file syntax + PyBIDS queries | `references/bids-filter.md` | User needs to select specific sessions/tasks or non-BIDS entities |
| FAQ, troubleshooting, hangs, HPC, TemplateFlow offline | `references/troubleshooting-faq.md` | User's run is crashing/hanging or they're on an HPC without Internet |
| Citation boilerplate, DOIs, BibTeX, dependency papers | `references/citation.md` | User writes a paper or grant that uses fMRIPrep |
| Pinned dependency versions (25.2.x LTS) | `references/versions-dependencies.md` | User asks which version of FreeSurfer/ANTs/FSL/AFNI ships with fMRIPrep |

## What fMRIPrep Is

fMRIPrep is a **BIDS-App**: a container that consumes a `BIDS`-organized
dataset and emits a BIDS-Derivatives dataset plus a per-subject HTML report.
It performs *minimal preprocessing* — motion correction, field unwarping,
normalization, bias-field correction, brain extraction, coregistration, and
optional surface resampling — and deliberately **does not smooth or denoise**.
Downstream denoising is enabled by the confounds table.

- **Homepage**: https://fmriprep.org
- **Repo**: https://github.com/nipreps/fmriprep
- **Container image**: `nipreps/fmriprep:<version>` on Docker Hub
- **Latest release** (of this snapshot): **25.2.5** (2026-03-10) — 25.2.x is the **LTS** track, supported through **October 2029**
- **License**: Apache-2.0 (since 21.0.x)
- **RRID**: SCR_016216

## Command-Line Structure (BIDS-App)

```
fmriprep <bids_dir> <output_dir> <analysis_level> [OPTIONS]
```

- `bids_dir` — root of the BIDS dataset (contains `sub-*/` folders and `dataset_description.json`)
- `output_dir` — where derivatives + reports go (must NOT be inside `bids_dir`)
- `analysis_level` — only `participant` is supported

Same structure applies to the container form:

```
docker run --rm -it <mounts> nipreps/fmriprep:<version> <bids_dir> <output_dir> participant [OPTIONS]
```

## Pipeline Overview

```
                       ┌──────────────────────────────────────┐
                       │  BIDS Dataset (T1w/T2w + BOLD + fmap)│
                       └──────────────────┬───────────────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
        ┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
        │  Anatomical WF    │   │  Fieldmap WF      │   │  BOLD WF (per run)│
        │  (smriprep)       │   │  (SDCFlows)       │   │  (fmriprep)       │
        │  ───────────────  │   │  ───────────────  │   │  ─────────────    │
        │  • Conform T1w    │   │  • PEPOLAR/TOPUP  │   │  • Reference img  │
        │  • N4 bias corr   │   │  • Phase-diff     │   │  • HMC (mcflirt)  │
        │  • Skull-strip    │   │  • Phase encoding │   │  • STC (3dTShift) │
        │    (antsBrainExt) │   │  • SyN-SDC (t1w)  │   │  • SDC apply      │
        │  • FAST segment   │   │                   │   │  • BBR to T1w     │
        │  • antsRegistrat  │   │                   │   │  • Multi-echo T2* │
        │    → MNI templates│   │                   │   │  • Resample to    │
        │  • recon-all      │   │                   │   │    output spaces  │
        │  • MSM-Sulc       │   │                   │   │  • Surface + CIFTI│
        │  • Curv/Sulc/Thick│   │                   │   │  • Confounds      │
        └─────────┬─────────┘   └──────────┬────────┘   └──────────┬────────┘
                  │                        │                       │
                  └────────────────────────┴───────────────────────┘
                                          │
                                          ▼
                     ┌────────────────────────────────────────┐
                     │  BIDS-Derivatives + sub-XX.html report │
                     └────────────────────────────────────────┘
```

Read `references/workflows.md` for the full method description and node names.

## Quick Start

The **fastest path** for a new user with Docker:

```bash
# 1. Install the wrapper (Python 3.10+)
python -m pip install --user fmriprep-docker

# 2. Get a FreeSurfer license (free): https://surfer.nmr.mgh.harvard.edu/registration.html
#    Save the file, e.g. as ~/.licenses/freesurfer/license.txt
export FS_LICENSE=$HOME/.licenses/freesurfer/license.txt

# 3. Pre-fetch TemplateFlow templates (avoids network needs mid-run)
python -m pip install --user templateflow
python -c "from templateflow.api import get; \
  get(['MNI152NLin2009cAsym','MNI152NLin6Asym','OASIS30ANTs','fsaverage','fsLR'])"

# 4. Run — replace paths with yours
fmriprep-docker /path/to/bids /path/to/derivatives participant \
    --participant-label 01 \
    --output-spaces MNI152NLin2009cAsym:res-2 fsaverage:den-10k \
    --nthreads 8 --omp-nthreads 4 --mem 12000 \
    -w /path/to/work
```

Equivalent bare Docker invocation (what the wrapper produces):

```bash
docker run --rm -it \
    -v /path/to/bids:/data:ro \
    -v /path/to/derivatives:/out \
    -v /path/to/work:/scratch \
    -v $FS_LICENSE:/opt/freesurfer/license.txt:ro \
    -v $HOME/.cache/templateflow:/home/fmriprep/.cache/templateflow \
    nipreps/fmriprep:25.2.5 \
    /data /out participant \
    --participant-label 01 \
    --output-spaces MNI152NLin2009cAsym:res-2 fsaverage:den-10k \
    --nthreads 8 --omp-nthreads 4 --mem 12000 \
    -w /scratch
```

Equivalent Apptainer/Singularity invocation:

```bash
apptainer run --cleanenv \
    -B /path/to/bids:/data:ro \
    -B /path/to/derivatives:/out \
    -B /path/to/work:/work \
    -B $FS_LICENSE:/opt/freesurfer/license.txt:ro \
    -B $HOME/.cache/templateflow:/opt/templateflow \
    --env TEMPLATEFLOW_HOME=/opt/templateflow \
    fmriprep-25.2.5.sif \
    /data /out participant \
    --participant-label 01 \
    --fs-license-file /opt/freesurfer/license.txt \
    -w /work
```

## Key Concepts (cheat-sheet)

| Concept | Meaning |
|---------|---------|
| **BIDS-App** | Container/exec with fixed 3-positional CLI (`bids_dir output_dir participant`). fMRIPrep only supports `participant`. |
| **BIDS Derivatives** | Output format — sub-folders per subject, sidecar JSON per NIfTI, standardized entity keys (`space-`, `desc-`, `hemi-`, `from-`, `to-`). |
| **NiPreps** | The umbrella (www.nipreps.org). fMRIPrep depends on sister packages: `smriprep` (anat), `sdcflows` (SDC), `niworkflows` (utilities), `nireports` (reports), `templateflow` (templates). |
| **TemplateFlow** | Registry of standard neuroimaging templates fetched on demand. Home dir: `$TEMPLATEFLOW_HOME` (default `~/.cache/templateflow`). |
| **Working directory** (`-w`) | Nipype's scratch space. Enables resume-on-crash. Not inside `bids_dir`. |
| **`--output-spaces`** | Which coordinate systems to resample BOLD/T1w to. Space `KEY[:cohort-X][:res-Y][:den-Z]`. Default: `MNI152NLin2009cAsym:res-native`. Read `references/spaces.md`. |
| **`--level`** | `minimal` (transforms only), `resampling` (adds mid-way NIfTIs), `full` (default — every derivative). |
| **`--ignore`** | Skip preprocessing aspects. Choices: `fieldmaps`, `slicetiming`, `sbref`, `t2w`, `flair`, `fmap-jacobian`. |
| **`--force`** | Override auto-choices. Choices: `bbr`, `no-bbr`, `syn-sdc`, `fmap-jacobian`. |
| **`--derivatives`** | Reuse precomputed derivatives from another package (BIDS-Derivatives-compliant); replaces the older `--anat-derivatives`. |
| **`--use-syn-sdc`** | Fieldmap-less SDC using anatomical prior; if no fmap and unable → `error` (default) or `warn`. |
| **`--cifti-output`** | Enable grayordinate output. Choices: `91k` (2 mm, 91282 grayordinates), `170k` (1.6 mm, 170494). Implies `MNI152NLin6Asym`. |
| **`--fs-no-reconall`** | Skip FreeSurfer surface reconstruction. Disables surface/CIFTI outputs. |
| **`--fs-license-file`** | Path to your FreeSurfer license (required even if `recon-all` is not run — some FS binaries need it). |
| **Confounds** | Nuisance regressors written to `~_desc-confounds_timeseries.tsv`. Read `references/confounds.md` before including in a design matrix. |
| **HMC** | Head-Motion Correction (FSL `mcflirt`). Reference-image based. |
| **STC** | Slice-Timing Correction (AFNI `3dTShift`). Runs only if `SliceTiming` present in metadata and ≥5 usable volumes. |
| **BBR** | Boundary-Based Registration (FreeSurfer `bbregister` when recon-all is on, else FSL `flirt --schedule=bbr.sch`). |
| **CompCor** | Component-based noise correction. Anatomical (aCompCor) uses eroded WM/CSF/combined masks; temporal (tCompCor) uses top-variance voxels. |
| **Boilerplate** | Auto-generated methods paragraph in the report — copy verbatim into papers (public-domain, CC0). |

## Sensible Defaults

fMRIPrep is designed so a bare invocation "just works". If you have no strong
preferences, this is the recommended starting point:

- `--output-spaces MNI152NLin2009cAsym:res-2 fsaverage:den-10k anat` — one volumetric standard space, a light surface space, and native anatomical
- `--nthreads = number of CPU cores allocated to the container`
- `--omp-nthreads ≤ nthreads` (typically `nthreads / 2` when running multiple subjects; single subject: 8 is a common cap)
- `--mem-mb` at least 8000 (Docker wrapper warns below 8 GB); 16 GB is comfortable
- Keep the FS license mounted; keep `TEMPLATEFLOW_HOME` mounted; keep `-w` on a **fast local disk** (not NFS if avoidable)
- Process **one subject per container instance** (see FAQ)

## Common Pitfalls

1. **Output dir == input dir**: fMRIPrep will refuse to run. Put derivatives in a separate path (e.g. `bids/derivatives/fmriprep-25.2.5/`).
2. **Working directory inside `bids_dir`**: also refused. Put `-w /scratch/work` outside the input.
3. **`--output-spaces MNI152NLin6Asym:res-2` ≠ 2 mm always** — `res-` is a TemplateFlow *index*, not millimeters. Verify with the template JSON.
4. **Race conditions on parallel subjects**: never share the same `-w` across subjects. Give each subject its own working directory, or launch each subject in its own container.
5. **FreeSurfer `IsRunning.lh+rh` error** after a crash: delete `IsRunning.*` files in `<output>/sourcedata/freesurfer/sub-XX/scripts/` and re-run.
6. **Slice-timing correction is referenced to the middle slice by default** (`--slice-time-ref 0.5`), which shifts effective volume onsets by 0.5 TR — adjust your GLM accordingly, or set `--slice-time-ref 0` to disable the shift.
7. **Never include all confounds columns** in a design matrix — pick a strategy (24P+aCompCor, ICA-AROMA, scrubbing) and use the corresponding subset.
8. **No skull-stripped T1w inputs** — fMRIPrep expects raw T1w. If skull-stripped, use `--skull-strip-t1w skip` (understand the risks) or revert to originals.
9. **Version pinning**: process an entire study with the *same* fMRIPrep version+container build. Do not upgrade mid-study.
10. **Datasets with lesions**: place `sub-XX/anat/sub-XX_label-lesion_roi.nii.gz` and add `*lesion_roi.nii.gz` to `.bidsignore` — enables lesion cost-function masking during registration.
11. **Apple Silicon Docker**: run under `--platform linux/amd64` (or `DOCKER_DEFAULT_PLATFORM=linux/amd64` when using `fmriprep-docker`); the container is only built for `linux-64`.
12. **Multi-echo two-echo data**: rejected since 25.2.4 — fMRIPrep requires ≥3 echoes for tedana T2* estimation.
13. **`--use-syn-sdc` requires anatomical space templates** to be present locally (`MNI152NLin2009cAsym`); pre-fetch or allow Internet.
14. **HPC + Singularity**: the FS license *and* a writeable `TEMPLATEFLOW_HOME` must be bind-mounted; login-node fetches templates before batch submission (compute nodes are usually offline).

## What This Skill Does Not Cover

- **Group-level statistics** — fMRIPrep is participant-level only. Use FitLins, Nilearn, SPM, FSL FEAT, etc. downstream.
- **Denoising strategy selection** — see [Ciric 2017](https://doi.org/10.1016/j.neuroimage.2017.03.020) and [Parkes 2018](https://doi.org/10.1016/j.neuroimage.2017.12.073); fMRIPrep only supplies regressors.
- **DWI, MEG, EEG** — different NiPreps apps (`dMRIPrep`, `MEGPrep`, planned).
- **Custom Nipype workflow edits** — for extension, read the API docs at https://fmriprep.readthedocs.io/en/latest/api.html.

## Where to Get Help

- Community Q&A: https://neurostars.org/tag/fmriprep (canonical support channel)
- Bug reports: https://github.com/nipreps/fmriprep/issues
- Full docs: https://fmriprep.org / https://fmriprep.readthedocs.io
- Sample HTML report: https://fmriprep.org/en/latest/_static/SampleReport/sample_report.html

## Verify Installation

```bash
fmriprep --version                    # bare-metal
docker run --rm nipreps/fmriprep:25.2.5 --version   # Docker
apptainer run fmriprep-25.2.5.sif --version         # Apptainer
```

Expected output form: `fMRIPrep vXX.Y.Z`.
