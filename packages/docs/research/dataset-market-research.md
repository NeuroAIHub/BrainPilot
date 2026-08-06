# Dataset marketplace research

Last reviewed: 2026-08-05

This document records the initial catalogue behind BrainPilot's dataset market. It is product metadata, not a substitute for the provider's current license or data-use agreement. Before publishing work, users should verify the terms on the linked official page.

## Initial catalogue

| Dataset | Domain / modality | Access | Automated path | Important constraint |
|---|---|---|---|---|
| OpenNeuro ds000030 | BIDS MRI/fMRI, neuropsychiatry | Public | DataLad recursive install/get | Large Git-annex dataset; DataLad must be installed |
| OpenNeuro ds000114 | BIDS MRI/fMRI, test-retest | Public | DataLad recursive install/get | DataLad must be installed |
| DANDI 000026 | NWB / Neuropixels | Public | `dandi download` | Download size depends on dandiset version and assets |
| EEG Motor Movement/Imagery | EEG motor imagery | Public | Resumable recursive `wget` | Preserve PhysioNet attribution and ODC-By terms |
| BCI Competition IV 2a | EEG motor imagery | Public archive | Direct HTTPS archive | Competition terms still apply |
| HCP Young Adult | Structural, diffusion, resting/task fMRI | Approved account | AWS S3 sync for one subject | HCP terms acceptance and issued credentials required |
| MIMIC-IV | Credentialed clinical records | Approved account | Authenticated recursive `wget` | CITI training and signed DUA required |
| HMS Harmful Brain Activity | EEG competition data | Kaggle account + rules | Kaggle CLI with ephemeral environment credentials | Competition rules must be accepted first |
| ADNI | MRI, biomarkers, genomics, clinical | Application | Provider-managed | No stable supported unattended bulk API was identified |
| UK Biobank Imaging | Population imaging/genomics | Paid application / RAP | Provider-managed | Export and local-download rules depend on project/RAP policy |
| ABCD Study | Developmental imaging/phenotypes | NDA application | Provider-managed | Institutional sponsorship and Data Use Certification required |
| Allen Cell Types | Electrophysiology, morphology, transcriptomics | Public | Provider/API selection | No single canonical archive; future work should add an AllenSDK selector |

## Product decisions

- The UI distinguishes `direct`, `credentials`, and `application` access. “Application” never implies that BrainPilot can bypass provider approval.
- Credentials live only in the POST request and downloader process environment/stdin. They are not included in job records, filesystem metadata, API responses, or error messages.
- Downloads are local-mode only and land in `<BP_DATA_DIR>/data/datasets/<dataset-id>`.
- Commands are fixed catalogue recipes executed without a shell. Users cannot submit executable command text.
- A missing provider CLI produces an actionable error naming the required tool.
- Job state is intentionally process-local in this first version. Downloaded files persist, but active/history status resets after a backend restart.

## Link verification

The official OpenNeuro, DANDI, PhysioNet EEG, BCI Competition, HCP, MIMIC-IV, Kaggle and NDA pages returned HTTP 200 during the review. ADNI's former deep link returned 404 and was replaced with its current data-samples landing page. UK Biobank and Allen web applications rejected or timed out for command-line probes, so their links should be checked periodically in a browser.

## Next catalogue priorities

1. Add provider API discovery and asset-level selection for Allen Brain Map and DANDI so users do not have to fetch an entire collection.
2. Add OpenNeuro snapshot selection and estimated download size from provider APIs.
3. Add resumable HTTP range downloads, checksum verification, cancellation, disk-quota preflight and persisted job history.
4. Expand by domain: epilepsy (iEEG.org), MEG (CamCAN/Open MEG Archive), microscopy (MICrONS), connectomics (FlyWire), sleep (Sleep-EDF), and neurodegeneration cohorts beyond ADNI.
5. Establish a quarterly review for URLs, release versions, sizes, licenses, authentication mechanisms and CLI syntax.

