# Usage Examples

Copy-pasteable, real-world invocations. Every example assumes the current
25.2.x LTS release; replace the version tag as needed.

## Table of Contents
1. [Minimal single-subject (Docker wrapper)](#1-minimal-single-subject-docker-wrapper)
2. [Full-featured single-subject (bare Docker)](#2-full-featured-single-subject-bare-docker)
3. [Apptainer / Singularity on HPC](#3-apptainer--singularity-on-hpc)
4. [Batch: one job per subject with SLURM](#4-batch-one-job-per-subject-with-slurm)
5. [Anatomical only (fast prep for later runs)](#5-anatomical-only-fast-prep-for-later-runs)
6. [CIFTI / grayordinate output (HCP-style)](#6-cifti--grayordinate-output-hcp-style)
7. [Multi-echo BOLD](#7-multi-echo-bold)
8. [Fieldmap-less SDC (SyN)](#8-fieldmap-less-sdc-syn)
9. [Reuse existing FreeSurfer recon](#9-reuse-existing-freesurfer-recon)
10. [Reuse BIDS-Derivatives (partial reruns / meta-pipelines)](#10-reuse-bids-derivatives-partial-reruns--meta-pipelines)
11. [Longitudinal / multi-session with unbiased template](#11-longitudinal--multi-session-with-unbiased-template)
12. [Sessionwise processing (long developmental studies)](#12-sessionwise-processing-long-developmental-studies)
13. [Select specific task/session/echo/subjects](#13-select-specific-tasksessionechosubjects)
14. [Boilerplate-only run (methods paragraph)](#14-boilerplate-only-run-methods-paragraph)
15. [Reports-only re-run](#15-reports-only-re-run)
16. [Minimal-level output for large datasets](#16-minimal-level-output-for-large-datasets)
17. [Debug / crash-on-first-error](#17-debug--crash-on-first-error)
18. [Custom template via `--output-spaces`](#18-custom-template-via---output-spaces)
19. [Pediatric / Infant cohorts](#19-pediatric--infant-cohorts)
20. [Lesion cost-function masking (stroke / tumor)](#20-lesion-cost-function-masking-stroke--tumor)

---

## 1. Minimal single-subject (Docker wrapper)

```bash
export FS_LICENSE=$HOME/.licenses/freesurfer/license.txt

fmriprep-docker /data/bids /data/derivatives participant \
    --participant-label 01 \
    -w /data/work
```

Everything else takes defaults: `MNI152NLin2009cAsym:res-native`, full-level
outputs, auto CPU/thread selection, FS recon enabled.

---

## 2. Full-featured single-subject (bare Docker)

```bash
docker run --rm -it \
    -v /data/bids:/data:ro \
    -v /data/derivatives:/out \
    -v /data/work:/scratch \
    -v $HOME/.licenses/freesurfer/license.txt:/opt/freesurfer/license.txt:ro \
    -v $HOME/.cache/templateflow:/home/fmriprep/.cache/templateflow \
    --user "$(id -u):$(id -g)" \
    nipreps/fmriprep:25.2.5 \
    /data /out participant \
    --participant-label 01 \
    --output-spaces MNI152NLin2009cAsym:res-2 MNI152NLin6Asym:res-2 fsaverage:den-10k anat \
    --cifti-output 91k \
    --nthreads 16 --omp-nthreads 4 --mem 32000 \
    --use-syn-sdc warn \
    --fd-spike-threshold 0.5 --dvars-spike-threshold 1.5 \
    --write-graph --stop-on-first-crash \
    -w /scratch \
    --skip-bids-validation
```

Notes: `--user` avoids root-owned files on Linux. Add `--platform linux/amd64`
on Apple Silicon. `--skip-bids-validation` is fine only after you've validated
the dataset once with `bids-validator`.

---

## 3. Apptainer / Singularity on HPC

```bash
# One-time: build .sif on a network-connected node
apptainer build fmriprep-25.2.5.sif docker://nipreps/fmriprep:25.2.5

# One-time: pre-fetch TemplateFlow on a login node
python -m pip install --user templateflow
python -c "from templateflow.api import get; \
  get(['MNI152NLin2009cAsym','MNI152NLin6Asym','OASIS30ANTs','fsaverage','fsLR'])"
```

Then on a compute node:

```bash
apptainer run --cleanenv \
    -B /scratch/user/bids:/data:ro \
    -B /scratch/user/derivatives:/out \
    -B /scratch/user/work:/work \
    -B $HOME/.licenses/freesurfer/license.txt:/opt/freesurfer/license.txt:ro \
    -B $HOME/.cache/templateflow:/opt/templateflow \
    --env TEMPLATEFLOW_HOME=/opt/templateflow \
    /shared/containers/fmriprep-25.2.5.sif \
    /data /out participant \
    --participant-label 01 \
    --fs-license-file /opt/freesurfer/license.txt \
    --output-spaces MNI152NLin2009cAsym:res-2 fsaverage:den-10k \
    -w /work --nthreads 16 --omp-nthreads 4 --mem 32000
```

---

## 4. Batch: one job per subject with SLURM

This is the recommended parallelism pattern — one container per subject, each
with its own `-w`. Multiple concurrent subjects in ONE container instance
causes race conditions (see FAQ).

`sbatch_fmriprep.slurm`:

```bash
#!/bin/bash
#SBATCH --job-name=fmriprep
#SBATCH --output=logs/fmriprep-%A_%a.out
#SBATCH --error=logs/fmriprep-%A_%a.err
#SBATCH --time=24:00:00
#SBATCH --mem=32G
#SBATCH --cpus-per-task=16
#SBATCH --array=1-40                   # one array task per subject

set -euo pipefail

# List of subjects (no sub- prefix)
SUBJECTS=($(cat subject_list.txt))
SUBJECT=${SUBJECTS[$SLURM_ARRAY_TASK_ID-1]}

BIDS=/scratch/user/bids
OUT=/scratch/user/derivatives
WORK=/scratch/user/work/sub-${SUBJECT}
SIF=/shared/containers/fmriprep-25.2.5.sif
FS_LICENSE=$HOME/.licenses/freesurfer/license.txt

mkdir -p "$WORK"

apptainer run --cleanenv \
    -B "$BIDS":/data:ro \
    -B "$OUT":/out \
    -B "$WORK":/work \
    -B "$FS_LICENSE":/opt/freesurfer/license.txt:ro \
    -B $HOME/.cache/templateflow:/opt/templateflow \
    --env TEMPLATEFLOW_HOME=/opt/templateflow \
    "$SIF" \
    /data /out participant \
    --participant-label $SUBJECT \
    --fs-license-file /opt/freesurfer/license.txt \
    --output-spaces MNI152NLin2009cAsym:res-2 fsaverage:den-10k \
    -w /work \
    --nthreads ${SLURM_CPUS_PER_TASK} \
    --omp-nthreads 4 \
    --mem $((SLURM_MEM_PER_NODE - 2000))    # leave 2 GB headroom
```

Submit with `sbatch sbatch_fmriprep.slurm`.

A canonical SLURM template also ships in the repo at `docs/_static/sbatch.slurm`.

---

## 5. Anatomical only (fast prep for later runs)

```bash
fmriprep /data/bids /data/derivatives participant \
    --participant-label 01 \
    --anat-only \
    -w /data/work
```

Produces T1w-space brain mask, tissue seg, FreeSurfer recon, and MNI transforms
— everything you need to re-run BOLD later with `--derivatives fmriprep=/data/derivatives`.

---

## 6. CIFTI / grayordinate output (HCP-style)

```bash
fmriprep-docker /data/bids /data/derivatives participant \
    --participant-label 01 \
    --output-spaces MNI152NLin6Asym:res-2 fsLR fsaverage:den-10k \
    --cifti-output 91k \
    --project-goodvoxels \
    --medial-surface-nan \
    -w /data/work
```

- `--cifti-output 91k` implies `MNI152NLin6Asym` internally (2 mm subcortical grid + fsLR 32k cortical mesh).
- `--project-goodvoxels` masks voxels with locally high CoV during surface sampling.
- `--medial-surface-nan` sets medial-wall vertices to NaN.

Outputs include `sub-XX_task-XX_bold.dtseries.nii` (CIFTI-2 dense timeseries).

---

## 7. Multi-echo BOLD

If your BIDS dataset has `sub-XX_task-YY_echo-1_bold.nii.gz`, `echo-2_bold.nii.gz`,
etc. (≥3 echoes required as of 25.2.4):

```bash
fmriprep-docker /data/bids /data/derivatives participant \
    --participant-label 01 \
    --me-t2s-fit-method curvefit \
    --me-output-echos \
    --output-spaces MNI152NLin2009cAsym:res-2 \
    -w /data/work
```

Effect:
- `tedana` T2* map + optimally combined BOLD are produced automatically.
- `--me-output-echos` also saves per-echo STC/HMC/SDC-corrected series for
  downstream tedana denoising.
- `--echo-idx N` (rarely used) restricts to a single echo.

---

## 8. Fieldmap-less SDC (SyN)

When no fieldmap is available, ask fMRIPrep to compute SDC from the anatomical:

```bash
fmriprep-docker /data/bids /data/derivatives participant \
    --participant-label 01 \
    --use-syn-sdc error \
    -w /data/work
```

- `--use-syn-sdc error` (default when the flag is present without arg) — fail if SyN cannot run.
- `--use-syn-sdc warn` — proceed without SDC but log a warning.

To ADD SyN-SDC on top of existing fieldmaps (for comparison / robustness):

```bash
--force syn-sdc
```

---

## 9. Reuse existing FreeSurfer recon

If `recon-all` was already run (FreeSurfer 6.0.0+ required):

```bash
# Option A: put subjects at the default location
mkdir -p /data/derivatives/sourcedata/freesurfer
cp -r /existing/fs_subjects/sub-01 /data/derivatives/sourcedata/freesurfer/

fmriprep-docker /data/bids /data/derivatives participant \
    --participant-label 01 \
    -w /data/work

# Option B: point to an external subjects dir
fmriprep-docker /data/bids /data/derivatives participant \
    --participant-label 01 \
    --fs-subjects-dir /existing/fs_subjects \
    -w /data/work
```

fMRIPrep completes any missing `recon-all` steps and skips completed ones.

---

## 10. Reuse BIDS-Derivatives (partial reruns / meta-pipelines)

Since 23.2.0, `--derivatives` (or `-d`) lets fMRIPrep reuse any prior
BIDS-Derivatives-compliant output. Useful for:
- Running functional after a prior `--anat-only` run
- Substituting a custom brain mask/segmentation
- Splitting a huge dataset across multiple jobs

```bash
# Prior anat-only run at /data/derivatives_anat
# Now run BOLD reusing it:
fmriprep-docker /data/bids /data/derivatives_bold participant \
    --participant-label 01 \
    -d fmriprep=/data/derivatives_anat \
    -w /data/work_bold
```

Multiple `-d` entries are allowed. Names are conventional (`smriprep`,
`fmriprep`); the path is what matters.

---

## 11. Longitudinal / multi-session with unbiased template

For 2 sessions where a shared anatomical reference is desired:

```bash
fmriprep-docker /data/bids /data/derivatives participant \
    --participant-label 01 \
    --subject-anatomical-reference unbiased \
    --output-spaces MNI152NLin2009cAsym:res-2 anat \
    -w /data/work
```

`unbiased` builds a mid-point T1w template across sessions; equivalent to the
retired `--longitudinal` flag.

---

## 12. Sessionwise processing (long developmental studies)

When brain morphometry evolves session-to-session (infant, adolescent, elderly):

```bash
fmriprep-docker /data/bids /data/derivatives participant \
    --participant-label 01 \
    --subject-anatomical-reference sessionwise \
    -w /data/work
```

Each session gets its own anatomical reference and FreeSurfer subject.

---

## 13. Select specific task/session/echo/subjects

Restrict scope for testing or batching:

```bash
fmriprep-docker /data/bids /data/derivatives participant \
    --participant-label 01 02 05 \
    --session-label baseline followup \
    --task-id rest \
    --echo-idx 2 \
    -w /data/work
```

For anything finer — filtering on `acq-`, `run-`, `dir-`, `reconstruction-` —
use `--bids-filter-file`; see `references/bids-filter.md`.

---

## 14. Boilerplate-only run (methods paragraph)

Emit the auto-generated methods text without running any workflow steps:

```bash
fmriprep /data/bids /data/derivatives participant \
    --participant-label 01 \
    --boilerplate-only
```

Result lands in `output_dir/logs/CITATION.{md,html,tex}`.

---

## 15. Reports-only re-run

After a completed (or partial) run, regenerate the HTML report without redoing
computation. Requires the same `-w` from the original run.

```bash
fmriprep /data/bids /data/derivatives participant \
    --participant-label 01 \
    --reports-only \
    -w /data/work
```

---

## 16. Minimal-level output for large datasets

Save disk by generating only essentials (transforms + reports).

```bash
fmriprep-docker /data/bids /data/derivatives participant \
    --participant-label 01 \
    --level minimal \
    -w /data/work
```

Then later resample where needed with `--level resampling` or `--level full`
plus `-d fmriprep=/data/derivatives`.

---

## 17. Debug / crash-on-first-error

For CI or triage:

```bash
fmriprep-docker /data/bids /data/derivatives participant \
    --participant-label 01 \
    --stop-on-first-crash \
    -vvv \
    --debug all \
    --resource-monitor \
    -w /data/work
```

`--debug pdb` drops into pdb on the first crash (only useful bare-metal or with
an interactive container).

---

## 18. Custom template via `--output-spaces`

Put your template folder in `$TEMPLATEFLOW_HOME`:

```
$TEMPLATEFLOW_HOME/tpl-MyCustom/
    template_description.json
    tpl-MyCustom_res-1_T1w.nii.gz
    tpl-MyCustom_res-1_desc-brain_mask.nii.gz
```

Then reference it:

```bash
fmriprep-docker /data/bids /data/derivatives participant \
    --output-spaces MyCustom:res-1 \
    -w /data/work
```

With the wrapper you can also pass a filesystem path (the wrapper bind-mounts
it into the TemplateFlow cache):

```bash
fmriprep-docker /data/bids /data/derivatives participant \
    --output-spaces /path/to/tpl-MyCustom:res-1 \
    -w /data/work
```

---

## 19. Pediatric / Infant cohorts

Use a cohort-aware template:

```bash
# Prepubertal children (4.5–8.5 y)
--output-spaces MNIPediatricAsym:cohort-2:res-1

# Infant
--output-spaces MNIInfant:cohort-1:res-2
```

Full cohort tables: https://github.com/templateflow/tpl-MNIPediatricAsym /
https://github.com/templateflow/tpl-MNIInfant

Cohorts are combinatorial: `--output-spaces MNIPediatricAsym:cohort-1:cohort-2:res-native:res-1`
produces four variants (2 cohorts × 2 resolutions).

---

## 20. Lesion cost-function masking (stroke / tumor)

1. Place a binary mask in `sub-XX/anat/sub-XX_label-lesion_roi.nii.gz`
   (1 = lesion, 0 = healthy, same grid as T1w).
2. Add `*lesion_roi.nii.gz` to `.bidsignore` in the dataset root
   (until BIDS accepts the entity natively).
3. Run fMRIPrep normally — spatial normalization automatically uses the mask
   to avoid warping healthy tissue into the lesion.

```bash
fmriprep-docker /data/bids /data/derivatives participant \
    --participant-label 01 \
    -w /data/work
```

The BIDS-Derivatives-recommended location (`manual_masks/sub-01/anat/sub-01_desc-tumor_mask.nii.gz`)
will be honored in an upcoming version.
