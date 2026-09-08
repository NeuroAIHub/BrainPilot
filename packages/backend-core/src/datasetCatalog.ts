import type { DatasetCatalogEntry } from "./datasets.js";

const CORE_CATALOG: readonly DatasetCatalogEntry[] = [
  {
    id: "mne-sample", name: "MNE Sample — Auditory / Visual", provider: "MNE / OSF", modalities: ["MEG", "EEG", "MRI"],
    summary: "Simultaneous MEG/EEG with MRI reconstructions for learning source analysis.",
    description: "Auditory and visual evoked responses with anatomical reconstructions. Provided for learning MNE workflows; the provider excludes evaluation of the acquisition systems' performance.",
    license: "MNE sample data usage conditions", access: "direct",
    accessNote: "Public tutorial archive. Saved as tar.gz; extract before analysis. The archive is verified against MNE's published checksum.",
    homepage: "https://mne.tools/stable/documentation/datasets.html#sample",
    version: "OSF file version 6", formats: ["FIF", "FreeSurfer", "tar.gz"], tasks: ["Evoked responses", "Source localization"], reviewedAt: "2026-09-07",
    citation: "See the MNE dataset documentation for usage conditions and attribution.", tool: "BrainPilot HTTP downloader",
    downloadCommand: "curl -fL -C - -o MNE-sample-data-processed.tar.gz 'https://osf.io/download/86qa2?version=6'",
    recipe: { type: "http", url: "https://osf.io/download/86qa2?version=6", fileName: "MNE-sample-data-processed.tar.gz", checksum: { algorithm: "md5", value: "e8f30c4516abdc12a0c08e6bae57409c" } },
  },
  {
    id: "physionet-sleep-edfx", name: "Sleep-EDF Expanded", provider: "PhysioNet", modalities: ["EEG", "EOG", "EMG"],
    subjects: "197 overnight recordings",
    size: "8.1 GB", summary: "Sleep staging from polysomnography with expert-scored hypnograms.",
    description: "Includes sleep-cassette and sleep-telemetry studies. EEG and EOG signals accompany manual sleep-stage annotations; preserve the study and participant grouping when creating evaluation splits.",
    license: "ODC-By 1.0", access: "direct",
    accessNote: "Public versioned files. Requires wget. Sizes are uncompressed; retain the provider annotations and attribution.",
    homepage: "https://physionet.org/content/sleep-edfx/1.0.0/",
    citation: "Kemp et al. (2000); doi:10.13026/C2X676", version: "1.0.0", formats: ["EDF", "EDF+"], tasks: ["Sleep staging"],
    reviewedAt: "2026-09-07", checksumUrl: "https://physionet.org/files/sleep-edfx/1.0.0/SHA256SUMS.txt",
    tool: "wget", downloadCommand: "wget -r -N -c -np -nH --cut-dirs=3 https://physionet.org/files/sleep-edfx/1.0.0/",
    recipe: { type: "command", command: "wget", args: ["-r", "-N", "-c", "-np", "-nH", "--cut-dirs=3", "https://physionet.org/files/sleep-edfx/1.0.0/"] },
  },
  {
    id: "physionet-chbmit", name: "CHB-MIT Scalp EEG", provider: "PhysioNet", modalities: ["EEG", "Clinical"],
    subjects: "24 recording cases",
    size: "42.6 GB", summary: "Pediatric epilepsy EEG with annotated seizure onset and offset.",
    description: "Continuous scalp EEG with seizure annotations and recording summaries. Cases chb01 and chb21 belong to the same participant; account for this when constructing subject-independent splits.",
    license: "ODC-By 1.0", access: "direct",
    accessNote: "Public versioned files. Requires wget. Sizes are uncompressed; retain the provider annotations and attribution.",
    homepage: "https://physionet.org/content/chbmit/1.0.0/",
    citation: "Guttag (2010); doi:10.13026/C2K01R", version: "1.0.0", formats: ["EDF", "WFDB annotations"], tasks: ["Seizure detection"],
    reviewedAt: "2026-09-07", checksumUrl: "https://physionet.org/files/chbmit/1.0.0/SHA256SUMS.txt",
    tool: "wget", downloadCommand: "wget -r -N -c -np -nH --cut-dirs=3 https://physionet.org/files/chbmit/1.0.0/",
    recipe: { type: "command", command: "wget", args: ["-r", "-N", "-c", "-np", "-nH", "--cut-dirs=3", "https://physionet.org/files/chbmit/1.0.0/"] },
  },
  {
    id: "physionet-eegmat", name: "EEG During Mental Arithmetic", provider: "PhysioNet", modalities: ["EEG"],
    size: "175.1 MB", summary: "Resting and mental-arithmetic EEG for cognitive workload analysis.",
    description: "EEG recordings before and during serial subtraction, with participant information and task-performance metadata.",
    license: "ODC-By 1.0", access: "direct",
    accessNote: "Public versioned files. Requires wget. Sizes are uncompressed; retain the provider annotations and attribution.",
    homepage: "https://physionet.org/content/eegmat/1.0.0/",
    citation: "doi:10.13026/C2JQ1P", version: "1.0.0", formats: ["EDF", "CSV"], tasks: ["Cognitive workload"],
    reviewedAt: "2026-09-07", checksumUrl: "https://physionet.org/files/eegmat/1.0.0/SHA256SUMS.txt",
    tool: "wget", downloadCommand: "wget -r -N -c -np -nH --cut-dirs=3 https://physionet.org/files/eegmat/1.0.0/",
    recipe: { type: "command", command: "wget", args: ["-r", "-N", "-c", "-np", "-nH", "--cut-dirs=3", "https://physionet.org/files/eegmat/1.0.0/"] },
  },
  {
    id: "physionet-ucddb", name: "UCD Sleep Apnea", provider: "PhysioNet", modalities: ["EEG", "EOG", "EMG", "Clinical"],
    subjects: "25 recordings",
    size: "1.3 GB", summary: "Overnight polysomnography with sleep and respiratory-event annotations.",
    description: "Multichannel overnight sleep recordings for studying sleep-disordered breathing; consult the provider documentation for channel definitions and annotation conventions.",
    license: "ODC-By 1.0", access: "direct",
    accessNote: "Public versioned files. Requires wget. Sizes are uncompressed; retain the provider annotations and attribution.",
    homepage: "https://physionet.org/content/ucddb/1.0.0/",
    citation: "doi:10.13026/C26C7D", version: "1.0.0", formats: ["EDF"], tasks: ["Sleep apnea", "Sleep staging"],
    reviewedAt: "2026-09-07", checksumUrl: "https://physionet.org/files/ucddb/1.0.0/SHA256SUMS.txt",
    tool: "wget", downloadCommand: "wget -r -N -c -np -nH --cut-dirs=3 https://physionet.org/files/ucddb/1.0.0/",
    recipe: { type: "command", command: "wget", args: ["-r", "-N", "-c", "-np", "-nH", "--cut-dirs=3", "https://physionet.org/files/ucddb/1.0.0/"] },
  },
  {
    id: "physionet-erpbci", name: "ERP-based BCI Recordings", provider: "PhysioNet", modalities: ["EEG", "EOG"],
    size: "2.2 GB", summary: "Annotated EEG and EOG during a P300 matrix-speller task.",
    description: "Matrix-speller recordings include target characters and stimulus timing for ERP decoding and BCI research. Read the provider annotations before defining trials.",
    license: "ODC-By 1.0", access: "direct",
    accessNote: "Public versioned files. Requires wget. Sizes are uncompressed; retain the provider annotations and attribution.",
    homepage: "https://physionet.org/content/erpbci/1.0.0/",
    citation: "Citi, Poli and Cinel (2010); doi:10.13026/C2101S", version: "1.0.0", formats: ["EDF+", "WFDB annotations"], tasks: ["P300", "BCI"],
    reviewedAt: "2026-09-07", checksumUrl: "https://physionet.org/files/erpbci/1.0.0/SHA256SUMS.txt",
    tool: "wget", downloadCommand: "wget -r -N -c -np -nH --cut-dirs=3 https://physionet.org/files/erpbci/1.0.0/",
    recipe: { type: "command", command: "wget", args: ["-r", "-N", "-c", "-np", "-nH", "--cut-dirs=3", "https://physionet.org/files/erpbci/1.0.0/"] },
  },
  {
    id: "physionet-ltrsvp", name: "EEG RSVP Target Detection", provider: "PhysioNet", modalities: ["EEG"],
    subjects: "11 participants",
    size: "748.9 MB", summary: "Visual target detection at three rapid image-presentation rates.",
    description: "Eight-channel EEG includes stimulus onset, target labels and target positions for RSVP-based brain-computer interfaces.",
    license: "ODC-By 1.0", access: "direct",
    accessNote: "Public versioned files. Requires wget. Sizes are uncompressed; retain the provider annotations and attribution.",
    homepage: "https://physionet.org/content/ltrsvp/1.0.0/",
    citation: "Matran-Fernandez and Poli (2017); doi:10.13026/C2KX0P", version: "1.0.0", formats: ["EDF"], tasks: ["RSVP", "BCI", "Target detection"],
    reviewedAt: "2026-09-07", checksumUrl: "https://physionet.org/files/ltrsvp/1.0.0/SHA256SUMS.txt",
    tool: "wget", downloadCommand: "wget -r -N -c -np -nH --cut-dirs=3 https://physionet.org/files/ltrsvp/1.0.0/",
    recipe: { type: "command", command: "wget", args: ["-r", "-N", "-c", "-np", "-nH", "--cut-dirs=3", "https://physionet.org/files/ltrsvp/1.0.0/"] },
  },
  {
    id: "openneuro-ds000030", name: "OpenNeuro ds000030", provider: "OpenNeuro", modalities: ["fMRI", "MRI"], subjects: "272 participants", size: "~80 GB",
    summary: "UCLA Consortium for Neuropsychiatric Phenomics dataset in BIDS format.",
    description: "Structural, functional and phenotypic data spanning healthy controls and several neuropsychiatric cohorts. A useful public benchmark for BIDS/fMRI workflows.",
    license: "CC0", access: "direct", accessNote: "Public. DataLad is used so interrupted downloads can resume.", homepage: "https://openneuro.org/datasets/ds000030",
    citation: "Poldrack et al., Scientific Data (2016)", tool: "datalad",
    downloadCommand: "datalad install -r -g -s https://github.com/OpenNeuroDatasets/ds000030.git .",
    recipe: { type: "datalad", repository: "https://github.com/OpenNeuroDatasets/ds000030.git" },
  },
  {
    id: "openneuro-ds000114", name: "OpenNeuro ds000114", provider: "OpenNeuro", modalities: ["fMRI", "MRI"], subjects: "10 participants", size: "~7 GB",
    summary: "Test-retest motor, language and emotion task fMRI dataset.",
    description: "A compact BIDS dataset commonly used to test preprocessing and reproducibility pipelines across repeated acquisitions.",
    license: "CC0", access: "direct", accessNote: "Public. Requires DataLad.", homepage: "https://openneuro.org/datasets/ds000114", tool: "datalad",
    downloadCommand: "datalad install -r -g -s https://github.com/OpenNeuroDatasets/ds000114.git .",
    recipe: { type: "datalad", repository: "https://github.com/OpenNeuroDatasets/ds000114.git" },
  },
  {
    id: "dandi-000021", name: "Allen Visual Coding — Neuropixels", provider: "DANDI Archive", modalities: ["NWB", "Neuropixels"], subjects: "32 mice", size: "477.6 GB",
    summary: "Mouse extracellular electrophysiology from the Allen Brain Observatory stimulus set.",
    description: "Visual coding recordings in NWB, including units and local field potentials. The pinned Dandiset release contains 214 assets.",
    license: "CC BY 4.0; Allen Institute Terms of Use", access: "direct",
    accessNote: "Requires the dandi CLI and space for the entire 477.6 GB release. Open the provider to select individual assets for smaller downloads.",
    homepage: "https://dandiarchive.org/dandiset/000021/0.251116.2246", tool: "dandi", version: "0.251116.2246",
    formats: ["NWB"], tasks: ["Visual coding", "Spike analysis"], reviewedAt: "2026-09-07", downloadReviewRequired: true,
    downloadCommand: "dandi download --format PYOUT --path-type EXACT --existing REFRESH --output-dir . https://dandiarchive.org/dandiset/000021/0.251116.2246",
    recipe: { type: "command", command: "dandi", args: ["download", "--format", "PYOUT", "--path-type", "EXACT", "--existing", "REFRESH", "--output-dir", ".", "https://dandiarchive.org/dandiset/000021/0.251116.2246"] },
  },
  {
    id: "dandi-000026", name: "Human Brain Cell Census — BA 44/45", provider: "DANDI Archive", modalities: ["MRI", "Microscopy"], size: "~38.46 TB (draft)",
    summary: "Ex vivo human brain MRI and microscopy for a cellular atlas of Broca's area.",
    description: "Human cortical imaging with MRI, OCT and light-sheet microscopy. This is DANDI 000026; Allen Visual Coding Neuropixels is DANDI 000021.",
    license: "CC BY 4.0", access: "direct", accessNote: "Select assets on DANDI. The draft collection is tens of terabytes and changes over time; BrainPilot does not start an unattended whole-collection download.",
    homepage: "https://dandiarchive.org/dandiset/000026/draft", version: "draft", reviewedAt: "2026-09-07",
    tasks: ["Cell census", "Human brain atlas"],
  },
  {
    id: "physionet-eegmmidb", name: "EEG Motor Movement/Imagery", provider: "PhysioNet", modalities: ["EEG"], subjects: "109 participants", size: "~3.4 GB",
    summary: "64-channel EEG recorded during motor execution and motor imagery tasks.",
    description: "A widely used EEG benchmark with more than 1,500 recordings and standardized EDF files.",
    license: "ODC-By 1.0", access: "direct", accessNote: "Public. Requires wget for recursive, resumable download.", homepage: "https://physionet.org/content/eegmmidb/1.0.0/", tool: "wget",
    downloadCommand: "wget -r -N -c -np --cut-dirs=3 https://physionet.org/files/eegmmidb/1.0.0/",
    recipe: { type: "command", command: "wget", args: ["-r", "-N", "-c", "-np", "--cut-dirs=3", "https://physionet.org/files/eegmmidb/1.0.0/"] },
  },
  {
    id: "bci-competition-iv-2a", name: "BCI Competition IV 2a", provider: "BCI Competition", modalities: ["EEG"], subjects: "9 participants", size: "~420 MB",
    summary: "Four-class motor-imagery EEG benchmark distributed as a GDF archive.",
    description: "The canonical 22-channel motor imagery signal archive used to compare EEG decoding algorithms.",
    license: "Competition terms", access: "direct", accessNote: "Public archive; review the competition terms before publication.", homepage: "https://www.bbci.de/competition/iv/",
    tool: "BrainPilot HTTP downloader", downloadCommand: "curl -fL -C - -o BCICIV_2a_gdf.zip https://www.bbci.de/competition/download/competition_iv/BCICIV_2a_gdf.zip",
    recipe: { type: "http", url: "https://www.bbci.de/competition/download/competition_iv/BCICIV_2a_gdf.zip", fileName: "BCICIV_2a_gdf.zip" },
  },
  {
    id: "hcp-young-adult", name: "Human Connectome Project — Young Adult", provider: "ConnectomeDB", modalities: ["fMRI", "MRI"], subjects: "1,200 participants", size: ">80 TB",
    summary: "High-resolution structural, resting-state, task-fMRI and diffusion MRI.",
    description: "The flagship HCP young-adult release. Users must accept the HCP data-use terms before obtaining S3 credentials.",
    license: "HCP Open Access Data Use Terms", access: "application", accessNote: "Approval and terms acceptance are required. After approval, AWS credentials can drive an automatic S3 sync.", homepage: "https://www.humanconnectome.org/study/hcp-young-adult/document/1200-subjects-data-release",
    tool: "aws", credentialFields: [
      { id: "awsAccessKeyId", label: "AWS access key ID", required: true },
      { id: "awsSecretAccessKey", label: "AWS secret access key", secret: true, required: true },
      { id: "awsSessionToken", label: "AWS session token (if issued)", secret: true },
      { id: "subject", label: "HCP subject ID", required: true, help: "For example: 100206" },
    ],
    recipe: { type: "command", command: "aws", args: ["s3", "sync", "s3://hcp-openaccess/HCP_1200/{{subject}}", "."], env: { AWS_ACCESS_KEY_ID: "awsAccessKeyId", AWS_SECRET_ACCESS_KEY: "awsSecretAccessKey", AWS_SESSION_TOKEN: "awsSessionToken" } },
  },
  {
    id: "mimic-iv", name: "MIMIC-IV", provider: "PhysioNet", modalities: ["Clinical"], subjects: ">300,000 patients", size: "~120 GB",
    summary: "Deidentified hospital and ICU electronic health records.",
    description: "A major clinical benchmark. Credentialed access requires CITI training, a data-use agreement and approval on PhysioNet.",
    license: "PhysioNet Credentialed Health Data License", access: "application", accessNote: "Complete PhysioNet credentialing first; then enter the approved account credentials.", homepage: "https://physionet.org/content/mimiciv/3.1/",
    tool: "wget", credentialFields: [{ id: "username", label: "PhysioNet username", required: true }, { id: "password", label: "PhysioNet password", secret: true, required: true }],
    recipe: { type: "command", command: "wget", args: ["-r", "-N", "-c", "-np", "--cut-dirs=3", "https://physionet.org/files/mimiciv/3.1/"], env: { WGETRC: "__stdin__" }, stdin: "user={{username}}\npassword={{password}}\n" },
  },
  {
    id: "kaggle-hms", name: "HMS Harmful Brain Activity", provider: "Kaggle", modalities: ["EEG"], size: "~28 GB",
    summary: "EEG spectrograms labeled for seizures and other harmful brain activity.",
    description: "Competition dataset for classifying seizures, generalized periodic discharges and related EEG patterns.",
    license: "Kaggle competition rules", access: "credentials", accessNote: "Accept the competition rules on Kaggle, then provide an API username and token.", homepage: "https://www.kaggle.com/competitions/hms-harmful-brain-activity-classification/data", tool: "kaggle",
    credentialFields: [{ id: "username", label: "Kaggle username", required: true }, { id: "token", label: "Kaggle API token", secret: true, required: true }],
    recipe: { type: "command", command: "kaggle", args: ["competitions", "download", "-c", "hms-harmful-brain-activity-classification", "-p", "."], env: { KAGGLE_USERNAME: "username", KAGGLE_KEY: "token" } },
  },
  {
    id: "adni", name: "Alzheimer's Disease Neuroimaging Initiative", provider: "LONI IDA", modalities: ["MRI", "Genomics", "Clinical"], subjects: ">2,500 participants", size: "Multi-terabyte",
    summary: "Longitudinal imaging, biomarkers, genetics and clinical assessments for AD.",
    description: "A foundational Alzheimer's disease cohort. Access is governed through LONI IDA and dataset-specific use agreements.",
    license: "ADNI Data Use Agreement", access: "application", accessNote: "Application approval is required. LONI does not expose a stable unattended bulk-download API, so downloads remain provider-managed.", homepage: "https://adni.loni.usc.edu/data-samples/",
  },
  {
    id: "uk-biobank-imaging", name: "UK Biobank Imaging", provider: "UK Biobank", modalities: ["fMRI", "MRI", "Genomics", "Clinical"], subjects: ">100,000 imaged participants", size: "Petabyte scale",
    summary: "Population-scale multimodal imaging linked to genetics and phenotypes.",
    description: "A uniquely broad longitudinal resource available only to approved research projects through the UK Biobank RAP.",
    license: "UK Biobank Material Transfer Agreement", access: "application", accessNote: "A paid, approved research application and RAP access are required; downloading outside RAP may be restricted.", homepage: "https://www.ukbiobank.ac.uk/enable-your-research/apply-for-access",
  },
  {
    id: "abcd", name: "ABCD Study", provider: "NIMH Data Archive", modalities: ["fMRI", "MRI", "Genomics", "Clinical"], subjects: "~12,000 participants", size: "Multi-terabyte",
    summary: "Longitudinal adolescent brain, behavior, environment and health data.",
    description: "A major US developmental cohort with multimodal imaging and extensive phenotyping.",
    license: "NDA Data Use Certification", access: "application", accessNote: "NDA account, institutional sponsorship and an approved Data Use Certification are required.", homepage: "https://nda.nih.gov/abcd",
  },
  {
    id: "allen-cell-types", name: "Allen Cell Types Database", provider: "Allen Institute", modalities: ["NWB", "Genomics"], size: "Varies by selection",
    summary: "Morphology, electrophysiology and transcriptomics from human and mouse cells.",
    description: "Public single-cell characterization data suitable for cell taxonomy and biophysical modeling.",
    license: "Allen Institute Terms of Use", access: "direct", accessNote: "Public. Use the AllenSDK/API to select cells; there is no single canonical archive to fetch safely.", homepage: "https://celltypes.brain-map.org/",
  },
];


const DISCOVERY: Record<string, Partial<DatasetCatalogEntry>> = {
  "mne-sample": {
    "domains": [
      "sensory"
    ],
    "species": "human",
    "summaryZh": "MEG、EEG 与 MRI 配套的听觉/视觉源定位示例。",
    "researchQuestions": [
      {
        "en": "How can evoked responses be localized?",
        "zh": "如何对听觉和视觉诱发反应进行源定位？"
      }
    ],
    "accessNoteZh": "公开教学归档，下载后需解压；系统会核对提供方校验值。该数据不应用于评估 MEG 或 MRI 采集系统的性能。"
  },
  "physionet-sleep-edfx": {
    "domains": [
      "sleep"
    ],
    "species": "human",
    "summaryZh": "包含专家睡眠分期标注的整夜多导睡眠记录。",
    "researchQuestions": [
      {
        "en": "How do signals vary across sleep stages?",
        "zh": "不同睡眠阶段的脑电特征有何差异？"
      }
    ],
    "accessNoteZh": "公开版本化数据。完整下载需要 wget；可先选择一晚记录及标注，示例文件会逐一验证 SHA-256。"
  },
  "physionet-chbmit": {
    "domains": [
      "clinical"
    ],
    "species": "human",
    "summaryZh": "儿童癫痫头皮 EEG，含发作起止标注。",
    "researchQuestions": [
      {
        "en": "Can seizure onsets be detected from EEG?",
        "zh": "如何从 EEG 检测癫痫发作起点？"
      }
    ],
    "accessNoteZh": "公开版本化数据，完整下载需要 wget。请保留发作标注，并按被试划分评估数据。"
  },
  "physionet-eegmat": {
    "domains": [
      "cognition"
    ],
    "species": "human",
    "summaryZh": "静息与心算任务 EEG，附参与者及任务表现信息。",
    "researchQuestions": [
      {
        "en": "How does mental arithmetic change EEG?",
        "zh": "心算负荷如何影响脑电活动？"
      }
    ],
    "accessNoteZh": "公开版本化数据。完整下载需要 wget；可先选择静息与心算配对示例，文件会逐一验证 SHA-256。"
  },
  "physionet-ucddb": {
    "domains": [
      "sleep"
    ],
    "species": "human",
    "summaryZh": "包含睡眠与呼吸事件标注的夜间多导生理记录。",
    "researchQuestions": [
      {
        "en": "How do respiratory events relate to sleep?",
        "zh": "呼吸事件与睡眠阶段如何关联？"
      }
    ],
    "accessNoteZh": "公开版本化数据，完整下载需要 wget；请参考提供方的通道与标注定义。"
  },
  "physionet-erpbci": {
    "domains": [
      "bci"
    ],
    "species": "human",
    "summaryZh": "P300 矩阵拼写任务的 EEG、EOG 及刺激事件标注。",
    "researchQuestions": [
      {
        "en": "How can target characters be decoded?",
        "zh": "如何从 P300 反应解码目标字符？"
      }
    ],
    "accessNoteZh": "公开版本化数据，完整下载需要 wget；任务事件位于 EDF+ 与配套标注中。"
  },
  "physionet-ltrsvp": {
    "domains": [
      "bci"
    ],
    "species": "human",
    "summaryZh": "快速视觉呈现任务 EEG，包含刺激和目标位置标注。",
    "researchQuestions": [
      {
        "en": "How can visual targets be detected from EEG?",
        "zh": "如何从 EEG 识别快速呈现的视觉目标？"
      }
    ],
    "accessNoteZh": "公开版本化数据，完整下载需要 wget；请保留刺激、目标和位置标注。"
  },
  "openneuro-ds000030": {
    "domains": [
      "clinical"
    ],
    "species": "human",
    "summaryZh": "包含多个精神神经疾病队列的 BIDS 结构及功能影像。",
    "researchQuestions": [
      {
        "en": "How do imaging measures differ across cohorts?",
        "zh": "不同临床队列的影像指标有何差异？"
      }
    ],
    "accessNoteZh": "公开 BIDS 数据；需要 DataLad 和 git-annex，完整数据体积较大。"
  },
  "openneuro-ds000114": {
    "domains": [
      "methods"
    ],
    "species": "human",
    "summaryZh": "运动、语言和情绪任务的重复测量 fMRI 数据。",
    "researchQuestions": [
      {
        "en": "How reproducible are task fMRI measurements?",
        "zh": "任务 fMRI 指标的重测可靠性如何？"
      }
    ],
    "accessNoteZh": "公开 BIDS 数据；需要 DataLad 和 git-annex。"
  },
  "dandi-000021": {
    "domains": [
      "circuits"
    ],
    "species": "mouse",
    "summaryZh": "Allen 视觉编码 Neuropixels 数据，包含单位放电与局部场电位。",
    "researchQuestions": [
      {
        "en": "How do neurons encode visual stimuli?",
        "zh": "神经元如何编码视觉刺激？"
      }
    ],
    "accessNoteZh": "完整下载需要 dandi CLI 和约 477.6 GB 空间。若只需要部分记录，请在 DANDI 页面选择文件。"
  },
  "dandi-000026": {
    "domains": [
      "molecular"
    ],
    "species": "human",
    "summaryZh": "人脑离体 MRI 和显微成像，用于细胞图谱研究。",
    "researchQuestions": [
      {
        "en": "How is human cortical cellular structure organized?",
        "zh": "人类皮层的细胞结构如何组织？"
      }
    ],
    "accessNoteZh": "该草稿集合约数十 TB 且仍可能变化。请在 DANDI 选择所需文件，BrainPilot 不直接启动整库下载。"
  },
  "physionet-eegmmidb": {
    "domains": [
      "bci"
    ],
    "species": "human",
    "summaryZh": "64 通道运动执行和运动想象 EEG。",
    "researchQuestions": [
      {
        "en": "How can imagined movements be decoded?",
        "zh": "如何解码运动想象？"
      }
    ],
    "accessNoteZh": "公开 EEG 数据；需要 wget 进行可续传的递归下载。"
  },
  "bci-competition-iv-2a": {
    "domains": [
      "bci"
    ],
    "species": "human",
    "summaryZh": "四分类运动想象 EEG 的 GDF 信号归档。",
    "researchQuestions": [
      {
        "en": "How well does motor imagery decoding generalize?",
        "zh": "运动想象解码如何跨被试泛化？"
      }
    ],
    "accessNoteZh": "公开 GDF 归档；发表研究前请阅读 BCI Competition 的使用条款。"
  },
  "hcp-young-adult": {
    "domains": [
      "connectivity"
    ],
    "species": "human",
    "summaryZh": "青年人群的结构、扩散、静息态及任务 fMRI。",
    "researchQuestions": [
      {
        "en": "How does brain connectivity relate to behavior?",
        "zh": "脑连接模式与行为表现如何关联？"
      }
    ],
    "accessNoteZh": "先完成 HCP 条款接受与访问审批，再提供 AWS 凭据；按所填被试 ID 下载。"
  },
  "mimic-iv": {
    "domains": [
      "clinical"
    ],
    "species": "human",
    "summaryZh": "需授权的去标识化医院及 ICU 临床记录。",
    "researchQuestions": [
      {
        "en": "How can clinical trajectories be modeled?",
        "zh": "如何对临床病程进行建模？"
      }
    ],
    "accessNoteZh": "需先完成 PhysioNet 认证、CITI 培训和数据使用协议，再使用获批账户凭据。"
  },
  "kaggle-hms": {
    "domains": [
      "clinical"
    ],
    "species": "human",
    "summaryZh": "用于识别癫痫及其他有害脑活动的 EEG 竞赛数据。",
    "researchQuestions": [
      {
        "en": "How can abnormal EEG patterns be classified?",
        "zh": "如何分类异常脑电模式？"
      }
    ],
    "accessNoteZh": "先在 Kaggle 接受竞赛规则，再提供 API 用户名和令牌。"
  },
  "adni": {
    "domains": [
      "lifespan"
    ],
    "species": "human",
    "summaryZh": "阿尔茨海默病纵向影像、生物标志物、遗传及临床资料。",
    "researchQuestions": [
      {
        "en": "How do biomarkers change during neurodegeneration?",
        "zh": "神经退行过程中生物标志物如何变化？"
      }
    ],
    "accessNoteZh": "需要获得 LONI IDA 访问审批；请通过提供方页面选择并下载数据。"
  },
  "uk-biobank-imaging": {
    "domains": [
      "lifespan"
    ],
    "species": "human",
    "summaryZh": "与遗传及表型关联的大规模人群影像。",
    "researchQuestions": [
      {
        "en": "How do brain measures relate to aging and health?",
        "zh": "脑影像指标如何关联衰老与健康？"
      }
    ],
    "accessNoteZh": "需要获批的付费研究项目和 RAP 访问权限；本地导出规则以项目与 RAP 政策为准。"
  },
  "abcd": {
    "domains": [
      "lifespan"
    ],
    "species": "human",
    "summaryZh": "青少年脑、行为、环境和健康的纵向队列。",
    "researchQuestions": [
      {
        "en": "How do brain and behavior develop in adolescence?",
        "zh": "青春期脑与行为如何共同发展？"
      }
    ],
    "accessNoteZh": "需要 NDA 账户、机构支持和获批的数据使用认证。"
  },
  "allen-cell-types": {
    "domains": [
      "molecular"
    ],
    "species": "mixed",
    "summaryZh": "人和小鼠细胞的形态、电生理及转录组资源。",
    "researchQuestions": [
      {
        "en": "How do cell types differ in structure and physiology?",
        "zh": "细胞类型的形态和生理特征有何差异？"
      }
    ],
    "accessNoteZh": "公开资源；请通过 AllenSDK 或提供方 API 选择细胞，当前不提供整库归档下载。"
  }
};

const EXPANDED_CATALOG: DatasetCatalogEntry[] = [
  {
    "id": "openneuro-ds000001",
    "name": "Balloon Analog Risk-taking Task",
    "provider": "OpenNeuro",
    "modalities": [
      "fMRI",
      "MRI"
    ],
    "summary": "Risk taking in the balloon analogue task.",
    "summaryZh": "气球模拟风险任务的 fMRI 数据。",
    "description": "Risk taking in the balloon analogue task. BIDS metadata and task events are included; consult the study documentation before defining analysis contrasts.",
    "domains": [
      "learning"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "How does risk taking relate to brain activity?",
        "zh": "风险决策如何关联脑活动？"
      }
    ],
    "license": "CC0",
    "access": "direct",
    "accessNote": "Requires DataLad and git-annex. Downloads the full dataset at the recorded Git revision; size varies by collection.",
    "homepage": "https://openneuro.org/datasets/ds000001",
    "citation": "10.18112/openneuro.ds000001.v1.0.0",
    "version": "Git f8e27ac909e5",
    "formats": [
      "BIDS",
      "NIfTI",
      "TSV"
    ],
    "reviewedAt": "2026-09-07",
    "downloadReviewRequired": true,
    "tool": "datalad",
    "downloadCommand": "datalad install -s https://github.com/OpenNeuroDatasets/ds000001.git . && git checkout f8e27ac909e50b5b5e311f6be271f0b1757ebb7b && datalad get -r .",
    "recipe": {
      "type": "datalad",
      "repository": "https://github.com/OpenNeuroDatasets/ds000001.git",
      "revision": "f8e27ac909e50b5b5e311f6be271f0b1757ebb7b"
    },
    "downloadOptions": [
      {
        "id": "first-participant",
        "label": "One participant: sub-01",
        "labelZh": "单个被试：sub-01",
        "description": "Fetch this participant plus repository metadata. This is a subset for inspecting the data, not the complete study. Shared stimulus assets may require a separate download.",
        "descriptionZh": "获取此被试及仓库元数据，用于检查数据结构；不代表完整研究队列。共享刺激文件可能需要另行获取。",
        "recipe": {
          "type": "datalad",
          "repository": "https://github.com/OpenNeuroDatasets/ds000001.git",
          "revision": "f8e27ac909e50b5b5e311f6be271f0b1757ebb7b",
          "paths": [
            "sub-01"
          ]
        }
      }
    ],
    "accessNoteZh": "需要 DataLad 和 git-annex；下载固定到目录记录的 Git 版本。完整数据的体积因研究而异。"
  },
  {
    "id": "openneuro-ds000002",
    "name": "Classification learning",
    "provider": "OpenNeuro",
    "modalities": [
      "fMRI",
      "MRI"
    ],
    "summary": "Classification-learning fMRI with repeated measurements.",
    "summaryZh": "分类学习及重复测量 fMRI。",
    "description": "Classification-learning fMRI with repeated measurements. BIDS metadata and task events are included; consult the study documentation before defining analysis contrasts.",
    "domains": [
      "learning"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "How stable are neural responses during learning?",
        "zh": "学习中的神经反应有多稳定？"
      }
    ],
    "license": "PDDL 1.0",
    "access": "direct",
    "accessNote": "Requires DataLad and git-annex. Downloads the full dataset at the recorded Git revision; size varies by collection.",
    "homepage": "https://openneuro.org/datasets/ds000002",
    "citation": "Aron, A.R., Gluck, M.A., Poldrack, R.A. (2006). Long-term test-retest reliability of functional MRI in a classification learning task. Neuroimage, 29(3):1000-6",
    "version": "Git eeb195ca5065",
    "formats": [
      "BIDS",
      "NIfTI",
      "TSV"
    ],
    "reviewedAt": "2026-09-07",
    "downloadReviewRequired": true,
    "tool": "datalad",
    "downloadCommand": "datalad install -s https://github.com/OpenNeuroDatasets/ds000002.git . && git checkout eeb195ca5065e926b08d87aa16ff0eb22be46ed3 && datalad get -r .",
    "recipe": {
      "type": "datalad",
      "repository": "https://github.com/OpenNeuroDatasets/ds000002.git",
      "revision": "eeb195ca5065e926b08d87aa16ff0eb22be46ed3"
    },
    "downloadOptions": [
      {
        "id": "first-participant",
        "label": "One participant: sub-01",
        "labelZh": "单个被试：sub-01",
        "description": "Fetch this participant plus repository metadata. This is a subset for inspecting the data, not the complete study. Shared stimulus assets may require a separate download.",
        "descriptionZh": "获取此被试及仓库元数据，用于检查数据结构；不代表完整研究队列。共享刺激文件可能需要另行获取。",
        "recipe": {
          "type": "datalad",
          "repository": "https://github.com/OpenNeuroDatasets/ds000002.git",
          "revision": "eeb195ca5065e926b08d87aa16ff0eb22be46ed3",
          "paths": [
            "sub-01"
          ]
        }
      }
    ],
    "accessNoteZh": "需要 DataLad 和 git-annex；下载固定到目录记录的 Git 版本。完整数据的体积因研究而异。"
  },
  {
    "id": "openneuro-ds000005",
    "name": "Mixed-gambles task",
    "provider": "OpenNeuro",
    "modalities": [
      "fMRI",
      "MRI"
    ],
    "summary": "Mixed-gamble decisions for studying gains and losses.",
    "summaryZh": "用于研究收益与损失决策的混合赌博任务。",
    "description": "Mixed-gamble decisions for studying gains and losses. BIDS metadata and task events are included; consult the study documentation before defining analysis contrasts.",
    "domains": [
      "learning"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "How do gains and losses shape decisions?",
        "zh": "收益和损失如何影响决策？"
      }
    ],
    "license": "PDDL 1.0",
    "access": "direct",
    "accessNote": "Requires DataLad and git-annex. Downloads the full dataset at the recorded Git revision; size varies by collection.",
    "homepage": "https://openneuro.org/datasets/ds000005",
    "citation": "Tom, S.M., Fox, C.R., Trepel, C., Poldrack, R.A. (2007). The neural basis of loss aversion in decision-making under risk. Science, 315(5811):515-8",
    "version": "Git b094fc2f4148",
    "formats": [
      "BIDS",
      "NIfTI",
      "TSV"
    ],
    "reviewedAt": "2026-09-07",
    "downloadReviewRequired": true,
    "tool": "datalad",
    "downloadCommand": "datalad install -s https://github.com/OpenNeuroDatasets/ds000005.git . && git checkout b094fc2f41487f92d382a1a432165ae58caae386 && datalad get -r .",
    "recipe": {
      "type": "datalad",
      "repository": "https://github.com/OpenNeuroDatasets/ds000005.git",
      "revision": "b094fc2f41487f92d382a1a432165ae58caae386"
    },
    "downloadOptions": [
      {
        "id": "first-participant",
        "label": "One participant: sub-01",
        "labelZh": "单个被试：sub-01",
        "description": "Fetch this participant plus repository metadata. This is a subset for inspecting the data, not the complete study. Shared stimulus assets may require a separate download.",
        "descriptionZh": "获取此被试及仓库元数据，用于检查数据结构；不代表完整研究队列。共享刺激文件可能需要另行获取。",
        "recipe": {
          "type": "datalad",
          "repository": "https://github.com/OpenNeuroDatasets/ds000005.git",
          "revision": "b094fc2f41487f92d382a1a432165ae58caae386",
          "paths": [
            "sub-01"
          ]
        }
      }
    ],
    "accessNoteZh": "需要 DataLad 和 git-annex；下载固定到目录记录的 Git 版本。完整数据的体积因研究而异。"
  },
  {
    "id": "openneuro-ds000008",
    "name": "Stop-signal task with unconditional and conditional stopping",
    "provider": "OpenNeuro",
    "modalities": [
      "fMRI",
      "MRI"
    ],
    "summary": "Conditional and unconditional stopping in a stop-signal task.",
    "summaryZh": "停止信号任务中的条件与无条件反应抑制。",
    "description": "Conditional and unconditional stopping in a stop-signal task. BIDS metadata and task events are included; consult the study documentation before defining analysis contrasts.",
    "domains": [
      "cognition"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "How does context affect response inhibition?",
        "zh": "情境如何影响反应抑制？"
      }
    ],
    "license": "PDDL 1.0",
    "access": "direct",
    "accessNote": "Requires DataLad and git-annex. Downloads the full dataset at the recorded Git revision; size varies by collection.",
    "homepage": "https://openneuro.org/datasets/ds000008",
    "citation": "Aron, A.R., Behrens, T.E., Smith, S., Frank, M.J., Poldrack, R.A. (2007). Triangulating a cognitive control network using diffusion-weighted magnetic resonance imaging (MRI) and functional MRI. J Neurosci, 27(14):3743-52",
    "version": "Git a65448a0f00e",
    "formats": [
      "BIDS",
      "NIfTI",
      "TSV"
    ],
    "reviewedAt": "2026-09-07",
    "downloadReviewRequired": true,
    "tool": "datalad",
    "downloadCommand": "datalad install -s https://github.com/OpenNeuroDatasets/ds000008.git . && git checkout a65448a0f00ebf4038e134f5a956f429ec4ca1ed && datalad get -r .",
    "recipe": {
      "type": "datalad",
      "repository": "https://github.com/OpenNeuroDatasets/ds000008.git",
      "revision": "a65448a0f00ebf4038e134f5a956f429ec4ca1ed"
    },
    "downloadOptions": [
      {
        "id": "first-participant",
        "label": "One participant: sub-01",
        "labelZh": "单个被试：sub-01",
        "description": "Fetch this participant plus repository metadata. This is a subset for inspecting the data, not the complete study. Shared stimulus assets may require a separate download.",
        "descriptionZh": "获取此被试及仓库元数据，用于检查数据结构；不代表完整研究队列。共享刺激文件可能需要另行获取。",
        "recipe": {
          "type": "datalad",
          "repository": "https://github.com/OpenNeuroDatasets/ds000008.git",
          "revision": "a65448a0f00ebf4038e134f5a956f429ec4ca1ed",
          "paths": [
            "sub-01"
          ]
        }
      }
    ],
    "accessNoteZh": "需要 DataLad 和 git-annex；下载固定到目录记录的 Git 版本。完整数据的体积因研究而异。"
  },
  {
    "id": "openneuro-ds000011",
    "name": "Classification learning and tone-counting",
    "provider": "OpenNeuro",
    "modalities": [
      "fMRI",
      "MRI"
    ],
    "summary": "Classification learning combined with tone counting.",
    "summaryZh": "结合声音计数的分类学习任务。",
    "description": "Classification learning combined with tone counting. BIDS metadata and task events are included; consult the study documentation before defining analysis contrasts.",
    "domains": [
      "memory"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "How does distraction affect memory systems?",
        "zh": "分心如何影响记忆系统？"
      }
    ],
    "license": "CC0",
    "access": "direct",
    "accessNote": "Requires DataLad and git-annex. Downloads the full dataset at the recorded Git revision; size varies by collection.",
    "homepage": "https://openneuro.org/datasets/ds000011",
    "citation": "doi:10.18112/openneuro.ds000011.v1.0.0",
    "version": "Git ba66c761540b",
    "formats": [
      "BIDS",
      "NIfTI",
      "TSV"
    ],
    "reviewedAt": "2026-09-07",
    "downloadReviewRequired": true,
    "tool": "datalad",
    "downloadCommand": "datalad install -s https://github.com/OpenNeuroDatasets/ds000011.git . && git checkout ba66c761540bb7fdedd6d2707d31e50e35b77f61 && datalad get -r .",
    "recipe": {
      "type": "datalad",
      "repository": "https://github.com/OpenNeuroDatasets/ds000011.git",
      "revision": "ba66c761540bb7fdedd6d2707d31e50e35b77f61"
    },
    "downloadOptions": [
      {
        "id": "first-participant",
        "label": "One participant: sub-01",
        "labelZh": "单个被试：sub-01",
        "description": "Fetch this participant plus repository metadata. This is a subset for inspecting the data, not the complete study. Shared stimulus assets may require a separate download.",
        "descriptionZh": "获取此被试及仓库元数据，用于检查数据结构；不代表完整研究队列。共享刺激文件可能需要另行获取。",
        "recipe": {
          "type": "datalad",
          "repository": "https://github.com/OpenNeuroDatasets/ds000011.git",
          "revision": "ba66c761540bb7fdedd6d2707d31e50e35b77f61",
          "paths": [
            "sub-01"
          ]
        }
      }
    ],
    "accessNoteZh": "需要 DataLad 和 git-annex；下载固定到目录记录的 Git 版本。完整数据的体积因研究而异。"
  },
  {
    "id": "openneuro-ds000102",
    "name": "Flanker task (event-related)",
    "provider": "OpenNeuro",
    "modalities": [
      "fMRI",
      "MRI"
    ],
    "summary": "Event-related flanker-task neuroimaging.",
    "summaryZh": "事件相关 Flanker 注意控制任务影像。",
    "description": "Event-related flanker-task neuroimaging. BIDS metadata and task events are included; consult the study documentation before defining analysis contrasts.",
    "domains": [
      "cognition"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "How does conflict affect cognitive control?",
        "zh": "冲突如何影响认知控制？"
      }
    ],
    "license": "PDDL 1.0",
    "access": "direct",
    "accessNote": "Requires DataLad and git-annex. Downloads the full dataset at the recorded Git revision; size varies by collection.",
    "homepage": "https://openneuro.org/datasets/ds000102",
    "citation": "http://www.ncbi.nlm.nih.gov/pubmed/20974260",
    "version": "Git fdc1ce49d524",
    "formats": [
      "BIDS",
      "NIfTI",
      "TSV"
    ],
    "reviewedAt": "2026-09-07",
    "downloadReviewRequired": true,
    "tool": "datalad",
    "downloadCommand": "datalad install -s https://github.com/OpenNeuroDatasets/ds000102.git . && git checkout fdc1ce49d524fc1e77e5b763f10acb02f403c581 && datalad get -r .",
    "recipe": {
      "type": "datalad",
      "repository": "https://github.com/OpenNeuroDatasets/ds000102.git",
      "revision": "fdc1ce49d524fc1e77e5b763f10acb02f403c581"
    },
    "downloadOptions": [
      {
        "id": "first-participant",
        "label": "One participant: sub-01",
        "labelZh": "单个被试：sub-01",
        "description": "Fetch this participant plus repository metadata. This is a subset for inspecting the data, not the complete study. Shared stimulus assets may require a separate download.",
        "descriptionZh": "获取此被试及仓库元数据，用于检查数据结构；不代表完整研究队列。共享刺激文件可能需要另行获取。",
        "recipe": {
          "type": "datalad",
          "repository": "https://github.com/OpenNeuroDatasets/ds000102.git",
          "revision": "fdc1ce49d524fc1e77e5b763f10acb02f403c581",
          "paths": [
            "sub-01"
          ]
        }
      }
    ],
    "accessNoteZh": "需要 DataLad 和 git-annex；下载固定到目录记录的 Git 版本。完整数据的体积因研究而异。"
  },
  {
    "id": "openneuro-ds000105",
    "name": "Visual object recognition",
    "provider": "OpenNeuro",
    "modalities": [
      "fMRI",
      "MRI"
    ],
    "summary": "Haxby visual object-recognition neuroimaging.",
    "summaryZh": "Haxby 视觉物体识别影像数据。",
    "description": "Haxby visual object-recognition neuroimaging. BIDS metadata and task events are included; consult the study documentation before defining analysis contrasts.",
    "domains": [
      "sensory"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "How are object categories represented?",
        "zh": "物体类别如何在脑中表征？"
      }
    ],
    "license": "CC0",
    "access": "direct",
    "accessNote": "Requires DataLad and git-annex. Downloads the full dataset at the recorded Git revision; size varies by collection.",
    "homepage": "https://openneuro.org/datasets/ds000105",
    "citation": "doi:10.18112/openneuro.ds000105.v3.0.0",
    "version": "Git b2677616e861",
    "formats": [
      "BIDS",
      "NIfTI",
      "TSV"
    ],
    "reviewedAt": "2026-09-07",
    "downloadReviewRequired": true,
    "tool": "datalad",
    "downloadCommand": "datalad install -s https://github.com/OpenNeuroDatasets/ds000105.git . && git checkout b2677616e86113ec230e6189ad2341ffcc065c83 && datalad get -r .",
    "recipe": {
      "type": "datalad",
      "repository": "https://github.com/OpenNeuroDatasets/ds000105.git",
      "revision": "b2677616e86113ec230e6189ad2341ffcc065c83"
    },
    "accessNoteZh": "需要 DataLad 和 git-annex；下载固定到目录记录的 Git 版本。完整数据的体积因研究而异。"
  },
  {
    "id": "openneuro-ds000171",
    "name": "Neural Processing of Emotional Musical and Nonmusical Stimuli in Depression",
    "provider": "OpenNeuro",
    "modalities": [
      "fMRI",
      "MRI"
    ],
    "summary": "Emotional music and nonmusical stimuli in depression.",
    "summaryZh": "抑郁症中的情绪音乐及非音乐刺激加工。",
    "description": "Emotional music and nonmusical stimuli in depression. BIDS metadata and task events are included; consult the study documentation before defining analysis contrasts.",
    "domains": [
      "clinical"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "How is affective processing altered in depression?",
        "zh": "抑郁症中的情绪加工有何变化？"
      }
    ],
    "license": "PDDL 1.0",
    "access": "direct",
    "accessNote": "Requires DataLad and git-annex. Downloads the full dataset at the recorded Git revision; size varies by collection.",
    "homepage": "https://openneuro.org/datasets/ds000171",
    "citation": "Lepping RJ, Atchley RA, Chrysikou E, Martin LE, Clair AA, Ingram RE, et al. Neural processing of emotional musical and nonmusical stimuli in depression.  PlosONE.  In Press.",
    "version": "Git daab9df9051f",
    "formats": [
      "BIDS",
      "NIfTI",
      "TSV"
    ],
    "reviewedAt": "2026-09-07",
    "downloadReviewRequired": true,
    "tool": "datalad",
    "downloadCommand": "datalad install -s https://github.com/OpenNeuroDatasets/ds000171.git . && git checkout daab9df9051f5919150df231021018b2ea226434 && datalad get -r .",
    "recipe": {
      "type": "datalad",
      "repository": "https://github.com/OpenNeuroDatasets/ds000171.git",
      "revision": "daab9df9051f5919150df231021018b2ea226434"
    },
    "downloadOptions": [
      {
        "id": "first-participant",
        "label": "One participant: sub-control01",
        "labelZh": "单个被试：sub-control01",
        "description": "Fetch this participant plus repository metadata. This is a subset for inspecting the data, not the complete study. Shared stimulus assets may require a separate download.",
        "descriptionZh": "获取此被试及仓库元数据，用于检查数据结构；不代表完整研究队列。共享刺激文件可能需要另行获取。",
        "recipe": {
          "type": "datalad",
          "repository": "https://github.com/OpenNeuroDatasets/ds000171.git",
          "revision": "daab9df9051f5919150df231021018b2ea226434",
          "paths": [
            "sub-control01"
          ]
        }
      }
    ],
    "accessNoteZh": "需要 DataLad 和 git-annex；下载固定到目录记录的 Git 版本。完整数据的体积因研究而异。"
  },
  {
    "id": "openneuro-ds000228",
    "name": "MRI data of 3-12 year old children and adults during viewing of a short animated film",
    "provider": "OpenNeuro",
    "modalities": [
      "fMRI",
      "MRI"
    ],
    "summary": "Children and adults watching a short animated film.",
    "summaryZh": "儿童与成人观看短动画片的 MRI 数据。",
    "description": "Children and adults watching a short animated film. BIDS metadata and task events are included; consult the study documentation before defining analysis contrasts.",
    "domains": [
      "lifespan"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "How does naturalistic brain activity change with development?",
        "zh": "自然情境中的脑活动如何随发育变化？"
      }
    ],
    "license": "PDDL 1.0",
    "access": "direct",
    "accessNote": "Requires DataLad and git-annex. Downloads the full dataset at the recorded Git revision; size varies by collection.",
    "homepage": "https://openneuro.org/datasets/ds000228",
    "citation": "Richardson, H., Lisandrelli, G., Riobueno-Naylor, A., & Saxe, R. (2018). Development of the social brain from age three to twelve years. Nature communications, 9(1), 1027.",
    "version": "Git dafa3a5237ad",
    "formats": [
      "BIDS",
      "NIfTI",
      "TSV"
    ],
    "reviewedAt": "2026-09-07",
    "downloadReviewRequired": true,
    "tool": "datalad",
    "downloadCommand": "datalad install -s https://github.com/OpenNeuroDatasets/ds000228.git . && git checkout dafa3a5237adc54de843ef584ab2261fcd901378 && datalad get -r .",
    "recipe": {
      "type": "datalad",
      "repository": "https://github.com/OpenNeuroDatasets/ds000228.git",
      "revision": "dafa3a5237adc54de843ef584ab2261fcd901378"
    },
    "downloadOptions": [
      {
        "id": "first-participant",
        "label": "One participant: sub-pixar001",
        "labelZh": "单个被试：sub-pixar001",
        "description": "Fetch this participant plus repository metadata. This is a subset for inspecting the data, not the complete study. Shared stimulus assets may require a separate download.",
        "descriptionZh": "获取此被试及仓库元数据，用于检查数据结构；不代表完整研究队列。共享刺激文件可能需要另行获取。",
        "recipe": {
          "type": "datalad",
          "repository": "https://github.com/OpenNeuroDatasets/ds000228.git",
          "revision": "dafa3a5237adc54de843ef584ab2261fcd901378",
          "paths": [
            "sub-pixar001"
          ]
        }
      }
    ],
    "accessNoteZh": "需要 DataLad 和 git-annex；下载固定到目录记录的 Git 版本。完整数据的体积因研究而异。"
  },
  {
    "id": "openneuro-ds001246",
    "name": "Generic Object Decoding (fMRI on ImageNet)",
    "provider": "OpenNeuro",
    "modalities": [
      "fMRI",
      "MRI"
    ],
    "summary": "fMRI during viewing and imagining object categories.",
    "summaryZh": "观看及想象物体类别时的 fMRI 数据。",
    "description": "fMRI during viewing and imagining object categories. BIDS metadata and task events are included; consult the study documentation before defining analysis contrasts.",
    "domains": [
      "sensory"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "Can seen and imagined object categories be decoded?",
        "zh": "能否解码看到或想象的物体类别？"
      }
    ],
    "license": "CC0",
    "access": "direct",
    "accessNote": "Requires DataLad and git-annex. Downloads the full dataset at the recorded Git revision; size varies by collection.",
    "homepage": "https://openneuro.org/datasets/ds001246",
    "citation": "10.18112/openneuro.ds001246.v1.2.1",
    "version": "Git 261343c5e738",
    "formats": [
      "BIDS",
      "NIfTI",
      "TSV"
    ],
    "reviewedAt": "2026-09-07",
    "downloadReviewRequired": true,
    "tool": "datalad",
    "downloadCommand": "datalad install -s https://github.com/OpenNeuroDatasets/ds001246.git . && git checkout 261343c5e738466b7b2e2d7ef9b07785845a7463 && datalad get -r .",
    "recipe": {
      "type": "datalad",
      "repository": "https://github.com/OpenNeuroDatasets/ds001246.git",
      "revision": "261343c5e738466b7b2e2d7ef9b07785845a7463"
    },
    "accessNoteZh": "需要 DataLad 和 git-annex；下载固定到目录记录的 Git 版本。完整数据的体积因研究而异。"
  },
  {
    "id": "openneuro-ds002837",
    "name": "Naturalistic Neuroimaging Database",
    "provider": "OpenNeuro",
    "modalities": [
      "fMRI",
      "MRI"
    ],
    "summary": "Naturalistic neuroimaging during movie viewing.",
    "summaryZh": "观看电影时的自然情境脑影像数据。",
    "description": "Naturalistic neuroimaging during movie viewing. BIDS metadata and task events are included; consult the study documentation before defining analysis contrasts.",
    "domains": [
      "language"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "How does the brain respond to natural narratives?",
        "zh": "大脑如何响应自然叙事？"
      }
    ],
    "license": "CC0",
    "access": "direct",
    "accessNote": "Requires DataLad and git-annex. Downloads the full dataset at the recorded Git revision; size varies by collection.",
    "homepage": "https://openneuro.org/datasets/ds002837",
    "citation": "10.18112/openneuro.ds002837.v2.0.0",
    "version": "Git c8b7635fd492",
    "formats": [
      "BIDS",
      "NIfTI",
      "TSV"
    ],
    "reviewedAt": "2026-09-07",
    "downloadReviewRequired": true,
    "tool": "datalad",
    "downloadCommand": "datalad install -s https://github.com/OpenNeuroDatasets/ds002837.git . && git checkout c8b7635fd4926920cef16198dd826a41a2afab21 && datalad get -r .",
    "recipe": {
      "type": "datalad",
      "repository": "https://github.com/OpenNeuroDatasets/ds002837.git",
      "revision": "c8b7635fd4926920cef16198dd826a41a2afab21"
    },
    "downloadOptions": [
      {
        "id": "first-participant",
        "label": "One participant: sub-1",
        "labelZh": "单个被试：sub-1",
        "description": "Fetch this participant plus repository metadata. This is a subset for inspecting the data, not the complete study. Shared stimulus assets may require a separate download.",
        "descriptionZh": "获取此被试及仓库元数据，用于检查数据结构；不代表完整研究队列。共享刺激文件可能需要另行获取。",
        "recipe": {
          "type": "datalad",
          "repository": "https://github.com/OpenNeuroDatasets/ds002837.git",
          "revision": "c8b7635fd4926920cef16198dd826a41a2afab21",
          "paths": [
            "sub-1"
          ]
        }
      }
    ],
    "accessNoteZh": "需要 DataLad 和 git-annex；下载固定到目录记录的 Git 版本。完整数据的体积因研究而异。"
  },
  {
    "id": "mne-fnirs-motor",
    "name": "MNE fNIRS Motor",
    "provider": "MNE / OSF",
    "modalities": [
      "fNIRS"
    ],
    "summary": "Finger-tapping fNIRS recording.",
    "summaryZh": "手指敲击任务的功能近红外数据。",
    "description": "Finger-tapping fNIRS recording. This is the MNE-distributed example archive, not necessarily the full originating study. Review the linked dataset-specific usage conditions.",
    "domains": [
      "motor",
      "methods"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "How do hemodynamic responses differ between hands?",
        "zh": "左右手运动的血流动力学反应有何差异？"
      }
    ],
    "license": "Provider dataset usage conditions",
    "access": "direct",
    "accessNote": "Downloads an archive that must be extracted before analysis. The provider checksum is verified automatically. Follow the dataset documentation for research reuse.",
    "homepage": "https://mne.tools/stable/generated/mne.datasets.fnirs_motor.data_path.html",
    "version": "OSF file version 1",
    "formats": [
      "tgz"
    ],
    "reviewedAt": "2026-09-07",
    "downloadReviewRequired": true,
    "tool": "BrainPilot HTTP downloader",
    "downloadCommand": "curl -fL -C - -o MNE-fNIRS-motor-data.tgz \"https://osf.io/download/dj3eh?version=1\"",
    "recipe": {
      "type": "http",
      "url": "https://osf.io/download/dj3eh?version=1",
      "fileName": "MNE-fNIRS-motor-data.tgz",
      "checksum": {
        "algorithm": "md5",
        "value": "c4935d19ddab35422a69f3326a01fef8"
      }
    },
    "accessNoteZh": "这是 MNE 分发的示例归档，下载后需要解压；系统自动核对提供方公布的校验值。科研复用请阅读该数据集的使用条件。"
  },
  {
    "id": "mne-somato",
    "name": "MNE Somatosensory",
    "provider": "MNE / OSF",
    "modalities": [
      "MEG"
    ],
    "summary": "Somatosensory MEG for time-frequency analysis.",
    "summaryZh": "用于时频分析的躯体感觉 MEG 数据。",
    "description": "Somatosensory MEG for time-frequency analysis. This is the MNE-distributed example archive, not necessarily the full originating study. Review the linked dataset-specific usage conditions.",
    "domains": [
      "motor",
      "methods"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "How does somatosensory stimulation modulate oscillations?",
        "zh": "躯体感觉刺激如何调制神经振荡？"
      }
    ],
    "license": "Provider dataset usage conditions",
    "access": "direct",
    "accessNote": "Downloads an archive that must be extracted before analysis. The provider checksum is verified automatically. Follow the dataset documentation for research reuse.",
    "homepage": "https://mne.tools/stable/generated/mne.datasets.somato.data_path.html",
    "version": "OSF file version 8",
    "formats": [
      "gz"
    ],
    "reviewedAt": "2026-09-07",
    "downloadReviewRequired": true,
    "tool": "BrainPilot HTTP downloader",
    "downloadCommand": "curl -fL -C - -o MNE-somato-data.tar.gz \"https://osf.io/download/tp4sg?version=8\"",
    "recipe": {
      "type": "http",
      "url": "https://osf.io/download/tp4sg?version=8",
      "fileName": "MNE-somato-data.tar.gz",
      "checksum": {
        "algorithm": "md5",
        "value": "9a191907b326b9402341ee7a0d1240d8"
      }
    },
    "accessNoteZh": "这是 MNE 分发的示例归档，下载后需要解压；系统自动核对提供方公布的校验值。科研复用请阅读该数据集的使用条件。"
  },
  {
    "id": "mne-kiloword",
    "name": "Kiloword Lexical Decision",
    "provider": "MNE / OSF",
    "modalities": [
      "EEG"
    ],
    "summary": "Averaged EEG during lexical decisions on English words.",
    "summaryZh": "英语词汇判断任务的平均 EEG 反应。",
    "description": "Averaged EEG during lexical decisions on English words. This is the MNE-distributed example archive, not necessarily the full originating study. Review the linked dataset-specific usage conditions.",
    "domains": [
      "language",
      "methods"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "How do word properties relate to evoked responses?",
        "zh": "词汇属性如何关联诱发反应？"
      }
    ],
    "license": "Provider dataset usage conditions",
    "access": "direct",
    "accessNote": "Downloads an archive that must be extracted before analysis. The provider checksum is verified automatically. Follow the dataset documentation for research reuse.",
    "homepage": "https://mne.tools/stable/generated/mne.datasets.kiloword.data_path.html",
    "version": "OSF file version 1",
    "formats": [
      "gz"
    ],
    "reviewedAt": "2026-09-07",
    "downloadReviewRequired": true,
    "tool": "BrainPilot HTTP downloader",
    "downloadCommand": "curl -fL -C - -o MNE-kiloword-data.tar.gz \"https://osf.io/download/qkvf9?version=1\"",
    "recipe": {
      "type": "http",
      "url": "https://osf.io/download/qkvf9?version=1",
      "fileName": "MNE-kiloword-data.tar.gz",
      "checksum": {
        "algorithm": "md5",
        "value": "3a124170795abbd2e48aae8727e719a8"
      }
    },
    "accessNoteZh": "这是 MNE 分发的示例归档，下载后需要解压；系统自动核对提供方公布的校验值。科研复用请阅读该数据集的使用条件。"
  },
  {
    "id": "mne-mtrf",
    "name": "mTRF Natural Speech",
    "provider": "MNE / OSF",
    "modalities": [
      "EEG"
    ],
    "summary": "EEG and stimulus features for natural speech encoding.",
    "summaryZh": "自然语音 EEG 及刺激特征，用于编码模型。",
    "description": "EEG and stimulus features for natural speech encoding. This is the MNE-distributed example archive, not necessarily the full originating study. Review the linked dataset-specific usage conditions.",
    "domains": [
      "language",
      "methods"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "How can speech features predict neural activity?",
        "zh": "语音特征能否预测神经活动？"
      }
    ],
    "license": "Provider dataset usage conditions",
    "access": "direct",
    "accessNote": "Downloads an archive that must be extracted before analysis. The provider checksum is verified automatically. Follow the dataset documentation for research reuse.",
    "homepage": "https://mne.tools/stable/generated/mne.datasets.mtrf.data_path.html",
    "version": "OSF file version 1",
    "formats": [
      "zip"
    ],
    "reviewedAt": "2026-09-07",
    "downloadReviewRequired": true,
    "tool": "BrainPilot HTTP downloader",
    "downloadCommand": "curl -fL -C - -o mTRF_1.5.zip \"https://osf.io/download/h85s2?version=1\"",
    "recipe": {
      "type": "http",
      "url": "https://osf.io/download/h85s2?version=1",
      "fileName": "mTRF_1.5.zip",
      "checksum": {
        "algorithm": "md5",
        "value": "273a390ebbc48da2c3184b01a82e4636"
      }
    },
    "accessNoteZh": "这是 MNE 分发的示例归档，下载后需要解压；系统自动核对提供方公布的校验值。科研复用请阅读该数据集的使用条件。"
  },
  {
    "id": "mne-ssvep",
    "name": "MNE SSVEP Example",
    "provider": "MNE / OSF",
    "modalities": [
      "EEG"
    ],
    "summary": "Frequency-tagged steady-state visual evoked responses.",
    "summaryZh": "频率标记的稳态视觉诱发反应示例。",
    "description": "Frequency-tagged steady-state visual evoked responses. This is the MNE-distributed example archive, not necessarily the full originating study. Review the linked dataset-specific usage conditions.",
    "domains": [
      "bci",
      "methods"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "How are stimulus frequencies represented in EEG?",
        "zh": "EEG 如何表征视觉刺激频率？"
      }
    ],
    "license": "Provider dataset usage conditions",
    "access": "direct",
    "accessNote": "Downloads an archive that must be extracted before analysis. The provider checksum is verified automatically. Follow the dataset documentation for research reuse.",
    "homepage": "https://mne.tools/stable/generated/mne.datasets.ssvep.data_path.html",
    "version": "OSF file version 5",
    "formats": [
      "zip"
    ],
    "reviewedAt": "2026-09-07",
    "downloadReviewRequired": true,
    "tool": "BrainPilot HTTP downloader",
    "downloadCommand": "curl -fL -C - -o ssvep_example_data.zip \"https://osf.io/download/z8h6k?version=5\"",
    "recipe": {
      "type": "http",
      "url": "https://osf.io/download/z8h6k?version=5",
      "fileName": "ssvep_example_data.zip",
      "checksum": {
        "algorithm": "md5",
        "value": "af866bbc0f921114ac9d683494fe87d6"
      }
    },
    "accessNoteZh": "这是 MNE 分发的示例归档，下载后需要解压；系统自动核对提供方公布的校验值。科研复用请阅读该数据集的使用条件。"
  },
  {
    "id": "mne-epilepsy-ecog",
    "name": "MNE Epilepsy ECoG",
    "provider": "MNE / OSF",
    "modalities": [
      "ECoG"
    ],
    "summary": "Intracranial recordings for the MNE epilepsy ECoG example.",
    "summaryZh": "MNE 癫痫 ECoG 示例中的颅内电生理数据。",
    "description": "Intracranial recordings for the MNE epilepsy ECoG example. This is the MNE-distributed example archive, not necessarily the full originating study. Review the linked dataset-specific usage conditions.",
    "domains": [
      "clinical",
      "methods"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "How can intracranial epileptic activity be inspected?",
        "zh": "如何检查颅内癫痫相关活动？"
      }
    ],
    "license": "Provider dataset usage conditions",
    "access": "direct",
    "accessNote": "Downloads an archive that must be extracted before analysis. The provider checksum is verified automatically. Follow the dataset documentation for research reuse.",
    "homepage": "https://mne.tools/stable/generated/mne.datasets.epilepsy_ecog.data_path.html",
    "version": "OSF file version 1",
    "formats": [
      "gz"
    ],
    "reviewedAt": "2026-09-07",
    "downloadReviewRequired": true,
    "tool": "BrainPilot HTTP downloader",
    "downloadCommand": "curl -fL -C - -o MNE-epilepsy-ecog-data.tar.gz \"https://osf.io/download/z4epq?version=1\"",
    "recipe": {
      "type": "http",
      "url": "https://osf.io/download/z4epq?version=1",
      "fileName": "MNE-epilepsy-ecog-data.tar.gz",
      "checksum": {
        "algorithm": "md5",
        "value": "ffb139174afa0f71ec98adbbb1729dea"
      }
    },
    "accessNoteZh": "这是 MNE 分发的示例归档，下载后需要解压；系统自动核对提供方公布的校验值。科研复用请阅读该数据集的使用条件。"
  },
  {
    "id": "physionet-gaitndd",
    "name": "Gait in Neurodegenerative Disease",
    "provider": "PhysioNet",
    "modalities": [
      "Behavior",
      "Clinical"
    ],
    "summary": "Stride-interval recordings in neurological disease and controls.",
    "summaryZh": "神经系统疾病与对照组的步态间隔记录。",
    "description": "Stride-interval recordings in neurological disease and controls. Retain participant identifiers for study-level splits and use the official annotations to define analysis targets.",
    "domains": [
      "motor"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "How does neurodegeneration affect gait variability?",
        "zh": "神经退行性疾病如何影响步态变异性？"
      }
    ],
    "size": "17.9 MB",
    "license": "ODC-By 1.0",
    "access": "direct",
    "accessNote": "Public versioned collection. Requires wget; sizes refer to uncompressed files.",
    "homepage": "https://physionet.org/content/gaitndd/1.0.0/",
    "version": "1.0.0",
    "reviewedAt": "2026-09-07",
    "checksumUrl": "https://physionet.org/files/gaitndd/1.0.0/SHA256SUMS.txt",
    "tool": "wget",
    "downloadCommand": "wget -r -N -c -np -nH --cut-dirs=3 https://physionet.org/files/gaitndd/1.0.0/",
    "recipe": {
      "type": "command",
      "command": "wget",
      "args": [
        "-r",
        "-N",
        "-c",
        "-np",
        "-nH",
        "--cut-dirs=3",
        "https://physionet.org/files/gaitndd/1.0.0/"
      ]
    },
    "accessNoteZh": "公开版本化数据；完整下载需要 wget，体积按未压缩文件计算。请保留原始标注与引用。"
  },
  {
    "id": "physionet-gaitpdb",
    "name": "Gait in Parkinson’s Disease",
    "provider": "PhysioNet",
    "modalities": [
      "Behavior",
      "Clinical"
    ],
    "summary": "Foot-force measurements and clinical metadata in Parkinson’s disease.",
    "summaryZh": "帕金森病的足底力记录及临床元数据。",
    "description": "Foot-force measurements and clinical metadata in Parkinson’s disease. Retain participant identifiers for study-level splits and use the official annotations to define analysis targets.",
    "domains": [
      "motor"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "How do gait dynamics differ in Parkinson’s disease?",
        "zh": "帕金森病的步态动力学有何差异？"
      }
    ],
    "size": "288.4 MB",
    "license": "ODC-By 1.0",
    "access": "direct",
    "accessNote": "Public versioned collection. Requires wget; sizes refer to uncompressed files.",
    "homepage": "https://physionet.org/content/gaitpdb/1.0.0/",
    "version": "1.0.0",
    "reviewedAt": "2026-09-07",
    "checksumUrl": "https://physionet.org/files/gaitpdb/1.0.0/SHA256SUMS.txt",
    "tool": "wget",
    "downloadCommand": "wget -r -N -c -np -nH --cut-dirs=3 https://physionet.org/files/gaitpdb/1.0.0/",
    "recipe": {
      "type": "command",
      "command": "wget",
      "args": [
        "-r",
        "-N",
        "-c",
        "-np",
        "-nH",
        "--cut-dirs=3",
        "https://physionet.org/files/gaitpdb/1.0.0/"
      ]
    },
    "downloadOptions": [
      {
        "id": "sample",
        "label": "One control recording + demographics",
        "labelZh": "一份对照记录与人口统计信息",
        "description": "2 files with provider SHA-256 verification. A small example for validating your workflow.",
        "descriptionZh": "2 个文件，逐一核对提供方 SHA-256；适合验证读取和分析流程。",
        "recipe": {
          "type": "http-files",
          "files": [
            {
              "url": "https://physionet.org/files/gaitpdb/1.0.0/GaCo01_01.txt",
              "fileName": "GaCo01_01.txt",
              "checksum": {
                "algorithm": "sha256",
                "value": "81bcedc0f72c1c6804d7830627431a6c1b76e9ddb42de0cf1ae2f418848c13a4"
              }
            },
            {
              "url": "https://physionet.org/files/gaitpdb/1.0.0/demographics.txt",
              "fileName": "demographics.txt",
              "checksum": {
                "algorithm": "sha256",
                "value": "ebe5e3c5c3055023b876225d3eb067a9351693e28ce47fa678872ead8284f643"
              }
            }
          ]
        }
      }
    ],
    "accessNoteZh": "公开版本化数据；完整下载需要 wget，体积按未压缩文件计算。请保留原始标注与引用。"
  },
  {
    "id": "physionet-drivedb",
    "name": "Driving Stress Physiology",
    "provider": "PhysioNet",
    "modalities": [
      "ECG",
      "EMG",
      "EDA"
    ],
    "summary": "Physiological recordings during real-world driving; subjective stress ratings are not included.",
    "summaryZh": "真实驾驶过程中的生理记录；不包含主观压力评分。",
    "description": "Physiological recordings during real-world driving; subjective stress ratings are not included. Retain participant identifiers for study-level splits and use the official annotations to define analysis targets.",
    "domains": [
      "cognition"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "How do physiological signals change across driving conditions?",
        "zh": "不同驾驶情境中的生理信号如何变化？"
      }
    ],
    "size": "108.7 MB",
    "license": "ODC-By 1.0",
    "access": "direct",
    "accessNote": "Public versioned collection. Requires wget; sizes refer to uncompressed files.",
    "homepage": "https://physionet.org/content/drivedb/1.0.0/",
    "version": "1.0.0",
    "reviewedAt": "2026-09-07",
    "checksumUrl": "https://physionet.org/files/drivedb/1.0.0/SHA256SUMS.txt",
    "tool": "wget",
    "downloadCommand": "wget -r -N -c -np -nH --cut-dirs=3 https://physionet.org/files/drivedb/1.0.0/",
    "recipe": {
      "type": "command",
      "command": "wget",
      "args": [
        "-r",
        "-N",
        "-c",
        "-np",
        "-nH",
        "--cut-dirs=3",
        "https://physionet.org/files/drivedb/1.0.0/"
      ]
    },
    "accessNoteZh": "公开版本化数据；完整下载需要 wget，体积按未压缩文件计算。请保留原始标注与引用。"
  },
  {
    "id": "physionet-ptb-xl",
    "name": "PTB-XL Electrocardiography",
    "provider": "PhysioNet",
    "modalities": [
      "ECG",
      "Clinical"
    ],
    "summary": "Twelve-lead ECG recordings with diagnostic metadata.",
    "summaryZh": "包含诊断元数据的十二导联 ECG 记录。",
    "description": "Twelve-lead ECG recordings with diagnostic metadata. Retain participant identifiers for study-level splits and use the official annotations to define analysis targets.",
    "domains": [
      "physiology"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "How can cardiac patterns be classified from ECG?",
        "zh": "如何从 ECG 分类心脏电活动模式？"
      }
    ],
    "size": "3.0 GB",
    "license": "CC BY 4.0",
    "access": "direct",
    "accessNote": "Public versioned collection. Requires wget; sizes refer to uncompressed files.",
    "homepage": "https://physionet.org/content/ptb-xl/1.0.3/",
    "version": "1.0.3",
    "reviewedAt": "2026-09-07",
    "checksumUrl": "https://physionet.org/files/ptb-xl/1.0.3/SHA256SUMS.txt",
    "tool": "wget",
    "downloadCommand": "wget -r -N -c -np -nH --cut-dirs=3 https://physionet.org/files/ptb-xl/1.0.3/",
    "recipe": {
      "type": "command",
      "command": "wget",
      "args": [
        "-r",
        "-N",
        "-c",
        "-np",
        "-nH",
        "--cut-dirs=3",
        "https://physionet.org/files/ptb-xl/1.0.3/"
      ]
    },
    "downloadOptions": [
      {
        "id": "sample",
        "label": "One ECG + diagnostic metadata",
        "labelZh": "一份心电记录与诊断元数据",
        "description": "4 files with provider SHA-256 verification. A small example for validating your workflow.",
        "descriptionZh": "4 个文件，逐一核对提供方 SHA-256；适合验证读取和分析流程。",
        "recipe": {
          "type": "http-files",
          "files": [
            {
              "url": "https://physionet.org/files/ptb-xl/1.0.3/records100/00000/00001_lr.dat",
              "fileName": "records100/00000/00001_lr.dat",
              "checksum": {
                "algorithm": "sha256",
                "value": "308012fb657e1eea29a86902a8576e2e173594bd16f11ec1f45c7445cec97572"
              }
            },
            {
              "url": "https://physionet.org/files/ptb-xl/1.0.3/records100/00000/00001_lr.hea",
              "fileName": "records100/00000/00001_lr.hea",
              "checksum": {
                "algorithm": "sha256",
                "value": "051aa38ee3f530df1f2dd35ec097439a54befceef18c60d4157da2a5628aefbb"
              }
            },
            {
              "url": "https://physionet.org/files/ptb-xl/1.0.3/ptbxl_database.csv",
              "fileName": "ptbxl_database.csv",
              "checksum": {
                "algorithm": "sha256",
                "value": "7600de9c1b27d181d850b3c6038a35d7c3ddb6bb33b702e3a20252a6859d216b"
              }
            },
            {
              "url": "https://physionet.org/files/ptb-xl/1.0.3/scp_statements.csv",
              "fileName": "scp_statements.csv",
              "checksum": {
                "algorithm": "sha256",
                "value": "ad05b0b1fcae83bb1230755ad9cfc7c96f303feddc08a4a9ad5bdc9ca63bac8f"
              }
            }
          ]
        }
      }
    ],
    "accessNoteZh": "公开版本化数据；完整下载需要 wget，体积按未压缩文件计算。请保留原始标注与引用。"
  },
  {
    "id": "dandi-000003",
    "name": "Hippocampal Granule & Mossy Cells",
    "provider": "DANDI Archive",
    "modalities": [
      "NWB",
      "Behavior"
    ],
    "summary": "Hippocampal electrophysiology during maze exploration.",
    "summaryZh": "迷宫探索中的海马电生理。",
    "description": "Hippocampal electrophysiology during maze exploration. Select assets and a release on the provider page. The draft collection may change.",
    "domains": [
      "memory"
    ],
    "species": "mouse",
    "researchQuestions": [
      {
        "en": "How do hippocampal cells encode space?",
        "zh": "海马细胞如何编码空间？"
      }
    ],
    "size": "~2.56 TB (draft)",
    "license": "CC BY 4.0",
    "access": "direct",
    "accessNote": "Use provider asset selection for this large collection. Whole-collection download is not launched by BrainPilot.",
    "homepage": "https://dandiarchive.org/dandiset/000003/draft",
    "version": "draft",
    "reviewedAt": "2026-09-07",
    "formats": [
      "NWB"
    ],
    "accessNoteZh": "该大型集合请在 DANDI 页面选择版本与文件；草稿内容可能变化。BrainPilot 不启动整库下载。"
  },
  {
    "id": "dandi-000115",
    "name": "Hippocampal Replay & Experience",
    "provider": "DANDI Archive",
    "modalities": [
      "NWB",
      "Behavior"
    ],
    "summary": "CA1 tetrode recordings and behavioral tracking for replay analysis.",
    "summaryZh": "用于重放分析的 CA1 电极记录及行为追踪。",
    "description": "CA1 tetrode recordings and behavioral tracking for replay analysis. Select assets and a release on the provider page. The draft collection may change.",
    "domains": [
      "memory"
    ],
    "species": "rat",
    "researchQuestions": [
      {
        "en": "How does replay relate to past experience?",
        "zh": "海马重放如何关联过去的经历？"
      }
    ],
    "size": "~9.10 TB (draft)",
    "license": "CC BY 4.0",
    "access": "direct",
    "accessNote": "Use provider asset selection for this large collection. Whole-collection download is not launched by BrainPilot.",
    "homepage": "https://dandiarchive.org/dandiset/000115/draft",
    "version": "draft",
    "reviewedAt": "2026-09-07",
    "formats": [
      "NWB"
    ],
    "accessNoteZh": "该大型集合请在 DANDI 页面选择版本与文件；草稿内容可能变化。BrainPilot 不启动整库下载。"
  },
  {
    "id": "dandi-000409",
    "name": "IBL Brain Wide Map",
    "provider": "DANDI Archive",
    "modalities": [
      "Neuropixels",
      "NWB",
      "Behavior"
    ],
    "summary": "Brain-wide Neuropixels recordings during decision making.",
    "summaryZh": "决策任务中的全脑 Neuropixels 记录。",
    "description": "Brain-wide Neuropixels recordings during decision making. Select assets and a release on the provider page. The draft collection may change.",
    "domains": [
      "circuits"
    ],
    "species": "mouse",
    "researchQuestions": [
      {
        "en": "How is decision-related activity distributed across brain areas?",
        "zh": "决策相关活动如何分布于不同脑区？"
      }
    ],
    "size": "~49.70 TB (draft)",
    "license": "CC BY 4.0",
    "access": "direct",
    "accessNote": "Use provider asset selection for this large collection. Whole-collection download is not launched by BrainPilot.",
    "homepage": "https://dandiarchive.org/dandiset/000409/draft",
    "version": "draft",
    "reviewedAt": "2026-09-07",
    "formats": [
      "NWB"
    ],
    "accessNoteZh": "该大型集合请在 DANDI 页面选择版本与文件；草稿内容可能变化。BrainPilot 不启动整库下载。"
  },
  {
    "id": "dandi-000728",
    "name": "Allen Visual Coding — Calcium Imaging",
    "provider": "DANDI Archive",
    "modalities": [
      "Calcium",
      "NWB"
    ],
    "summary": "Two-photon calcium recordings during visual stimulation.",
    "summaryZh": "视觉刺激期间的双光子钙成像记录。",
    "description": "Two-photon calcium recordings during visual stimulation. Select assets and a release on the provider page. The draft collection may change.",
    "domains": [
      "circuits"
    ],
    "species": "mouse",
    "researchQuestions": [
      {
        "en": "How do cell populations respond to visual stimuli?",
        "zh": "细胞群体如何响应视觉刺激？"
      }
    ],
    "size": "~62.52 TB (draft)",
    "license": "CC BY 4.0",
    "access": "direct",
    "accessNote": "Use provider asset selection for this large collection. Whole-collection download is not launched by BrainPilot.",
    "homepage": "https://dandiarchive.org/dandiset/000728/draft",
    "version": "draft",
    "reviewedAt": "2026-09-07",
    "formats": [
      "NWB"
    ],
    "accessNoteZh": "该大型集合请在 DANDI 页面选择版本与文件；草稿内容可能变化。BrainPilot 不启动整库下载。"
  },
  {
    "id": "dandi-000350",
    "name": "Glia & Behavioral State Switching",
    "provider": "DANDI Archive",
    "modalities": [
      "Calcium",
      "NWB",
      "Behavior"
    ],
    "summary": "Calcium imaging in zebrafish during motor futility.",
    "summaryZh": "斑马鱼运动无效情境中的钙成像数据。",
    "description": "Calcium imaging in zebrafish during motor futility. Select assets and a release on the provider page. The draft collection may change.",
    "domains": [
      "circuits"
    ],
    "species": "zebrafish",
    "researchQuestions": [
      {
        "en": "How are glial signals related to behavioral state changes?",
        "zh": "胶质细胞信号如何关联行为状态切换？"
      }
    ],
    "size": "~5.87 TB (draft)",
    "license": "CC BY 4.0",
    "access": "direct",
    "accessNote": "Use provider asset selection for this large collection. Whole-collection download is not launched by BrainPilot.",
    "homepage": "https://dandiarchive.org/dandiset/000350/draft",
    "version": "draft",
    "reviewedAt": "2026-09-07",
    "formats": [
      "NWB"
    ],
    "accessNoteZh": "该大型集合请在 DANDI 页面选择版本与文件；草稿内容可能变化。BrainPilot 不启动整库下载。"
  },
  {
    "id": "dandi-000233",
    "name": "Hippocampal Ripples & Glucose",
    "provider": "DANDI Archive",
    "modalities": [
      "NWB",
      "Behavior"
    ],
    "summary": "Hippocampal recordings paired with interstitial glucose measurements.",
    "summaryZh": "海马电生理与间质葡萄糖的联合测量。",
    "description": "Hippocampal recordings paired with interstitial glucose measurements. Select assets and a release on the provider page. The draft collection may change.",
    "domains": [
      "physiology"
    ],
    "species": "rat",
    "researchQuestions": [
      {
        "en": "How do hippocampal rhythms relate to peripheral physiology?",
        "zh": "海马节律如何关联外周生理？"
      }
    ],
    "size": "~12.32 TB (draft)",
    "license": "CC BY 4.0",
    "access": "direct",
    "accessNote": "Use provider asset selection for this large collection. Whole-collection download is not launched by BrainPilot.",
    "homepage": "https://dandiarchive.org/dandiset/000233/draft",
    "version": "draft",
    "reviewedAt": "2026-09-07",
    "formats": [
      "NWB"
    ],
    "accessNoteZh": "该大型集合请在 DANDI 页面选择版本与文件；草稿内容可能变化。BrainPilot 不启动整库下载。"
  },
  {
    "id": "10x-pbmc3k",
    "name": "10x PBMC 3k",
    "provider": "10x Genomics",
    "modalities": [
      "Genomics"
    ],
    "summary": "Single-cell expression matrix from peripheral blood cells of one healthy donor.",
    "summaryZh": "单个健康供者外周血细胞的单细胞表达矩阵。",
    "description": "Filtered gene-barcode matrices for cell-type analysis and workflow development. This is blood tissue, not neural tissue; 2,700 cells were detected.",
    "domains": [
      "molecular",
      "methods"
    ],
    "species": "human",
    "researchQuestions": [
      {
        "en": "How can cell populations be identified from expression profiles?",
        "zh": "如何从基因表达识别细胞群体？"
      }
    ],
    "license": "CC BY 4.0",
    "access": "direct",
    "accessNote": "Downloads the filtered expression matrix archive, not FASTQ reads. Extract before use.",
    "homepage": "https://www.10xgenomics.com/datasets/3-k-pbm-cs-from-a-healthy-donor-1-standard-1-1-0",
    "version": "Cell Ranger 1.1.0",
    "formats": [
      "Matrix Market",
      "TSV",
      "tar.gz"
    ],
    "reviewedAt": "2026-09-07",
    "tool": "BrainPilot HTTP downloader",
    "downloadCommand": "curl -fL -C - -o pbmc3k_filtered_gene_bc_matrices.tar.gz https://cf.10xgenomics.com/samples/cell-exp/1.1.0/pbmc3k/pbmc3k_filtered_gene_bc_matrices.tar.gz",
    "recipe": {
      "type": "http",
      "url": "https://cf.10xgenomics.com/samples/cell-exp/1.1.0/pbmc3k/pbmc3k_filtered_gene_bc_matrices.tar.gz",
      "fileName": "pbmc3k_filtered_gene_bc_matrices.tar.gz"
    },
    "accessNoteZh": "下载过滤后的基因表达矩阵归档，不包含 FASTQ 原始读段；该数据来自血液组织，并非神经组织。"
  }
];

const SAMPLE_OPTIONS: Record<string, DatasetCatalogEntry["downloadOptions"]> = {
  "physionet-eegmat": [
    {
      "id": "sample",
      "label": "Paired rest / arithmetic example",
      "labelZh": "静息与心算配对示例",
      "description": "3 files with provider SHA-256 verification. A small example for validating your workflow.",
      "descriptionZh": "3 个文件，逐一核对提供方 SHA-256；适合验证读取和分析流程。",
      "recipe": {
        "type": "http-files",
        "files": [
          {
            "url": "https://physionet.org/files/eegmat/1.0.0/Subject00_1.edf",
            "fileName": "Subject00_1.edf",
            "checksum": {
              "algorithm": "sha256",
              "value": "8b23c443f2f5f733f8ccc31a54377898009c28c7563d1107692a8735212d2f15"
            }
          },
          {
            "url": "https://physionet.org/files/eegmat/1.0.0/Subject00_2.edf",
            "fileName": "Subject00_2.edf",
            "checksum": {
              "algorithm": "sha256",
              "value": "635bbf035777008ff6c23d9c7bfc497d584fc71c56217022946d1fd056527e43"
            }
          },
          {
            "url": "https://physionet.org/files/eegmat/1.0.0/subject-info.csv",
            "fileName": "subject-info.csv",
            "checksum": {
              "algorithm": "sha256",
              "value": "09c5951145d9f6a170ed7e01957406010ff549127ccf96ad7a2ead9fb0e018de"
            }
          }
        ]
      }
    }
  ],
  "physionet-sleep-edfx": [
    {
      "id": "sample",
      "label": "One night + sleep annotations",
      "labelZh": "一晚记录与睡眠分期标注",
      "description": "2 files with provider SHA-256 verification. A small example for validating your workflow.",
      "descriptionZh": "2 个文件，逐一核对提供方 SHA-256；适合验证读取和分析流程。",
      "recipe": {
        "type": "http-files",
        "files": [
          {
            "url": "https://physionet.org/files/sleep-edfx/1.0.0/sleep-cassette/SC4001E0-PSG.edf",
            "fileName": "sleep-cassette/SC4001E0-PSG.edf",
            "checksum": {
              "algorithm": "sha256",
              "value": "2b40a18adf76af69a42d6db1f30f31d26b369f6d27ca0050ef30147ef892b131"
            }
          },
          {
            "url": "https://physionet.org/files/sleep-edfx/1.0.0/sleep-cassette/SC4001EC-Hypnogram.edf",
            "fileName": "sleep-cassette/SC4001EC-Hypnogram.edf",
            "checksum": {
              "algorithm": "sha256",
              "value": "a4cf67694ade1b52a0ddd06d5817fd45d2d3e8bac5302f640f3e9cfbbf12a996"
            }
          }
        ]
      }
    }
  ]
};

export const DATASET_CATALOG: readonly DatasetCatalogEntry[] = [
  ...CORE_CATALOG.map((entry) => ({ ...entry, ...DISCOVERY[entry.id], ...(SAMPLE_OPTIONS[entry.id] ? { downloadOptions: SAMPLE_OPTIONS[entry.id], downloadReviewRequired: true } : {}) })),
  ...EXPANDED_CATALOG,
];
