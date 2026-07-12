# Complete CLI Reference

Source of truth: `fmriprep/cli/parser.py` in the source tree (25.2.x).
Every flag below is verified against that parser. Defaults shown are the parser
defaults; some (marked *"auto"*) are set later during workflow construction.

Command form:

```
fmriprep <bids_dir> <output_dir> <analysis_level> [OPTIONS]
```

## Table of Contents
1. [Positional arguments](#positional-arguments)
2. [BIDS filtering options](#bids-filtering-options)
3. [Performance options](#performance-options)
4. [Subset-of-workflow options](#subset-of-workflow-options)
5. [Workflow configuration](#workflow-configuration)
6. [Output modulation](#output-modulation)
7. [Confounds options](#confounds-options)
8. [ANTs (skull-strip) options](#ants-skull-strip-options)
9. [Fieldmap options](#fieldmap-options)
10. [SyN-SDC options](#syn-sdc-options)
11. [FreeSurfer options](#freesurfer-options)
12. [Carbon tracking](#carbon-tracking)
13. [Other options](#other-options)
14. [Deprecated flags](#deprecated-flags)

---

## Positional arguments

| Argument | Type | Description |
|----------|------|-------------|
| `bids_dir` | existing dir | Root of a valid BIDS dataset (contains `sub-*/` folders) |
| `output_dir` | dir path | Where derivatives + visual reports go. **Must not equal or contain `bids_dir`**. |
| `analysis_level` | `participant` (only choice) | BIDS-App analysis level. fMRIPrep does not support group-level. |

---

## BIDS filtering options
*Group: "Options for filtering BIDS queries"*

| Flag | Type / Default | Description |
|------|----------------|-------------|
| `--skip_bids_validation`, `--skip-bids-validation` | flag / `False` | Assume dataset is BIDS-valid; skip the built-in validator. |
| `--participant-label`, `--participant_label` | space-list of labels | Restrict processing to these subjects. `sub-` prefix is stripped automatically. |
| `--session-label` | space-list of labels | Restrict to these sessions. `ses-` prefix stripped. (Requires 25.2.0+.) |
| `-t`, `--task-id` | string | Restrict to a single task. |
| `--echo-idx` | int | Restrict to a specific echo in multi-echo data. |
| `--subject-anatomical-reference` | `first-lex` (default) / `unbiased` / `sessionwise` | How to combine T1w images across sessions. `first-lex` = align to first (lexical); `unbiased` = build unbiased template (replaces old `--longitudinal`); `sessionwise` = independent per session. |
| `--track-sessions` / `--no-track-sessions` | flag / `True` | Whether to append session IDs to FreeSurfer subject IDs. Restores pre-25.2 behavior when disabled. |
| `--bids-filter-file` | JSON path | Custom PyBIDS queries — see `references/bids-filter.md`. |
| `-d`, `--derivatives` | `PACKAGE=PATH ...` | Search paths for pre-computed BIDS-Derivatives (replaces old `--anat-derivatives`). |
| `--bids-database-dir` | dir path | Pre-indexed PyBIDS SQLite database (created if missing). Speeds up large datasets. |

---

## Performance options
*Group: "Options to handle performance"*

| Flag | Type / Default | Description |
|------|----------------|-------------|
| `--nprocs`, `--nthreads`, `--n_cpus`, `--n-cpus` | int (≥1) / auto | Maximum threads across all processes. |
| `--omp-nthreads` | int (≥1) / auto | Maximum threads per process. Default: `min(nprocs-1, 8)`. |
| `--mem`, `--mem_mb`, `--mem-mb` | int MB or K/M/G/T suffix | Upper memory bound. Docker wrapper warns below 8000. |
| `--low-mem` | flag / `False` | Trade disk for RAM: use uncompressed intermediates and other tricks. |
| `--use-plugin`, `--nipype-plugin-file` | YAML file | Custom Nipype plugin config (e.g. for SGE, PBS). |
| `--sloppy` | flag / `False` | **TESTING ONLY** — coarser tools for faster CI. Do not use on real data. |

---

## Subset-of-workflow options
*Group: "Options for performing only a subset of the workflow"*

| Flag | Type / Default | Description |
|------|----------------|-------------|
| `--anat-only` | flag / `False` | Only run anatomical workflows (smriprep). |
| `--level` | `minimal` / `resampling` / `full` (default) | Depth of derivatives generation. `minimal` = transforms only; `resampling` = adds intermediates useful for third-party resampling; `full` = every derivative. |
| `--boilerplate-only`, `--boilerplate_only` | flag / `False` | Emit only the citation boilerplate and exit. |
| `--reports-only` | flag / `False` | Regenerate reports from cached reportlets without re-running workflows. |

---

## Workflow configuration
*Group: "Workflow configuration"*

| Flag | Type / Default | Description |
|------|----------------|-------------|
| `--ignore` | space-list of `fieldmaps` / `slicetiming` / `sbref` / `t2w` / `flair` / `fmap-jacobian` | Disable a pipeline aspect. Ex: `--ignore slicetiming fieldmaps`. |
| `--force` | space-list of `bbr` / `no-bbr` / `syn-sdc` / `fmap-jacobian` | Override auto-choices. `bbr`+`no-bbr` conflict. `syn-sdc` **adds** SyN to any existing fieldmaps. |
| `--output-spaces` | space-list of `SPACE[:cohort-X][:res-Y][:den-Z]` | Where to resample outputs. Empty (`--output-spaces` alone) = no BOLD resampling. Default when omitted: `MNI152NLin2009cAsym:res-native`. See `references/spaces.md`. |
| `--bold2anat-init` | `auto` (default) / `t1w` / `t2w` / `header` | Initial BOLD-to-anatomical alignment. `auto` uses T2w if available, else T1w; `header` skips initial reg and uses the BOLD header. |
| `--bold2anat-dof` | `6` (default) / `9` / `12` | DOF of BOLD-to-anat registration. `6` = rigid; `9` adds scaling; `12` = full affine. |
| `--slice-time-ref` | 0..1 or `start` (=0) / `middle` (=0.5, default) | Target time of each TR to correct slices to. `0.5` → volume onsets shift by 0.5 TR; downstream GLM must account for this. |
| `--dummy-scans` | int | Manually set the number of non-steady-state volumes (overrides auto-detection). |
| `--fallback-total-readout-time` | number or `"estimated"` | Fallback TRT when metadata is missing. |
| `--random-seed` | int | Seed the workflow's RNG. Combined with `--omp-nthreads 1` and `--skull-strip-fixed-seed` for reproducibility. |
| `--me-t2s-fit-method` | `curvefit` (default) / `loglin` | T2*/S0 estimation for multi-echo. `curvefit` = nonlinear regression (slower, more accurate); `loglin` = log-linear (faster, less accurate). |
| `--project-goodvoxels` | flag / `False` | Exclude voxels with locally-high coefficient of variation during surface resampling (HCP "goodvoxels" masking). Only affects fsaverage / fsnative GIFTI output. |

---

## Output modulation
*Group: "Options for modulating outputs"*

| Flag | Type / Default | Description |
|------|----------------|-------------|
| `--output-layout` | `bids` (default) / `legacy` | `bids` places fMRIPrep derivatives at `output_dir/` and FreeSurfer at `output_dir/sourcedata/freesurfer`. `legacy` uses pre-21.0 layout with `fmriprep/` and `freesurfer/` subfolders. |
| `--me-output-echos` | flag / `False` | For multi-echo: also save per-echo time series after STC/HMC/SDC. Feeds downstream tedana processing. |
| `--aggregate-session-reports` | int / `4` | Max sessions per subject's report before splitting into multi-file reports. |
| `--medial-surface-nan` | flag / `False` | Replace medial-wall values with NaN in functional GIFTI (fsnative/fsaverage). |
| `--md-only-boilerplate` | flag / `False` | Emit Markdown boilerplate only; skip pandoc HTML/LaTeX conversion. |
| `--cifti-output` | flag with optional value `91k` (default) / `170k` | Enable CIFTI grayordinate output. `91k` = 91,282 grayordinates @ 2 mm; `170k` = 170,494 @ 1.6 mm. Implies `MNI152NLin6Asym` in output spaces. |
| `--msm` / `--no-msm` | flag / `True` | Enable/disable Multimodal Surface Matching (MSMSulc) surface registration. |

---

## Confounds options
*Group: "Options relating to confounds"*

| Flag | Type / Default | Description |
|------|----------------|-------------|
| `--return-all-components` | flag / `False` | Include *all* CompCor components in the confounds TSV (default keeps only enough to explain 50% variance in each ROI). |
| `--fd-spike-threshold` | float / `0.5` | Framewise-displacement threshold (mm) for spike-regressor generation. |
| `--dvars-spike-threshold` | float / `1.5` | Standardized-DVARS threshold for spike-regressor generation. |

See `references/confounds.md` for the full column dictionary.

---

## ANTs (skull-strip) options
*Group: "Specific options for ANTs registrations"*

| Flag | Type / Default | Description |
|------|----------------|-------------|
| `--skull-strip-template` | Reference string / `OASIS30ANTs` | Template used by `antsBrainExtraction`. |
| `--skull-strip-fixed-seed` | flag / `False` | Use a fixed random seed (needed for exact reproducibility). |
| `--skull-strip-t1w` | `auto` / `skip` / `force` (default) | Heuristic-guided (`auto`) or forced skull-stripping. Use `skip` only when T1w is already brain-extracted. |

---

## Fieldmap options
*Group: "Specific options for handling fieldmaps"*

| Flag | Type / Default | Description |
|------|----------------|-------------|
| `--fmap-bspline` | flag / `False` | Fit a B-Spline field via least-squares (experimental). |
| `--fmap-no-demean` | flag / `True` (i.e., demean IS done by default) | Do NOT remove the within-mask median from the fieldmap. Passing this flag disables demeaning. |

---

## SyN-SDC options
*Group: "Specific options for SyN distortion correction"*

| Flag | Type / Default | Description |
|------|----------------|-------------|
| `--use-syn-sdc` | optional value `warn` / `error` (default) | Enable fieldmap-less SDC using an anatomical prior. Argument specifies behavior when unable to compute: `error` (default) or `warn`. |
| `--force syn-sdc` | (via `--force`) | *Add* SyN-SDC even when other fieldmaps are present. |

---

## FreeSurfer options
*Group: "Specific options for FreeSurfer preprocessing"*

| Flag | Type / Default | Description |
|------|----------------|-------------|
| `--fs-license-file` | file path | Path to FreeSurfer license.txt. Register free at https://surfer.nmr.mgh.harvard.edu/registration.html |
| `--fs-subjects-dir` | dir path | Existing FreeSurfer subjects dir to reuse. Default: `<output-dir>/sourcedata/freesurfer` (bids layout) or `<output-dir>/freesurfer` (legacy). |
| `--submm-recon` / `--no-submm-recon` | flag / `True` | Enable/disable sub-mm high-resolution recon. Auto-triggers when T1w voxels <1 mm. |
| `--fs-no-reconall` | flag | **Disable FreeSurfer surface preprocessing entirely.** Skips surface/CIFTI outputs. |
| `--fs-no-resume` | flag / `False` | EXPERT: import a pre-computed recon without resuming. User must ensure completeness. |

---

## Carbon tracking
*Group: "Options for carbon usage tracking"*

| Flag | Type / Default | Description |
|------|----------------|-------------|
| `--track-carbon` | flag / `False` | Track power draw via CodeCarbon. |
| `--country-code` | ISO / `CAN` | Country code for carbon calculations. |

---

## Other options
*Group: "Other options"*

| Flag | Type / Default | Description |
|------|----------------|-------------|
| `--version` | flag | Show `fMRIPrep vX.Y.Z` and exit. |
| `-v`, `--verbose` | count / `0` | Repeat for more log detail. `-vvv` = DEBUG. |
| `-w`, `--work-dir` | dir path | Nipype scratch directory. Default `./work/`. Must NOT be inside `bids_dir`. |
| `--clean-workdir` | flag / `False` | Wipe the working dir before running. **Do not use with concurrent runs.** |
| `--resource-monitor` | flag / `False` | Enable Nipype resource-monitor sampling (memory/CPU). |
| `--config-file` | file path | Load a pre-generated fMRIPrep TOML config. CLI args override config values. |
| `--write-graph` | flag / `False` | Save the Nipype workflow graph. |
| `--stop-on-first-crash` | flag / `False` | Stop immediately on the first error, even if `-w` is set. |
| `--notrack` | flag / `False` | Opt out of telemetry. |
| `--debug` | space-list of `compcor` / `fieldmaps` / `pdb` / `all` | Enable a debug mode (`pdb` drops into the debugger on crash). |
| `-h`, `--help` | flag | Show help. |

---

## Deprecated flags

Deprecated in 25.x (removed in the version noted):

| Old flag | Replacement | Removed in |
|----------|-------------|------------|
| `--force-bbr` | `--force bbr` | 26.0.0 |
| `--force-no-bbr` | `--force no-bbr` | 26.0.0 |
| `--force-syn` | `--force syn-sdc` | 26.0.0 |
| `--longitudinal` | `--subject-anatomical-reference unbiased` | 26.1.0 |
| `--anat-derivatives` | `--derivatives smriprep=/path` | Removed (use `-d`) |

---

## `fmriprep-docker` wrapper flags

The wrapper reproduces the fmriprep CLI. Its own flags:

| Flag | Purpose |
|------|---------|
| `-i`, `--image IMG` | Docker image (default `nipreps/fmriprep:<wrapper_version>`) |
| `-e`, `--env VAR val` | Pass env var into container (repeatable) |
| `-u`, `--user UID[:GID]` | Run as another user |
| `--network none|bridge|host|...` | Docker network driver |
| `--shell` | Drop to shell in the image |
| `--patch PACKAGE=PATH` | Bind-mount a dev checkout over an installed package |
| `--config PATH` | Custom `nipype.cfg` |
| `--no-tty` | Skip `-it` (CI-safe) |

The wrapper automatically bind-mounts: `bids_dir → /data:ro`,
`output_dir → /out`, `work_dir → /scratch`, `fs_license_file → /opt/freesurfer/license.txt:ro`,
`fs_subjects_dir → /opt/subjects`, `config_file → /tmp/config.toml`,
`derivatives → /deriv/<name>:ro`, `use_plugin → /tmp/plugin.yml:ro`,
`bids_database_dir → /tmp/bids_db`, `bids_filter_file → /tmp/bids_filter.json`.

Custom output-space templates (not in the built-in TemplateFlow set) can be
passed as `--output-spaces /path/to/tpl-MyCustom` — the wrapper bind-mounts
them into `/home/fmriprep/.cache/templateflow/tpl-MyCustom`.

---

## Consistency validations enforced by the parser

fMRIPrep will refuse to run if:

- `output_dir == bids_dir` — suggests `bids_dir/derivatives/fmriprep-<ver>` instead
- `work_dir` is inside `bids_dir`
- `--force bbr` and `--force no-bbr` both set
- `--force fmap-jacobian` and `--ignore fmap-jacobian` both set

Warnings printed when:

- `--omp-nthreads > --nthreads`
- `--skull-strip-t1w auto` (heuristic risks are noted)
- Telemetry is disabled because `sentry_sdk` is missing
- Your version is in the flagged list (`.versions.json`); check before publishing
