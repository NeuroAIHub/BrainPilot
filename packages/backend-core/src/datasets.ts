import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";

export type DatasetAccess = "direct" | "credentials" | "application";
export type DatasetModality = "EEG" | "fMRI" | "MRI" | "Neuropixels" | "NWB" | "Genomics" | "Clinical";

export interface DatasetCredentialField {
  id: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  help?: string;
}

type DownloadRecipe =
  | { type: "http"; url: string; fileName: string; basicAuth?: { username: string; password: string } }
  | { type: "command"; command: string; args: string[]; env?: Record<string, string>; stdin?: string }
  | { type: "datalad"; repository: string };

export interface DatasetCatalogEntry {
  id: string;
  name: string;
  summary: string;
  description: string;
  provider: string;
  modalities: DatasetModality[];
  subjects?: string;
  size?: string;
  license: string;
  access: DatasetAccess;
  accessNote: string;
  homepage: string;
  citation?: string;
  credentialFields?: DatasetCredentialField[];
  tool?: string;
  downloadAvailable?: boolean;
  downloadCommand?: string;
  recipe?: DownloadRecipe;
}

export interface DatasetDownloadJob {
  id: string;
  datasetId: string;
  datasetName: string;
  status: "queued" | "downloading" | "completed" | "failed";
  targetDir: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  bytesDownloaded?: number;
  totalBytes?: number;
}

// The catalogue intentionally stores metadata and recipes only. Credentials are
// accepted for a single launch and passed directly to the downloader process;
// they are never returned, logged, or persisted.
export const DATASET_CATALOG: readonly DatasetCatalogEntry[] = [
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
    id: "dandi-000026", name: "DANDI 000026", provider: "DANDI Archive", modalities: ["NWB", "Neuropixels"], size: "~70 GB",
    summary: "Allen Institute Visual Coding Neuropixels recordings in NWB format.",
    description: "Public extracellular electrophysiology recordings from mouse visual areas, packaged as standards-compliant NWB assets.",
    license: "CC BY 4.0", access: "direct", accessNote: "Public. Requires the dandi CLI.", homepage: "https://dandiarchive.org/dandiset/000026", tool: "dandi",
    downloadCommand: "dandi download --format PYOUT --path-type EXACT --existing REFRESH --output-dir . DANDI:000026",
    recipe: { type: "command", command: "dandi", args: ["download", "--format", "PYOUT", "--path-type", "EXACT", "--existing", "REFRESH", "--output-dir", ".", "DANDI:000026"] },
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

const jobsByDataRoot = new Map<string, Map<string, DatasetDownloadJob>>();

function jobStore(dataDir: string): Map<string, DatasetDownloadJob> {
  const root = path.resolve(dataDir);
  let store = jobsByDataRoot.get(root);
  if (!store) {
    store = new Map();
    jobsByDataRoot.set(root, store);
  }
  return store;
}

export function listDatasets(): DatasetCatalogEntry[] {
  return DATASET_CATALOG.map(({ recipe, ...entry }) => ({ ...entry, downloadAvailable: Boolean(recipe) }));
}

export function listDatasetJobs(dataDir: string): DatasetDownloadJob[] {
  return [...jobStore(dataDir).values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function sanitizedEnvironment(recipe: Extract<DownloadRecipe, { type: "command" }>, credentials: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG };
  for (const [key, credentialId] of Object.entries(recipe.env ?? {})) env[key] = credentialId === "__stdin__" ? "/dev/stdin" : credentials[credentialId];
  return env;
}

function interpolate(value: string, credentials: Record<string, string>): string {
  return value.replace(/\{\{([a-zA-Z0-9]+)\}\}/g, (_match, id: string) => credentials[id] ?? "");
}

async function runCommand(recipe: Extract<DownloadRecipe, { type: "command" }>, targetDir: string, credentials: Record<string, string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(recipe.command, recipe.args.map((arg) => interpolate(arg, credentials)), { cwd: targetDir, env: sanitizedEnvironment(recipe, credentials), stdio: [recipe.stdin ? "pipe" : "ignore", "ignore", "pipe"], shell: false });
    if (recipe.stdin && child.stdin) child.stdin.end(interpolate(recipe.stdin, credentials));
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-4000); });
    child.on("error", (error) => reject(new Error(error.message.includes("ENOENT") ? `Required downloader '${recipe.command}' is not installed or not on PATH` : error.message)));
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `${recipe.command} exited with code ${code}`)));
  });
}

async function runDatalad(recipe: Extract<DownloadRecipe, { type: "datalad" }>, targetDir: string): Promise<void> {
  const repositoryExists = await stat(path.join(targetDir, ".git")).then((value) => value.isDirectory()).catch(() => false);
  await runCommand(repositoryExists
    ? { type: "command", command: "datalad", args: ["get", "-r", "."] }
    : { type: "command", command: "datalad", args: ["install", "-r", "-g", "-s", recipe.repository, "."] }, targetDir, {});
}

export async function downloadHttpFile(
  url: string,
  destination: string,
  options: { headers?: Headers | Record<string, string> | Array<[string, string]>; fetchFn?: typeof fetch; onProgress?: (downloaded: number, total?: number) => void } = {},
): Promise<{ bytesDownloaded: number; totalBytes?: number; reused: boolean }> {
  const existingFinal = await stat(destination).catch(() => null);
  if (existingFinal?.isFile()) {
    options.onProgress?.(existingFinal.size, existingFinal.size);
    return { bytesDownloaded: existingFinal.size, totalBytes: existingFinal.size, reused: true };
  }
  const partial = `${destination}.part`;
  const partialStat = await stat(partial).catch(() => null);
  const partialBytes = partialStat?.isFile() ? partialStat.size : 0;
  const headers = new Headers(options.headers);
  if (partialBytes > 0) headers.set("Range", `bytes=${partialBytes}-`);
  const response = await (options.fetchFn ?? fetch)(url, { headers, redirect: "follow" });
  if (response.status === 416 && partialBytes > 0) {
    await rename(partial, destination);
    options.onProgress?.(partialBytes, partialBytes);
    return { bytesDownloaded: partialBytes, totalBytes: partialBytes, reused: false };
  }
  if (!response.ok || !response.body) throw new Error(`Dataset provider returned HTTP ${response.status}`);
  const append = partialBytes > 0 && response.status === 206;
  const startingBytes = append ? partialBytes : 0;
  const contentLength = Number(response.headers.get("content-length"));
  const totalBytes = Number.isFinite(contentLength) && contentLength >= 0 ? startingBytes + contentLength : undefined;
  let downloaded = startingBytes;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      downloaded += chunk.length;
      options.onProgress?.(downloaded, totalBytes);
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body as never), counter, createWriteStream(partial, { flags: append ? "a" : "w" }));
  await rename(partial, destination);
  return { bytesDownloaded: downloaded, ...(totalBytes === undefined ? {} : { totalBytes }), reused: false };
}

async function runHttp(recipe: Extract<DownloadRecipe, { type: "http" }>, targetDir: string, credentials: Record<string, string>, job: DatasetDownloadJob): Promise<void> {
  const headers = new Headers();
  if (recipe.basicAuth) {
    const username = credentials[recipe.basicAuth.username] ?? "";
    const password = credentials[recipe.basicAuth.password] ?? "";
    headers.set("Authorization", `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`);
  }
  const result = await downloadHttpFile(recipe.url, path.join(targetDir, recipe.fileName), {
    headers,
    onProgress: (downloaded, total) => {
      job.bytesDownloaded = downloaded;
      if (total !== undefined) job.totalBytes = total;
    },
  });
  job.bytesDownloaded = result.bytesDownloaded;
  if (result.totalBytes !== undefined) job.totalBytes = result.totalBytes;
}

export async function startDatasetDownload(dataDir: string, datasetId: string, credentials: Record<string, string> = {}): Promise<DatasetDownloadJob> {
  const dataset = DATASET_CATALOG.find((entry) => entry.id === datasetId);
  if (!dataset) throw new Error("dataset not found");
  if (!dataset.recipe) throw new Error("This dataset must be downloaded through the provider after approval");
  for (const field of dataset.credentialFields ?? []) {
    if (field.required && !credentials[field.id]?.trim()) throw new Error(`${field.label} is required`);
  }
  const root = path.resolve(dataDir, "data", "datasets");
  const targetDir = path.join(root, dataset.id);
  if (!targetDir.startsWith(`${root}${path.sep}`)) throw new Error("invalid dataset target");
  const jobs = jobStore(dataDir);
  const active = [...jobs.values()].find((job) => job.datasetId === datasetId && (job.status === "queued" || job.status === "downloading"));
  if (active) return active;
  await mkdir(targetDir, { recursive: true });
  const job: DatasetDownloadJob = { id: randomUUID(), datasetId, datasetName: dataset.name, status: "queued", targetDir, startedAt: new Date().toISOString() };
  jobs.set(job.id, job);
  const recipe = dataset.recipe as DownloadRecipe;
  void (async () => {
    job.status = "downloading";
    try {
      if (recipe.type === "http") await runHttp(recipe, targetDir, credentials, job);
      else if (recipe.type === "datalad") await runDatalad(recipe, targetDir);
      else await runCommand(recipe, targetDir, credentials);
      job.status = "completed";
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
      await rm(path.join(targetDir, ".credentials"), { force: true }).catch(() => undefined);
    } finally {
      job.finishedAt = new Date().toISOString();
      for (const key of Object.keys(credentials)) credentials[key] = "";
    }
  })();
  return job;
}
