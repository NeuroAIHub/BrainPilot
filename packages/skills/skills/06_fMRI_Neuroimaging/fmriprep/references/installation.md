# Installation Reference

## Table of Contents
1. [Container installations (recommended)](#container-installations-recommended)
   - 1.1 [Docker](#11-docker)
   - 1.2 [`fmriprep-docker` wrapper](#12-fmriprep-docker-wrapper)
   - 1.3 [Apptainer / Singularity](#13-apptainer--singularity)
2. [Bare-metal (pip) installation](#bare-metal-pip-installation)
3. [External binary dependencies (bare-metal only)](#external-binary-dependencies-bare-metal-only)
4. [FreeSurfer license](#freesurfer-license)
5. [TemplateFlow setup](#templateflow-setup)
6. [Environment variables](#environment-variables)
7. [Verifying the installation](#verifying-the-installation)

---

## Container installations (recommended)

fMRIPrep is a **BIDS-App**. Containers are the officially supported deployment
path — they package every neuroimaging binary (FreeSurfer, FSL, ANTs, AFNI,
Connectome-Workbench, MSM) at exact tested versions, avoiding the pain of a
manual environment.

### 1.1 Docker

Pull an official image from Docker Hub:

```bash
docker pull nipreps/fmriprep:25.2.5      # replace with the desired version
docker pull nipreps/fmriprep:latest      # bleeding edge (not recommended for research)
```

Image sizes are ~10 GB compressed / ~25 GB extracted.

Minimal bare-Docker invocation:

```bash
docker run --rm -it \
    -v /path/to/bids:/data:ro \
    -v /path/to/derivatives:/out \
    -v /path/to/work:/scratch \
    -v /path/to/freesurfer/license.txt:/opt/freesurfer/license.txt:ro \
    nipreps/fmriprep:25.2.5 \
    /data /out participant \
    -w /scratch
```

Docker Hub tags: https://hub.docker.com/r/nipreps/fmriprep/tags/

### 1.2 `fmriprep-docker` wrapper

A Python wrapper that constructs the `docker run` command for you. It shares
the CLI of `fmriprep` (paths are automatically bind-mounted).

Install:

```bash
python -m pip install --user fmriprep-docker
```

Use exactly like `fmriprep`:

```bash
fmriprep-docker /path/to/bids /path/to/derivatives participant \
    --fs-license-file $HOME/.licenses/freesurfer/license.txt \
    --output-spaces MNI152NLin2009cAsym:res-2 fsaverage \
    -w /path/to/work
```

Wrapper-specific options (translate to `docker run` flags):

| Wrapper flag | Purpose |
|--------------|---------|
| `-i / --image IMG` | Pick a specific image (default: `nipreps/fmriprep:<wrapper_version>`) |
| `-e / --env VAR val` | Inject an env var (repeatable) |
| `-u / --user UID[:GID]` | Run container as another user |
| `--network none` | Simulate offline mode |
| `--shell` | Drop into a bash shell inside the container |
| `--patch PACKAGE=PATH` | Bind-mount a dev checkout over the installed package |
| `--no-tty` | Omit `-it` (useful for CI / batch) |
| `--config PATH` | Custom `nipype.cfg` |

The wrapper auto-detects `$FS_LICENSE` and bind-mounts it. It also warns if
Docker has <8 GB of RAM available.

The wrapper source lives at `wrapper/src/fmriprep_docker/__main__.py`; expected
Docker image path convention: `/app/.pixi/envs/fmriprep/lib/python3.12/site-packages`.

### 1.3 Apptainer / Singularity

Build an image from Docker Hub (typical HPC workflow):

```bash
# On a machine with internet + apptainer/singularity
apptainer build fmriprep-25.2.5.sif docker://nipreps/fmriprep:25.2.5
```

Run:

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
    --fs-license-file /opt/freesurfer/license.txt \
    -w /work --nthreads 8 --omp-nthreads 4 --mem 16000
```

Notes:
- `--cleanenv` prevents host env from leaking in (recommended). If `$FS_LICENSE`
  is set on the host and you use `--cleanenv`, you must pass
  `--fs-license-file` explicitly (as above).
- Recent Apptainer (≥1.0) is a drop-in replacement for Singularity 3.x.
- Under Singularity 2.x, use `singularity exec` and add `-w` explicitly.

Extended HPC / TemplateFlow docs:
https://www.nipreps.org/apps/singularity/

---

## Bare-metal (pip) installation

> ⚠️ **Not recommended** — the container is the tested reference; bare-metal
> installs commonly break when a system library version drifts. Use only when
> containers are impossible.

Requirements:
- Python **3.10+** (3.11–3.13 also supported)
- All [External Dependencies](#external-binary-dependencies-bare-metal-only) present on `$PATH`

Install fMRIPrep from PyPI:

```bash
python -m pip install fmriprep
```

To pin a specific version:

```bash
python -m pip install fmriprep==25.2.5
```

Development install from GitHub:

```bash
git clone https://github.com/nipreps/fmriprep.git
cd fmriprep
python -m pip install -e ".[all]"
```

Optional feature groups (via pip extras):

| Extra | Adds |
|-------|------|
| `[doc]` / `[docs]` | Sphinx + docs deps |
| `[dev]` | ruff, pre-commit |
| `[test]` / `[tests]` | pytest, coverage |
| `[telemetry]` | migas + sentry-sdk |
| `[container]` | Extras baked into container (datalad, git-annex) |
| `[duecredit]` | duecredit citation tracking |
| `[maint]` | maintenance tools |
| `[all]` | Everything |

Python dependencies (auto-installed):
`acres`, `looseversion`, `nibabel≥5.1.1`, `nipype≥1.9.0`, `nireports≥24.1.0`,
`nitime≥0.9`, `nitransforms≥25.0.1`, `niworkflows≥1.14.4`, `numpy≥2.0`,
`packaging≥24`, `pandas≥2.2`, `psutil≥5.4`, `pybids≥0.16`, `requests≥2.27`,
`sdcflows≥2.15.0`, `smriprep≥0.19.2`, `tedana≥25.1.0`, `templateflow≥24.2.2`,
`transforms3d≥0.4.2`, `toml≥0.10`, `codecarbon≥2`, `APScheduler≥3.10`.

---

## External binary dependencies (bare-metal only)

Containers include these. For bare-metal, install these versions (from fMRIPrep
25.2.x lockfiles / Dockerfile):

| Tool | Version (25.2.x) | Notes |
|------|------------------|-------|
| FreeSurfer | **7.3.2** | Get from Harvard, requires license.txt |
| FSL | **6.0.7.7** (via fsl-{bet2, flirt, fast4, fugue, mcflirt, miscmaths, topup} conda pkgs) | Only the components fMRIPrep uses |
| ANTs | **2.5.1** (2.6.* in pixi env) | `antsRegistration`, `N4BiasFieldCorrection`, `antsBrainExtraction.sh` |
| AFNI | **25.2.09** | Only `3dvolreg`, `3dTshift`, `3dUnifize`, `3dAutomask` are used |
| Connectome Workbench | **1.5.0+** (2.0.* in container, Qt6 build) | CIFTI + surface I/O |
| MSM | **HOCR (Nov 2019)** | Multimodal Surface Matching |
| bids-validator | **1.14.10** | Input dataset validation |
| NodeJS | **20.x** | For bids-validator, svgo |
| svgo | **^3.2.0** | Report SVG optimization |
| Python | **3.12** | Container uses 3.12 |

Use `references/versions-dependencies.md` for the exact pin table.

Verify each tool is on PATH:

```bash
which recon-all antsRegistration flirt 3dvolreg wb_command
```

---

## FreeSurfer license

fMRIPrep uses FreeSurfer tools even when `--fs-no-reconall` is set (some
utilities need it). **You must supply a license file.**

Register (free): https://surfer.nmr.mgh.harvard.edu/registration.html

You receive a `license.txt` (small text file with 4 lines). Recommended location:
`$HOME/.licenses/freesurfer/license.txt`.

fMRIPrep resolves the license path in this order:
1. `--fs-license-file /path/to/license.txt` argument
2. `$FS_LICENSE` environment variable (fMRIPrep sets this in-process)
3. `$FREESURFER_HOME/license.txt` (bare-metal fallback)

### Passing the license into containers

**Docker (raw):**
```bash
-v $FS_LICENSE:/opt/freesurfer/license.txt:ro
```

**Docker (wrapper) — auto-detected from `$FS_LICENSE`:**
```bash
export FS_LICENSE=$HOME/.licenses/freesurfer/license.txt
fmriprep-docker /data /out participant
```

**Apptainer with `--cleanenv`:** must pass `--fs-license-file` explicitly, e.g.:
```bash
apptainer run --cleanenv \
    -B $HOME/.licenses/freesurfer/license.txt:/opt/freesurfer/license.txt:ro \
    fmriprep-25.2.5.sif /data /out participant \
    --fs-license-file /opt/freesurfer/license.txt
```

---

## TemplateFlow setup

TemplateFlow is the registry that provides `MNI152NLin2009cAsym`, `fsLR`,
`OASIS30ANTs`, etc. Templates are downloaded on first use.

Default cache path: `$HOME/.cache/templateflow`. Override with:
```bash
export TEMPLATEFLOW_HOME=/path/to/templateflow
```

**Pre-fetch templates** (recommended for HPC, air-gapped or slow-network setups):

```bash
python -m pip install templateflow
python -c "from templateflow.api import get; \
  get(['MNI152NLin2009cAsym', 'MNI152NLin6Asym', 'OASIS30ANTs', \
       'MNIPediatricAsym', 'MNIInfant', 'fsaverage', 'fsLR'])"
```

Templates that **must** be present for common workflows:

| Template | Needed when |
|----------|-------------|
| `MNI152NLin2009cAsym` | Always (default output space + internal reference) |
| `OASIS30ANTs` | Skull-stripping default (`--skull-strip-template`) |
| `MNI152NLin6Asym` | `--cifti-output` |
| `fsaverage` / `fsLR` | Surface / CIFTI output |
| `MNIPediatricAsym` / `MNIInfant` | Pediatric / infant cohorts |

The helper script bundled in the repo (`scripts/fetch_templates.py`) pulls all
common templates:

```bash
wget https://raw.githubusercontent.com/nipreps/fmriprep/master/scripts/fetch_templates.py
python fetch_templates.py --tf-dir /path/to/templateflow
```

The container image includes a pre-populated TemplateFlow mirror in
`/home/fmriprep/.cache/templateflow` — you don't strictly need to bind-mount
your host cache when using Docker/Apptainer, but doing so avoids re-downloads
if you delete the container.

Apptainer + TemplateFlow guide:
https://www.nipreps.org/apps/singularity/#templateflow-and-singularity

---

## Environment variables

| Variable | Effect |
|----------|--------|
| `FS_LICENSE` | Path to FreeSurfer license (auto-picked up by fMRIPrep and the wrapper) |
| `FREESURFER_HOME` | FreeSurfer install root (bare-metal); used as fallback license search location |
| `SUBJECTS_DIR` | FreeSurfer subjects directory (bare-metal) |
| `TEMPLATEFLOW_HOME` | TemplateFlow cache root (default `~/.cache/templateflow`) |
| `FMRIPREP_DEV` | Set to `1` to enable dev warnings (normally suppressed) |
| `FMRIPREP_WARNINGS` | Force warnings even in production builds (dev use) |
| `NIPYPE_NO_ET` / `NO_ET` | Disable Nipype telemetry ping (fMRIPrep force-sets these) |
| `PYTHONHASHSEED` | Set to `0` for reproducible runs (container sets automatically) |
| `MKL_NUM_THREADS` / `OMP_NUM_THREADS` | Set to `1` in container so Nipype controls parallelism |
| `FSLDIR` | FSL install root (bare-metal); container sets to pixi env |
| `FSLOUTPUTTYPE` | `NIFTI_GZ` in container |
| `IS_DOCKER_8395080871` | Set inside the container; fMRIPrep uses it to detect containerized execution |
| `DOCKER_VERSION_8395080871` | Set by the Docker wrapper; distinguishes `docker` from `fmriprep-docker` runs |

---

## Verifying the installation

Print the version — every install path should respond:

```bash
# bare-metal
fmriprep --version

# Docker
docker run --rm nipreps/fmriprep:25.2.5 --version

# Docker wrapper
fmriprep-docker --version

# Apptainer
apptainer run fmriprep-25.2.5.sif --version
```

Expected: `fMRIPrep v25.2.5` (or your installed release).

Dry-run to verify a BIDS dataset without doing work:

```bash
fmriprep /path/to/bids /path/to/derivatives participant \
    --participant-label 01 \
    --boilerplate-only        # emit only the methods paragraph and exit
```

Or generate reports without redoing computation (uses cached working dir):

```bash
fmriprep /path/to/bids /path/to/derivatives participant \
    --participant-label 01 \
    --reports-only \
    -w /path/to/work
```
