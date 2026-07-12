# Version & Dependency Reference

Verified against the 25.2.x LTS source tree (`pyproject.toml`, `Dockerfile`,
`Dockerfile.base`, `.versions.json`, `pixi.lock`).

## Table of Contents
1. [Current release status](#current-release-status)
2. [Neuroimaging binary dependencies (container pins)](#neuroimaging-binary-dependencies-container-pins)
3. [Python runtime dependencies](#python-runtime-dependencies)
4. [Optional Python dependencies (pip extras)](#optional-python-dependencies-pip-extras)
5. [Base OS + toolchain](#base-os--toolchain)
6. [Container base image](#container-base-image)
7. [Flagged / broken versions to AVOID](#flagged--broken-versions-to-avoid)
8. [Release cadence & LTS policy](#release-cadence--lts-policy)

---

## Current release status

- **Latest release (this snapshot)**: **25.2.5** (2026-03-10)
- **Support track**: **25.2.x — LTS** through **October 2029** (announced with 25.2.0 on 2025-10-01).
- **License**: Apache-2.0 (since 21.0.x pre-release; pre-21.0 was BSD-3-Clause).
- **RRID**: SCR_016216
- **Python required**: 3.10 – 3.13 (container uses **3.12**)
- **Version scheme**: `nipreps-calver` (calendar-based; `YY.M.PATCH`).
- **Repo**: https://github.com/nipreps/fmriprep

Recent releases (from `CHANGES.rst`):

| Version | Date | Type |
|---------|------|------|
| 25.2.5 | 2026-03-10 | Bug-fix (restores `--no-track-sessions` compatibility) |
| 25.2.4 | 2026-01-14 | Bug-fix (multi-echo + multi-session fixes; rejects 2-echo data) |
| 25.2.3 | 2025-10-17 | Bug-fix (PyBIDS/universal-pathlib compat) |
| 25.2.2 | 2025-10-06 | Bug-fix (Perl install in container) |
| 25.2.1 | 2025-10-03 | Bug-fix (multi-anat session summary) |
| 25.2.0 | 2025-10-01 | **LTS entry release**; per-session processing; grid-constant interpolation default |
| 25.1.x | 2025 | Prior stable series |
| 24.1.x | 2024 | Prior LTS series (support ended) |
| 23.2.0 | ~2024 | Introduced `--level` and `--derivatives` |
| 21.0.x | 2022 | Switch to Apache-2.0; BIDS-Derivatives output layout default; dropped ICA-AROMA |

---

## Neuroimaging binary dependencies (container pins)

The container is the authoritative reference; bare-metal users should try to
match these pins.

| Tool | Version (25.2.x container) | Purpose |
|------|-----------------------------|---------|
| **FreeSurfer** | **7.3.2** | Surface reconstruction, `bbregister`, `mri_robust_template`, `aseg`, etc. |
| **FSL** | **6.0.7.7** (via `fsl-{bet2 2111.8.*, flirt 2111.4.*, fast4 2111.3.*, fugue 2201.5.*, mcflirt 2111.0.*, miscmaths 2412.4.*, topup 2203.5.*}` conda packages from fslconda) | HMC (mcflirt), tissue seg (FAST), fieldmap unwarping (fugue/topup), BBR fallback (flirt) |
| **ANTs** | **2.5.1** documented; container installs **2.6.* via conda** | Registration, N4 bias correction, `antsBrainExtraction.sh` |
| **AFNI** | **25.2.09** (only `3dvolreg`, `3dTshift`, `3dUnifize`, `3dAutomask` shipped) | Slice-timing (3dTShift) and reference-image tools |
| **Connectome Workbench (`wb_command`)** | **≥1.5.0** documented; container uses **2.0.\* qt6\*** | CIFTI I/O, surface resampling to fsLR |
| **MSM (HOCR)** | Nov 19, 2019 release | Multimodal Surface Matching for fsLR alignment |
| **bids-validator** | **1.14.10** | Input dataset validation |
| **Python** | **3.12.\*** | Runtime |
| **Node.js** | **20.\*** | Required by bids-validator + svgo |
| **svgo** | **≥3.2.0** | Report SVG optimization |
| **pandoc** | **3.7.\*** | Citation boilerplate rendering |
| **graphviz** | **12.2.\*** | Workflow graph rendering (`--write-graph`) |
| **MKL** | **2024.2.2.\*** + mkl-service 2.4.2.\* | Numerical linear algebra |

Scientific Python stack pins (container):

- `numpy 2.2.*` (dependency overrides to ≥2.2)
- `scipy 1.15.*`
- `matplotlib 3.10.*`
- `pandas 2.2.*`
- `h5py 3.13.*`
- `nitime 0.11.*`
- `scikit-image 0.25.*`
- `scikit-learn 1.6.*`

---

## Python runtime dependencies

From `pyproject.toml` — required to install fMRIPrep:

| Package | Minimum version |
|---------|-----------------|
| `acres` | ≥0.2.0 |
| `looseversion` | ≥1.3 |
| `nibabel` | ≥5.1.1 |
| `nipype` | ≥1.9.0 |
| `nireports` | ≥24.1.0 |
| `nitime` | ≥0.9 |
| `nitransforms` | ≥25.0.1 |
| `niworkflows` | ≥1.14.4 |
| `numpy` | ≥2.0 |
| `packaging` | ≥24 |
| `pandas` | ≥2.2 |
| `psutil` | ≥5.4 |
| `pybids` | ≥0.16 |
| `requests` | ≥2.27 |
| `sdcflows` | ≥2.15.0 |
| `smriprep` | ≥0.19.2 |
| `tedana` | ≥25.1.0 |
| `templateflow` | ≥24.2.2 |
| `transforms3d` | ≥0.4.2 |
| `toml` | ≥0.10 |
| `codecarbon` | ≥2 |
| `APScheduler` | ≥3.10 |

### NiPreps sibling packages (developed together)

| Package | Role | Repo |
|---------|------|------|
| `niworkflows` | Shared Nipype interfaces and utility workflows | https://github.com/nipreps/niworkflows |
| `smriprep` | Anatomical (T1w/T2w) preprocessing sub-workflow | https://github.com/nipreps/smriprep |
| `sdcflows` | Susceptibility-distortion correction | https://github.com/nipreps/sdcflows |
| `nireports` | HTML report generation + reportlets | https://github.com/nipreps/nireports |
| `nitransforms` | ITK/ANTs/FreeSurfer transform I/O and application | https://github.com/nipreps/nitransforms |
| `templateflow` | Template registry / fetcher | https://github.com/templateflow/templateflow |
| `tedana` | Multi-echo T2* fitting + denoising | https://github.com/ME-ICA/tedana |

Updating any of these can change fMRIPrep behavior — pin all NiPreps
dependencies to the versions the fMRIPrep release constraints (or use the
container).

---

## Optional Python dependencies (pip extras)

Install with `pip install "fmriprep[<extra>]"`:

| Extra | Adds | Use |
|-------|------|-----|
| `doc` / `docs` | `pydot`, `sphinx≥5`, `sphinx-argparse`, `sphinx_rtd_theme` | Building the docs |
| `dev` | `ruff`, `pre-commit` | Development |
| `test` / `tests` | `coverage`, `pytest≥8.1`, `pytest-cov`, `pytest-env`, `pytest-xdist` | Test suite |
| `duecredit` | `duecredit` | Citation tracking |
| `resmon` | (marker) | Resource-monitor extras |
| `container` | `datalad`, `datalad-osf` (+ `[telemetry]`) | Extras bundled in container |
| `telemetry` | `migas≥0.4.0`, `sentry-sdk≥1.3` | Crash reporting |
| `maint` | `fuzzywuzzy`, `python-Levenshtein` | Maintenance tools |
| `all` | `[doc,maint,telemetry,test]` | Everything |

---

## Base OS + toolchain

- **Base OS**: Ubuntu 22.04 LTS (`ubuntu:jammy-20250730`)
- **Container backend**: `ghcr.io/prefix-dev/pixi:0.53.0` for dependency resolution
- **Environment manager**: `pixi` with conda-forge + fslconda channels
- **Base image build date** (BASE_IMAGE tag): `ghcr.io/nipreps/fmriprep-base:20251006`
- **Templates**: pre-populated `TEMPLATEFLOW_HOME=/templateflow` (see `scripts/fetch_templates.py`)

Key env vars set inside the container:
- `PATH="/app/.pixi/envs/fmriprep/bin:$PATH"`
- `FSLDIR="/app/.pixi/envs/fmriprep"`
- `FSLOUTPUTTYPE="NIFTI_GZ"`
- `FREESURFER_HOME="/opt/freesurfer"`
- `SUBJECTS_DIR="$FREESURFER_HOME/subjects"`
- `MKL_NUM_THREADS=1`, `OMP_NUM_THREADS=1` (Nipype handles parallelism)
- `IS_DOCKER_8395080871=1` (marker for detecting containerized execution)
- `PYTHONNOUSERSITE=1`
- `ENTRYPOINT ["/app/.pixi/envs/fmriprep/bin/fmriprep"]`

---

## Container base image

- **Registry**: `nipreps/fmriprep` on Docker Hub
- **Tags**: `nipreps/fmriprep:25.2.5`, `nipreps/fmriprep:latest`, plus historical release tags
- **Signed & CI-built**: via GitHub Actions from tagged releases
- **Base image**: `ghcr.io/nipreps/fmriprep-base:<date>` (rebuilt when neuroimaging deps change)
- **Includes** at container build time:
  - FreeSurfer 7.3.2 (excludes non-x86 subdirs via `docker/files/freesurfer7.3.2-exclude.txt`)
  - MSM HOCR (Nov 2019 GitHub release)
  - AFNI binaries copied from `afni/afni_make_build:AFNI_25.2.09`

Image extraction reference:

```bash
docker create --name tmp nipreps/fmriprep:25.2.5
docker cp tmp:/opt/freesurfer/VERSION -   # confirm FS version
docker rm tmp
```

Or peek inside:

```bash
docker run --rm --entrypoint bash nipreps/fmriprep:25.2.5 -c \
    'cat /opt/freesurfer/VERSION; flirt -version; antsRegistration --version; wb_command -version'
```

---

## Flagged / broken versions to AVOID

The following versions have known severe bugs (from `.versions.json`). Do NOT
publish results processed with them; upgrade to a non-flagged patch.

| Version range | Bug |
|---------------|-----|
| 1.0.0 | Deprecated / too old |
| 1.0.1 – 20.0.5 (many) | Phase-difference fieldmap bug (some also had Nipype instability at 1.5.x) |
| 20.0.0rc1 – 20.0.2 | fsLR resampling error when `--cifti-output` was used |
| 20.1.0 – 20.2.1 | Functional outputs in standard space can be wrong depending on orientation headers (see [issue #2307](https://github.com/nipreps/fmriprep/issues/2307)) |

Live authoritative list:
https://github.com/nipreps/fmriprep/blob/master/.versions.json

fMRIPrep prints a warning at run start if the running version is flagged.

---

## Release cadence & LTS policy

- **Major/minor releases** on the NiPreps calendar (CalVer `YY.M`), roughly
  a few per year.
- **Patch releases** for bug fixes, targeted at each active minor.
- **LTS releases** (announced explicitly) get **4 years** of bug-fix support.
  - Current LTS: **25.2.x** (through Oct 2029).
  - Previous LTS: 24.1.x (support ended per 25.2.x announcement).

**For a study**: pick an LTS at the start; do not upgrade mid-study.

**For method comparison studies**: pin the exact container tag *and* the
`TEMPLATEFLOW_HOME` snapshot — even minor template updates can change results
subtly.

Release notes for every version live in `CHANGES.rst` in the repo and on
https://fmriprep.readthedocs.io/en/latest/changes.html.
