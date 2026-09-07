# Dataset marketplace research

Catalogue expansion reviewed: 2026-09-07 (older entries retain their original review scope)

This document records the initial catalogue behind BrainPilot's dataset market. It is product metadata, not a substitute for the provider's current license or data-use agreement. Before publishing work, users should verify the terms on the linked official page.

## Initial catalogue

| Dataset | Domain / modality | Access | Automated path | Important constraint |
|---|---|---|---|---|
| OpenNeuro ds000030 | BIDS MRI/fMRI, neuropsychiatry | Public | DataLad recursive install/get | Large Git-annex dataset; DataLad must be installed |
| OpenNeuro ds000114 | BIDS MRI/fMRI, test-retest | Public | DataLad recursive install/get | DataLad must be installed |
| DANDI 000021 | NWB / Neuropixels | Public | Version-pinned `dandi download` | 477.6 GB full release; details shown before download |
| DANDI 000026 | Human ex vivo MRI / microscopy | Public | Provider asset selection | Corrected identity; draft is ~38.46 TB, not a 70 GB Neuropixels collection |
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
- Job metadata is saved atomically in `<BP_DATA_DIR>/data/datasets/.jobs.json`. Two jobs run at once per backend data root; queued and active jobs can be cancelled. After an unexpected restart, interrupted jobs require an explicit retry; credentials are never restored from disk.

## Link verification

The official OpenNeuro, DANDI, PhysioNet EEG, BCI Competition, HCP, MIMIC-IV, Kaggle and NDA pages returned HTTP 200 during the review. ADNI's former deep link returned 404 and was replaced with its current data-samples landing page. UK Biobank and Allen web applications rejected or timed out for command-line probes, so their links should be checked periodically in a browser.

## Next catalogue priorities

1. Add provider API discovery and asset-level selection for Allen Brain Map and DANDI so users do not have to fetch an entire collection.
2. Add OpenNeuro snapshot selection and estimated download size from provider APIs.
3. Extend per-transfer HTTP free-space checks to CLI downloads and concurrent space reservations; add ETag/If-Range support for unversioned sources.
4. Expand by domain: epilepsy (iEEG.org), MEG (CamCAN/Open MEG Archive), microscopy (MICrONS), connectomics (FlyWire), sleep (Sleep-EDF), and neurodegeneration cohorts beyond ADNI.
5. Establish a quarterly review for URLs, release versions, sizes, licenses, authentication mechanisms and CLI syntax.



## September 2026 expansion and correction

New catalogue entries use official versioned sources. The review covers identity, access, formats, stated size and provider manifests; it does not certify suitability for every research question or evaluate model performance.

| Entry | Official source | Automated download | Quality / scope |
|---|---|---|---|
| Sleep-EDF Expanded | [PhysioNet 1.0.0](https://physionet.org/content/sleep-edfx/1.0.0/) | Resumable wget | PSG plus expert sleep-stage annotations, 8.1 GB |
| CHB-MIT | [PhysioNet 1.0.0](https://physionet.org/content/chbmit/1.0.0/) | Resumable wget | Seizure annotations, 42.6 GB; chb01 and chb21 share a participant |
| EEG Mental Arithmetic | [PhysioNet 1.0.0](https://physionet.org/content/eegmat/1.0.0/) | Resumable wget | Rest/task EEG and participant metadata, 175.1 MB |
| UCD Sleep Apnea | [PhysioNet 1.0.0](https://physionet.org/content/ucddb/1.0.0/) | Resumable wget | Sleep/respiratory-event annotations, 1.3 GB |
| ERP-based BCI | [PhysioNet 1.0.0](https://physionet.org/content/erpbci/1.0.0/) | Resumable wget | EDF+ and event annotations, 2.2 GB uncompressed |
| RSVP Target Detection | [PhysioNet 1.0.0](https://physionet.org/content/ltrsvp/1.0.0/) | Resumable wget | Stimulus and target annotations, 748.9 MB |
| MNE Sample | [MNE documentation](https://mne.tools/stable/documentation/datasets.html#sample) | Version-pinned HTTP archive | Tutorial MEG/EEG/MRI; acquisition-system evaluation excluded by provider |

PhysioNet entries link to their official SHA256SUMS.txt. Recursive wget downloads preserve those manifests; BrainPilot does not yet automatically hash every file in recursive collections. The MNE HTTP archive is automatically checked against the MD5 supplied by the [MNE dataset configuration](https://github.com/mne-tools/mne-python/blob/main/mne/datasets/config.py); this checks transfer integrity, not adversarial authenticity. No unverified file hashes are invented.

The previous DANDI 000026 entry conflated two collections. The [official 000026 metadata](https://api.dandiarchive.org/api/dandisets/000026/versions/draft/info/) identifies Human brain cell census for BA 44/45. Its ID is retained with corrected metadata and provider-managed selection. [Allen Visual Coding Neuropixels](https://dandiarchive.org/dandiset/000021/0.251116.2246) is now a separate entry with the correct ID and pinned release, so old local files are never silently reused for a different dataset.

### Validation

- `node scripts/test-expanded-datasets.mjs` downloads only the six provider manifests and one 1.3 MB EEG recording, validates SHA-256 after a full download and a resumed download, and checks the pinned DANDI identity. It removes temporary downloads on exit.
- Backend tests cover invalid/missing Content-Range, exact and mismatched HTTP 416 sizes, unknown lengths, truncated responses, checksum mismatches, and concurrent start deduplication.
- Round 2 adds fixed first-participant and verified sample selections, durable job history, cancellation, a two-job queue, and known-length HTTP free-space checks. Dynamic asset selection, CLI disk-space estimates, ETag/If-Range validation, and full-file hashing of recursive collections remain future work.


## Round 2: research coverage and usable subsets

The catalogue now has 48 entries, 37 automated full-download recipes, and 13 entries with a smaller selection. The 28 new entries cover 15 overlapping research topics across the complete catalogue:

- Learning and decisions: OpenNeuro ds000001, ds000002, ds000005.
- Cognitive control and memory: ds000008, ds000011, ds000102; DANDI 000003 and 000115.
- Natural language and sensory representations: ds000105, ds001246, ds002837; MNE Kiloword and mTRF.
- Development, affect and movement: ds000171, ds000228; PhysioNet gaitndd and gaitpdb; MNE somatosensory and fNIRS motor examples.
- Clinical and physiological signals: MNE epilepsy ECoG and SSVEP examples; PhysioNet drivedb and PTB-XL 1.0.3.
- Cell populations and brain/body interactions: DANDI 000409, 000728, 000350, 000233; 10x PBMC3k for single-cell workflow development. PBMC3k is blood tissue, not neural tissue.

OpenNeuro identities and licenses come from the official `OpenNeuroDatasets/<id>/dataset_description.json`. New DataLad recipes pin the recorded Git revision **before** `datalad get`. Nine of these entries offer the first participant listed in the corresponding pinned `participants.tsv`; shared stimulus assets may need a separate download. Each subset gets its own directory so it cannot be mistaken for a completed full dataset.

The four PhysioNet subsets pair signals with useful metadata: rest/arithmetic EEG plus subject information, one sleep night plus its hypnogram, one gait recording plus demographics, and one PTB-XL record plus diagnostic metadata. Every file in these subsets has a SHA-256 taken from the provider's versioned manifest. Whole-collection wget recipes still require separate checksum validation.

MNE examples use the URL, archive version and checksum in the [official dataset configuration](https://github.com/mne-tools/mne-python/blob/main/mne/datasets/config.py). They are described as examples, not full originating studies. The [10x PBMC3k source](https://www.10xgenomics.com/datasets/3-k-pbm-cs-from-a-healthy-donor-1-standard-1-1-0) identifies the tissue, detected cell count and CC BY 4.0 license. The [driving physiology documentation](https://physionet.org/content/drivedb/1.0.0/) explicitly states that subjective stress ratings are unavailable; the catalogue retains this limitation.

Large new DANDI entries use provider file selection and report draft size as approximate. This avoids launching tens of terabytes merely to inspect a new research question. Catalogue curation is evidence about identity and access, not an endorsement of data quality for every analysis.

### Reproducible smoke test

After building backend-core, run `node scripts/test-dataset-subsets.mjs`. The script downloads about 32 MB across EEG, gait, fNIRS and single-cell expression data; checks EEG headers, archive readability and saved job history; and cancels any outstanding work before deleting its temporary directory. It never fetches a full MRI or DANDI collection. A live DataLad/Annex transfer still needs separate validation on an environment with those tools installed.
