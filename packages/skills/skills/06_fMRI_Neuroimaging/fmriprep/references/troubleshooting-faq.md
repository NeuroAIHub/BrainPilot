# FAQ & Troubleshooting

Curated from the official fMRIPrep FAQ (`docs/faq.rst` in the repo) plus
recurring issues on NeuroStars. Every entry is a specific symptom → fix.

## Table of Contents
1. [Should I QC my data before running fMRIPrep?](#should-i-qc-my-data-before-running-fmriprep)
2. [Skull-stripped T1w input](#skull-stripped-t1w-input)
3. [Hangs / `BrokenProcessPool` / OOM kills](#hangs--brokenprocesspool--oom-kills)
4. [Reusing an existing `recon-all` output](#reusing-an-existing-recon-all-output)
5. [`ERROR: it appears that recon-all is already running`](#error-it-appears-that-recon-all-is-already-running)
6. [Race conditions running subjects in parallel](#race-conditions-running-subjects-in-parallel)
7. [How much CPU / RAM to allocate?](#how-much-cpu--ram-to-allocate)
8. [When to upgrade — and the "flagged versions" list](#when-to-upgrade--and-the-flagged-versions-list)
9. [Apptainer / Singularity troubleshooting](#apptainer--singularity-troubleshooting)
10. [What is TemplateFlow — and offline / HPC use](#what-is-templateflow--and-offline--hpc-use)
11. [Selecting subsets of files with `--bids-filter-file`](#selecting-subsets-of-files-with---bids-filter-file)
12. [Resume after a crash](#resume-after-a-crash)
13. [Longitudinal / multi-session studies](#longitudinal--multi-session-studies)
14. [Speed up large datasets](#speed-up-large-datasets)
15. [`insufficient length of BOLD data after discarding nonsteady-states`](#insufficient-length-of-bold-data-after-discarding-nonsteady-states)
16. [Container permission / user ID errors](#container-permission--user-id-errors)
17. [Apple Silicon (arm64) Docker](#apple-silicon-arm64-docker)
18. [The FreeSurfer license](#the-freesurfer-license)
19. [Slice-timing shift in first-level modeling](#slice-timing-shift-in-first-level-modeling)
20. [When to file a bug](#when-to-file-a-bug)

---

## Should I QC my data before running fMRIPrep?

**Yes**, before any processing. Bad acquisitions (severe motion, wrap, ghosts,
missing slices) waste hours of pipeline time and can crash fMRIPrep. Use
**MRIQC** (also a NiPreps app) for automated per-subject QC of raw data:

```bash
docker run --rm -it -v /data:/data:ro -v /out:/out \
    nipreps/mriqc:latest /data /out participant
```

Pre-specify exclusion criteria before looking at data (open-science hygiene).

---

## Skull-stripped T1w input

If your dataset ships with already-brain-extracted T1w (some public datasets
do), fMRIPrep will either fail at brain extraction or produce garbage
downstream because it doesn't know what preprocessing was already applied.

Options:
- **Preferred**: revert to the original, defaced T1w.
- If you must use pre-stripped data: `--skull-strip-t1w skip`. Document this
  clearly in your methods — cross-subject preprocessing consistency is broken.
- `--skull-strip-t1w auto` applies a heuristic. If it misfires either way,
  fall back to `skip` or `force`.

Related issues:
[nipreps/smriprep#12](https://github.com/nipreps/smriprep/issues/12),
[nipreps/fmriprep#939](https://github.com/nipreps/fmriprep/issues/939).

---

## Hangs / `BrokenProcessPool` / OOM kills

Symptom: fMRIPrep hangs indefinitely, or crashes with `BrokenProcessPool`.

Root cause: a Python bug in some Linux configurations triggers the OOM killer
when the process pool exceeds available memory. Depending on what gets killed,
the pool either crashes visibly or wedges.

Fixes:
1. **Allocate more RAM** — 16 GB is a comfortable single-subject baseline.
2. **`--low-mem`** — trades RAM for disk in `-w`.
3. **Reduce parallelism** — lower `--nthreads` and/or `--omp-nthreads`.
4. **One subject per container** — never share `-w` across concurrent subjects.

NeuroStars threads:
- https://neurostars.org/t/memory-issue-when-processing-large-amount-of-data/2562
- https://neurostars.org/t/how-much-ram-cpus-is-reasonable-to-run-pipelines-like-fmriprep/1086
- https://neurostars.org/t/memory-allocation-issues-with-fmriprep-singularity-and-hpc/2759
- https://neurostars.org/t/fmriprep-v1-0-12-hanging/1661

---

## Reusing an existing `recon-all` output

Yes, if FreeSurfer ≥ 6.0.0 was used originally.

**Option A** — put subjects in the default location:

```
<output_dir>/sourcedata/freesurfer/sub-01/    # bids layout
<output_dir>/freesurfer/sub-01/                # legacy layout
```

fMRIPrep auto-detects and reuses; missing steps are completed.

**Option B** — external subjects dir:

```bash
--fs-subjects-dir /shared/freesurfer_subjects
```

If your recon is complete (no need to resume), use `--fs-no-resume` (EXPERT).

---

## `ERROR: it appears that recon-all is already running`

Symptom: FreeSurfer refuses to run because `IsRunning.lh+rh` or
`IsRunning.{lh,rh}` files exist under
`<output_dir>/sourcedata/freesurfer/sub-XX/scripts/`.

Cause: previous `recon-all` was killed / died before it could clean up.

Fix — after confirming no `recon-all` is actually running:

```bash
rm -f <output_dir>/sourcedata/freesurfer/sub-XX/scripts/IsRunning.*
# then rerun fMRIPrep
```

Or add `-no-isrunning` to a manual `recon-all` invocation (fMRIPrep doesn't
expose this, but you can pre-clean).

Full FreeSurfer explanation:
https://surfer.nmr.mgh.harvard.edu/fswiki/RunningFreeSurferInParallel

---

## Race conditions running subjects in parallel

Symptom: `FileNotFoundError: [...]/logs/CITATION.md` or similar when running
multiple subjects concurrently in **the same working dir**.

Cause: multiple fMRIPrep processes writing to the same shared paths (usually
the citations logs directory).

Fix — **one working directory per subject, or one container per subject**.
Recommended pattern (works on any cluster):

```bash
for sub in $(cat subject_list.txt); do
    sbatch --export=ALL,SUBJECT=$sub run_fmriprep.sh
done
```

with `run_fmriprep.sh` using `-w /scratch/$USER/work/sub-${SUBJECT}` and
`--participant-label $SUBJECT`.

Detailed workaround:
https://neurostars.org/t/updated-fmriprep-workaround-for-running-subjects-in-parallel/6677

---

## How much CPU / RAM to allocate?

Typical single-subject run (no FreeSurfer):
- ~2 hours with 4 CPUs
- ~1 hour with 16 CPUs
- >16 CPUs shows *no further speedup* per subject

RAM: **at least 8 GB**, 16 GB is comfortable. FreeSurfer recon adds ~4 GB.

When running many subjects in parallel: `--omp-nthreads ≈ nCPU_per_subject`,
and give each subject its own container.

Reference benchmarks (Intel E5-2683 v4, 64 GB):
`docs/_static/fmriprep_benchmark.svg`. Two subjects × 8 CPUs finishes about
as fast as one subject × 16 CPUs but is easier to schedule on a cluster.

---

## When to upgrade — and the "flagged versions" list

Rule: **process a whole study with the same fMRIPrep version + container
build**. Don't upgrade mid-study.

But: check `.versions.json` in the repo — flagged versions have known severe
bugs (e.g., phase-difference fieldmap bug, fsLR resampling bug in 20.0.x,
functional outputs orientation bug in 20.1.x/20.2.0/20.2.1). If your version
is flagged, upgrade to a non-flagged patch release and reprocess.

Live list:
https://github.com/nipreps/fmriprep/blob/master/.versions.json

Current LTS track: **25.2.x**, supported through October 2029. Prefer 25.2.x
for new studies.

---

## Apptainer / Singularity troubleshooting

Common issues:

- **TemplateFlow can't write to cache** → point `TEMPLATEFLOW_HOME` at a
  writeable path and bind-mount it:
  `-B $HOME/.cache/templateflow:/opt/templateflow --env TEMPLATEFLOW_HOME=/opt/templateflow`
- **FreeSurfer complains about license** with `--cleanenv` → pass
  `--fs-license-file` explicitly, don't rely on `$FS_LICENSE`.
- **"container immutable"** → run outside `--writable-tmpfs` needs; if you
  see mount errors, add `--writable-tmpfs`.
- **Slow first run** → templates being fetched. Pre-populate the cache.

Full guide: https://www.nipreps.org/apps/singularity/

---

## What is TemplateFlow — and offline / HPC use

TemplateFlow is the template registry (MNI152, fsLR, OASIS30ANTs, ...).
Templates are fetched over HTTP on first use. On HPC compute nodes without
Internet:

```bash
# On login node (with Internet):
export TEMPLATEFLOW_HOME=$HOME/.cache/templateflow
python -m pip install --user templateflow
python -c "from templateflow.api import get; \
  get(['MNI152NLin2009cAsym', 'MNI152NLin6Asym', 'OASIS30ANTs', \
       'MNIPediatricAsym', 'MNIInfant'])"
```

Then bind-mount it in every job. Even Docker/Apptainer's baked-in cache is
overridden by bind-mounts, ensuring you know exactly what template files are
being used.

The container ships with a pre-fetched cache at
`/home/fmriprep/.cache/templateflow` — but relying on it only means you can't
audit template versions unless you mount your own.

Extra note: `--cifti-output` requires `MNI152NLin6Asym`; `--use-syn-sdc`
requires `MNI152NLin2009cAsym`; default skull-strip requires `OASIS30ANTs`.

---

## Selecting subsets of files with `--bids-filter-file`

See `references/bids-filter.md`. Quick note: metadata-based filtering (e.g.,
"only runs with TR=2s") requires a `.bidsignore` file or a wrapper script —
`--bids-filter-file` filters on **entities**, not on metadata content.

---

## Resume after a crash

Yes — fMRIPrep is built on Nipype, which persists workflow state in the
working directory. Point `-w` at the same path (default `./work/`) and re-run
with the same arguments. Some nodes rerun unconditionally, but expensive
steps (recon-all, ANTs registration) are cached.

```bash
# Original run crashed at 60%; just re-run:
fmriprep-docker /data /out participant --participant-label 01 -w /data/work
```

Never wipe `-w` unless you want a clean rerun. If disk is tight, use
`--clean-workdir` OR narrow scope with `--participant-label`.

---

## Longitudinal / multi-session studies

Guiding assumption: fMRIPrep assumes no substantial anatomical change across
sessions.

- **Same-brain assumption OK** (adult, short study): use defaults
  (`--subject-anatomical-reference first-lex`) or `unbiased` for
  reg-quality-sensitive analyses.
- **Post-surgery**: use ONLY pre-op sessions as anatomical inputs — filter with
  `--bids-filter-file` to restrict `t1w` to specific sessions.
- **Developing / elderly cohorts** (substantial atrophy): use
  `--subject-anatomical-reference sessionwise` — each session gets its own
  anat reference and FreeSurfer subject.

NeuroStars long thread on the "anatomical fast-track" pattern:
https://neurostars.org/t/fmriprep-how-to-reuse-longitudinal-and-pre-run-freesurfer/4585/15

---

## Speed up large datasets

Options:

1. **Pre-index the BIDS layout**:
   ```bash
   pybids layout /data/bids /data/bids_db --no-validate --index-metadata
   ```
   Then pass `--bids-database-dir /data/bids_db` — huge speedup for datasets
   with thousands of files.

2. **`--ignore`** — disable aspects of processing (fieldmaps, slicetiming,
   sbref, t2w, flair, fmap-jacobian) at fMRIPrep level. Use `.bidsignore` at
   the dataset root to exclude files from PyBIDS/bids-validator entirely.

3. **`--level minimal`** — skip resampled outputs.

4. **`--anat-only`** first, then per-session BOLD with `-d fmriprep=...`.

5. **`--skip-bids-validation`** — only after you've validated once with
   `bids-validator`.

---

## `insufficient length of BOLD data after discarding nonsteady-states`

Symptom: AFNI `3dTShift` (STC) crashes because <5 volumes remain after
non-steady-state removal.

Root causes:
- Very short BOLD run (fewer than ~8 volumes total).
- Auto-detected non-steady-state count is unusually high (should be 0–5).

Fixes:
- `--dummy-scans N` — set explicitly (usually 0 or 4). Overrides auto-detection.
- `--ignore slicetiming` — skip STC entirely if the series is really that short.

Both settings apply to ALL runs in the invocation; use `--task-id` / `--session-label`
/ `--bids-filter-file` to isolate the affected run if needed.

---

## Container permission / user ID errors

Symptom on Linux: derivatives owned by `root:root` from Docker runs.

Fix: run as your own UID/GID.

```bash
docker run --user "$(id -u):$(id -g)" ...
# or with the wrapper:
fmriprep-docker --user "$(id -u):$(id -g)" ...
```

Downside: the container's internal user (`fmriprep`) doesn't match, so `$HOME`
inside is undefined. Bind-mount a writeable dir:

```bash
-v /some/writeable/dir:/home/fmriprep
```

Or use Apptainer, which runs as the invoking user by default.

---

## Apple Silicon (arm64) Docker

The container is built only for `linux-64`. On M1/M2/M3 Macs run under Rosetta:

```bash
docker run --platform linux/amd64 --rm -it ... nipreps/fmriprep:25.2.5 ...
```

`fmriprep-docker` (the Python wrapper) does not expose a `--platform` flag.
To force x86 emulation with the wrapper, set the Docker CLI's daemon-wide
default platform beforehand:

```bash
export DOCKER_DEFAULT_PLATFORM=linux/amd64
fmriprep-docker /data /out participant ...
```

Expect ~30% slowdown; some numerical steps may differ trivially due to x86
emulation.

---

## The FreeSurfer license

Register (free): https://surfer.nmr.mgh.harvard.edu/registration.html

fMRIPrep looks for the license in this order:
1. `--fs-license-file /path/to/license.txt`
2. `$FS_LICENSE` env var
3. `$FREESURFER_HOME/license.txt` (bare-metal fallback)

**Even with `--fs-no-reconall`, you need the license** — some FreeSurfer
utilities (mri_convert, mri_binarize) are used regardless.

For Docker wrapper: `export FS_LICENSE=/path/to/license.txt` — auto-detected.
For raw Docker: `-v /path/to/license.txt:/opt/freesurfer/license.txt:ro`.
For Apptainer with `--cleanenv`: pass `--fs-license-file` explicitly.

---

## Slice-timing shift in first-level modeling

Default `--slice-time-ref 0.5` shifts effective volume onsets by 0.5 TR.
For TR=2s: original onsets [0, 2, 4, ...] → effective [1, 3, 5, ...].

Options in first-level GLM:
- Configure model to expect middle-slice reference (most packages support this).
- Manually shift volume onsets forward by 0.5 TR, OR event onsets backward by
  0.5 TR.
- Set `--slice-time-ref 0` in fMRIPrep to keep original onsets (STC still runs,
  but shifts everything to the START of TR).

Deep dive:
https://reproducibility.stanford.edu/slice-timing-correction-in-fmriprep-and-linear-modeling/

---

## When to file a bug

Before opening an issue on GitHub:
1. Update to the latest patch of the same minor version (e.g. 25.2.x).
2. Check the flagged versions list (`.versions.json`).
3. Search NeuroStars: https://neurostars.org/tag/fmriprep
4. Check open + closed GitHub issues: https://github.com/nipreps/fmriprep/issues

When filing:
- fMRIPrep version + exec env (Docker, Apptainer, bare-metal, container tag).
- Exact command line (redact PII).
- Relevant log excerpts (stderr, `<output>/logs/`, crash files under `<output>/sub-XX/log/`).
- A minimal reproducer if possible (subset of the dataset).

Issue tracker: https://github.com/nipreps/fmriprep/issues
Support forum (preferred for usage questions): https://neurostars.org/tag/fmriprep
