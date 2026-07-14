# Citation Reference

fMRIPrep sits on top of many other tools. Cite them all — the official
citation strategy is **use the auto-generated boilerplate** from your run's
visual report, verbatim.

## Table of Contents
1. [The citation boilerplate mechanism](#the-citation-boilerplate-mechanism)
2. [Primary papers](#primary-papers)
3. [Software DOI (Zenodo)](#software-doi-zenodo)
4. [BibTeX for the primary papers](#bibtex-for-the-primary-papers)
5. [Dependency papers](#dependency-papers)
6. [Plagiarism disclaimer](#plagiarism-disclaimer)
7. [Where boilerplate lives in your outputs](#where-boilerplate-lives-in-your-outputs)

---

## The citation boilerplate mechanism

Every fMRIPrep run auto-generates a methods paragraph tailored to what the
pipeline actually did (which SDC estimator, which templates, which
CompCor variant, etc.). It's written to `<output>/logs/CITATION.{md,html,tex}`
and embedded in the per-subject HTML report.

Copy that paragraph **verbatim** into your paper's Methods section. It is:
- **CC0-licensed** public domain — no attribution required, no relicensing.
- Version-specific — every citation and dependency version matches what ran.
- Peer-endorsed — the NiPreps team maintains the wording to be accurate and
  reviewer-defensible.

Full rationale: https://www.nipreps.org/intro/transparency/#citation-boilerplates

Generate only the boilerplate, without doing the preprocessing:

```bash
fmriprep /data/bids /data/derivatives participant \
    --participant-label 01 \
    --boilerplate-only
```

Output lands in `/data/derivatives/logs/CITATION.md` (and `.html`, `.tex`).

If you want to skip the pandoc conversion (Markdown only):

```bash
--md-only-boilerplate
```

---

## Primary papers

Cite both when publishing:

### Esteban et al., 2019 — the main fMRIPrep paper

> Esteban, O., Markiewicz, C. J., Blair, R. W., Moodie, C. A., Isik, A. I.,
> Erramuzpe, A., Kent, J. D., Goncalves, M., DuPre, E., Snyder, M., Oya, H.,
> Ghosh, S. S., Wright, J., Durnez, J., Poldrack, R. A., & Gorgolewski, K. J.
> (2019). **fMRIPrep: a robust preprocessing pipeline for functional MRI.**
> *Nature Methods, 16*, 111–116.
> https://doi.org/10.1038/s41592-018-0235-4
> [Preprint](https://doi.org/10.1101/306951)

### Esteban et al., 2020 — the Nature Protocols companion

> Esteban, O., Ciric, R., Finc, K., Blair, R. W., Markiewicz, C. J., Moodie,
> C. A., Kent, J. D., Goncalves, M., DuPre, E., Gomez, D. E. P., Ye, Z.,
> Salo, T., Valabregue, R., Amlien, I. K., Liem, F., Jacoby, N., Stojić, H.,
> Cieslak, M., Urchs, S., … Gorgolewski, K. J. (2020).
> **Analysis of task-based functional MRI data preprocessed with fMRIPrep.**
> *Nature Protocols, 15*, 2186–2202.
> https://doi.org/10.1038/s41596-020-0327-3
> [Preprint](https://doi.org/10.1101/694364)

---

## Software DOI (Zenodo)

Cite the exact software version:

> fMRIPrep — Software DOI: https://doi.org/10.5281/zenodo.852659

The Zenodo DOI resolves to the latest version; for version-specific DOIs, see
the version tree on Zenodo.

Also cite the RRID for reproducibility:

- **RRID: SCR_016216**

---

## BibTeX for the primary papers

```bibtex
@article{esteban2019fmriprep,
  title   = {fMRIPrep: a robust preprocessing pipeline for functional MRI},
  author  = {Esteban, Oscar and Markiewicz, Christopher J and Blair, Ross W
             and Moodie, Craig A and Isik, A Ilkay and Erramuzpe, Asier
             and Kent, James D and Goncalves, Mathias and DuPre, Elizabeth
             and Snyder, Madeleine and Oya, Hiroyuki and Ghosh, Satrajit S
             and Wright, Jessey and Durnez, Joke and Poldrack, Russell A
             and Gorgolewski, Krzysztof J},
  journal = {Nature Methods},
  volume  = {16},
  number  = {1},
  pages   = {111--116},
  year    = {2019},
  doi     = {10.1038/s41592-018-0235-4}
}

@article{esteban2020analysis,
  title   = {Analysis of task-based functional {MRI} data preprocessed with
             fMRIPrep},
  author  = {Esteban, Oscar and Ciric, Rastko and Finc, Karolina and
             Blair, Ross W and Markiewicz, Christopher J and Moodie, Craig A
             and Kent, James D and Goncalves, Mathias and DuPre, Elizabeth
             and Gomez, Daniel E P and Ye, Zhifang and Salo, Taylor and
             Valabregue, Romain and Amlien, Inge K and Liem, Franz and
             Jacoby, Nir and Stoji{\'c}, Hrvoje and Cieslak, Matthew and
             Urchs, Sebastian and Halchenko, Yaroslav O and Ghosh, Satrajit S
             and De La Vega, Alejandro and Yarkoni, Tal and Wright, Jessey
             and Thompson, William H and Poldrack, Russell A and
             Gorgolewski, Krzysztof J},
  journal = {Nature Protocols},
  volume  = {15},
  number  = {7},
  pages   = {2186--2202},
  year    = {2020},
  doi     = {10.1038/s41596-020-0327-3}
}

@software{fmriprep_zenodo,
  author       = {The NiPreps Developers},
  title        = {{fMRIPrep}: robust preprocessing pipeline for fMRI},
  publisher    = {Zenodo},
  doi          = {10.5281/zenodo.852659},
  url          = {https://doi.org/10.5281/zenodo.852659}
}
```

Replace the Zenodo DOI with the version-specific DOI (from the version tree
on Zenodo) when possible.

---

## Dependency papers

The boilerplate handles these for you, but here's the master list (from
`REFERENCES.md` in the repo). Cite each tool your run actually used
(the boilerplate is aware).

### Registration / anatomical

- **FreeSurfer** — https://github.com/freesurfer/freesurfer
- **recon-all** — Dale AM, Fischl B, Sereno MI (1999). Cortical surface-based
  analysis. https://doi.org/10.1006/nimg.1998.0395
- **bbregister & BBR** — Greve DN, Fischl B (2009).
  https://doi.org/10.1016/j.neuroimage.2009.06.060
- **mri_robust_template** — Reuter M, Rosas HD, Fischl B (2012).
  https://doi.org/10.1016/j.neuroimage.2012.02.084
- **mri_robust_register** — Reuter M, Rosas HD, Fischl B (2010).
  https://doi.org/10.1016/j.neuroimage.2010.07.020

- **ANTs** — Avants BB et al. (2015).
  https://doi.org/10.3389/fninf.2015.00005
- **antsRegistration (SyN)** — Avants BB et al. (2008).
  https://doi.org/10.1016/j.media.2007.06.004
- **N4BiasFieldCorrection** — Tustison NJ et al. (2010).
  https://doi.org/10.1109/TMI.2010.2046908
- **antsBrainExtraction** — Avants BB et al. (2015).
  https://doi.org/10.1038/sdata.2015.3

- **FSL** — Jenkinson M et al. (2012). NeuroImage.
  https://doi.org/10.1016/j.neuroimage.2011.09.015
- **FAST** — Zhang Y et al. (2001).
  https://doi.org/10.1109/42.906424
- **BET** — Smith SM (2002).
  https://doi.org/10.1002/hbm.10062
- **FLIRT** — Jenkinson M et al. (2002).
  https://doi.org/10.1006/nimg.2002.1132
- **MCFLIRT** — Jenkinson M (2002).
  https://doi.org/10.1006/nimg.2002.1132

- **AFNI** — Cox RW (1996).
  https://doi.org/10.1006/cbmr.1996.0014

- **Connectome Workbench** — https://humanconnectome.org/software/connectome-workbench
- **MSM (Multimodal Surface Matching)** — Robinson EC et al. (2014, 2018).

### Confounds / motion

- **DVARS / Framewise Displacement** (Power et al. 2012, 2014):
  https://doi.org/10.1016/j.neuroimage.2011.10.018
- **DVARS improvements** — Afyouni & Nichols (2018):
  https://arxiv.org/abs/1704.01469
- **RMSD** — Jenkinson M et al. (2002):
  https://doi.org/10.1006/nimg.2002.1132
- **a/tCompCor** — Behzadi Y et al. (2007):
  https://doi.org/10.1016/j.neuroimage.2007.04.042
- **aCompCor refinement (WM/CSF split)** — Muschelli J et al. (2014):
  https://doi.org/10.1016/j.neuroimage.2014.03.028
- **Motion parameter expansion** — Satterthwaite TD et al. (2013):
  https://doi.org/10.1016/j.neuroimage.2012.08.052
- **Crown / brain-edge PCA** — Provins C et al. (2022):
  https://doi.org/10.31219/osf.io/hz52v; Patriat R et al. (2017):
  https://doi.org/10.1016/j.neuroimage.2016.08.051

### Analysis frameworks

- **Nipype** — Gorgolewski KJ et al. (2011):
  https://doi.org/10.3389/fninf.2011.00013 +
  https://doi.org/10.5281/zenodo.581704
- **Nilearn** — Abraham A et al. (2014):
  https://doi.org/10.3389/fninf.2014.00014
- **NiBabel** — Brett M et al.:
  https://doi.org/10.5281/zenodo.60808

### Templates / grayordinates

- **HCP fsLR / grayordinates** — Glasser MF et al. (2016):
  https://doi.org/10.1038/nature18933

### fMRIPrep-specific method notes

- **Slice-timing referenced middle of TR + Power motion recommendation** —
  Power JD et al. (2017):
  https://doi.org/10.1371/journal.pone.0182939
- **Lesion cost-function masking** — Brett M et al. (2001):
  https://doi.org/10.1006/nimg.2001.0845
- **Carpetplot QA** — Power JD (2016):
  https://doi.org/10.1016/j.neuroimage.2016.08.009

### Denoising strategy references (not cited by boilerplate but critical
for choosing confound strategy)

- **Ciric R et al. (2017)** — Benchmarking confound-regression strategies:
  https://doi.org/10.1016/j.neuroimage.2017.03.020
- **Parkes L et al. (2018)** — Evaluation of motion correction strategies:
  https://doi.org/10.1016/j.neuroimage.2017.12.073
- **Greve DN et al. (2013)** — Sources of noise in fMRI:
  https://doi.org/10.1007/s11336-013-9344-2

---

## Plagiarism disclaimer

Some journals' plagiarism detectors flag the auto-generated boilerplate
because it appears (verbatim) in many other papers. This is intentional and
recommended. If flagged, reply with a link to the transparency page:

> The methods text is the auto-generated fMRIPrep citation boilerplate,
> distributed as CC0 public-domain and intended to be used verbatim. See
> https://www.nipreps.org/intro/transparency/#citation-boilerplates.

---

## Where boilerplate lives in your outputs

```
<output_dir>/
    logs/
        CITATION.md          # Markdown — the canonical source
        CITATION.html        # Rendered HTML (embedded in the visual report)
        CITATION.tex         # LaTeX with proper citation commands
```

Also visible at the bottom of the visual report `sub-XX.html`.

The Markdown and LaTeX include full BibTeX-ready reference entries — copy
those into your bibliography manager.

---

## Funding acknowledgements (from the repo README)

If you rely on fMRIPrep, consider adding a funding acknowledgement to your
paper — this helps the maintainers secure continued support:

> This work uses the *fMRIPrep* preprocessing pipeline, which is steered and
> maintained by the NiPreps Community and supported by the Laura and John
> Arnold Foundation, the NIH (NBIB R01EB020740, PI: Ghosh; R24MH114705,
> R24MH117179, R01MH121867, PI: Poldrack), and CZI's Essential Open Source
> Software for Science.
