import { spawn } from "node:child_process";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rename, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash, randomUUID } from "node:crypto";

export type DatasetAccess = "direct" | "credentials" | "application";
export type DatasetModality = "EEG" | "MEG" | "EOG" | "EMG" | "fMRI" | "MRI" | "Neuropixels" | "NWB" | "Microscopy" | "Genomics" | "Clinical" | "Behavior" | "fNIRS" | "ECoG" | "ECG" | "EDA" | "Calcium";

export interface DatasetCredentialField {
  id: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  help?: string;
}

export type FileChecksum = { algorithm: "sha256" | "md5"; value: string };

export type DownloadRecipe =
  | { type: "http"; url: string; fileName: string; checksum?: FileChecksum; basicAuth?: { username: string; password: string } }
  | { type: "command"; command: string; args: string[]; env?: Record<string, string>; stdin?: string }
  | { type: "datalad"; repository: string; revision?: string; paths?: string[] }
  | { type: "http-files"; files: Array<{ url: string; fileName: string; checksum?: FileChecksum }> };

export interface DatasetCatalogEntry {
  id: string;
  name: string;
  summary: string;
  summaryZh?: string;
  domains?: string[];
  species?: string;
  researchQuestions?: Array<{ en: string; zh: string }>;
  description: string;
  provider: string;
  modalities: DatasetModality[];
  subjects?: string;
  size?: string;
  license: string;
  access: DatasetAccess;
  accessNote: string;
  accessNoteZh?: string;
  homepage: string;
  citation?: string;
  version?: string;
  formats?: string[];
  tasks?: string[];
  reviewedAt?: string;
  checksumUrl?: string;
  credentialFields?: DatasetCredentialField[];
  tool?: string;
  downloadAvailable?: boolean;
  downloadReviewRequired?: boolean;
  downloadCommand?: string;
  downloadOptions?: Array<{ id: string; label: string; labelZh: string; description: string; descriptionZh: string; tool?: string; recipe?: DownloadRecipe }>;
  recipe?: DownloadRecipe;
}

export interface DatasetDownloadJob {
  id: string;
  datasetId: string;
  datasetName: string;
  selectionId?: string;
  selectionLabel?: string;
  status: "queued" | "downloading" | "completed" | "failed" | "cancelled";
  targetDir: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  bytesDownloaded?: number;
  totalBytes?: number;
}

import { DatasetJobRegistry } from "./datasetJobs.js";
import { DATASET_CATALOG } from "./datasetCatalog.js";
export { DATASET_CATALOG } from "./datasetCatalog.js";

const registries = new Map<string, Promise<DatasetJobRegistry>>();
function jobStore(dataDir: string): Promise<DatasetJobRegistry> {
  const root = path.resolve(dataDir);
  let registry = registries.get(root);
  if (!registry) {
    registry = DatasetJobRegistry.open(root).catch((error) => { registries.delete(root); throw error; });
    registries.set(root, registry);
  }
  return registry;
}
export function listDatasets(): DatasetCatalogEntry[] {
  return DATASET_CATALOG.map(({ recipe, downloadOptions, ...entry }) => ({
    ...entry, downloadAvailable: Boolean(recipe),
    ...(downloadOptions ? { downloadOptions: downloadOptions.map(({ recipe: optionRecipe, ...option }) => ({ ...option, tool: optionRecipe?.type === "datalad" ? "DataLad" : optionRecipe?.type === "http-files" ? "BrainPilot HTTP downloader" : entry.tool })) } : {}),
  }));
}

/** Check executable availability only; do not install tools or inspect credentials. */
export async function datasetDownloadRequirements(datasetId: string, selectionId = "full", env: NodeJS.ProcessEnv = process.env) {
  const dataset = DATASET_CATALOG.find((entry) => entry.id === datasetId);
  const recipe = selectionId === "full" ? dataset?.recipe : dataset?.downloadOptions?.find((option) => option.id === selectionId)?.recipe;
  if (!recipe) throw new Error("This download selection is not available. Open the provider to select data.");
  const tools = recipe.type === "datalad" ? ["datalad", "git", "git-annex"] : recipe.type === "command" ? [recipe.command] : [];
  const extensions = process.platform === "win32" ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";") : [""];
  const directories = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const found = await Promise.all(tools.map(async (tool) => {
    for (const directory of directories) {
      for (const extension of extensions) {
        const executable = path.join(directory, tool + extension);
        try {
          if (!(await stat(executable)).isFile()) continue;
          await access(executable, process.platform === "win32" ? constants.F_OK : constants.X_OK);
          return true;
        } catch { /* Try the next PATH entry. */ }
      }
    }
    return false;
  }));
  return { tools, missing: tools.filter((_, index) => !found[index]) };
}
export async function listDatasetJobs(dataDir: string): Promise<DatasetDownloadJob[]> { return (await jobStore(dataDir)).list(); }
export async function stopDatasetDownloads(dataDir: string): Promise<void> {
  const root = path.resolve(dataDir);
  const registry = registries.get(root);
  if (registry) { await (await registry).shutdown(); registries.delete(root); }
}
export async function cancelDatasetDownload(dataDir: string, id: string): Promise<DatasetDownloadJob> { return (await jobStore(dataDir)).cancel(id); }

function sanitizedEnvironment(recipe: Extract<DownloadRecipe, { type: "command" }>, credentials: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG };
  // git-annex creates local bookkeeping commits even for read-only downloads.
  // Supply a cache identity per invocation; never write the user's Git config.
  if (recipe.command === "datalad" || recipe.command === "git") {
    env.GIT_AUTHOR_NAME = env.GIT_COMMITTER_NAME = "BrainPilot dataset cache";
    env.GIT_AUTHOR_EMAIL = env.GIT_COMMITTER_EMAIL = "datasets@brainpilot.invalid";
  }
  for (const [key, credentialId] of Object.entries(recipe.env ?? {})) env[key] = credentialId === "__stdin__" ? "/dev/stdin" : credentials[credentialId];
  return env;
}

function interpolate(value: string, credentials: Record<string, string>): string {
  return value.replace(/\{\{([a-zA-Z0-9]+)\}\}/g, (_match, id: string) => credentials[id] ?? "");
}

async function runCommand(recipe: Extract<DownloadRecipe, { type: "command" }>, targetDir: string, credentials: Record<string, string>, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(recipe.command, recipe.args.map((arg) => interpolate(arg, credentials)), { cwd: targetDir, env: sanitizedEnvironment(recipe, credentials), stdio: [recipe.stdin ? "pipe" : "ignore", "ignore", "pipe"], shell: false, detached: process.platform !== "win32" });
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const kill = (kind: NodeJS.Signals) => {
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, kind); else child.kill(kind); } catch { /* already exited */ }
    };
    const abort = () => { kill("SIGTERM"); forceKill = setTimeout(() => kill("SIGKILL"), 2_000); forceKill.unref(); };
    signal?.addEventListener("abort", abort, { once: true });
    const onExit = () => kill("SIGKILL");
    process.once("exit", onExit);
    const cleanup = () => { process.removeListener("exit", onExit); signal?.removeEventListener("abort", abort); if (forceKill) clearTimeout(forceKill); if (signal?.aborted) kill("SIGKILL"); };
    child.stdin?.on("error", () => {}); // A downloader may exit before reading its config.
    if (recipe.stdin && child.stdin) child.stdin.end(interpolate(recipe.stdin, credentials));
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-4000); });
    child.on("error", (error) => { cleanup(); reject(new Error(error.message.includes("ENOENT") ? `Required downloader '${recipe.command}' is not installed or not on PATH` : error.message)); });
    child.on("close", (code) => { cleanup(); code === 0 && !signal?.aborted ? resolve() : reject(new Error(stderr.trim() || `${recipe.command} exited with code ${code}`)); });
    if (signal?.aborted) abort();
  });
}

async function runDatalad(recipe: Extract<DownloadRecipe, { type: "datalad" }>, targetDir: string, signal?: AbortSignal): Promise<void> {
  const repositoryExists = await stat(path.join(targetDir, ".git")).then((value) => value.isDirectory()).catch(() => false);
  if (!repositoryExists) await runCommand({ type: "command", command: "datalad", args: ["install", "-r", "-s", recipe.repository, "."] }, targetDir, {}, signal);
  if (recipe.revision) await runCommand({ type: "command", command: "git", args: ["checkout", "--detach", recipe.revision] }, targetDir, {}, signal);
  await runCommand({ type: "command", command: "datalad", args: ["get", "-r", "--", ...(recipe.paths ?? ["."])] }, targetDir, {}, signal);
}

async function verifyFileChecksum(file: string, checksum?: FileChecksum, signal?: AbortSignal): Promise<void> {
  if (!checksum) return;
  const hash = createHash(checksum.algorithm);
  for await (const chunk of createReadStream(file)) { signal?.throwIfAborted(); hash.update(chunk); }
  signal?.throwIfAborted();
  if (hash.digest("hex") !== checksum.value.toLowerCase()) {
    // Preserve unverified bytes, but keep them out of final-file reuse and Range retries.
    const preserved = `${file}.corrupt-${randomUUID()}`;
    await rename(file, preserved);
    throw new Error(`Dataset checksum mismatch; unverified file preserved as ${path.basename(preserved)}. Retry to download a fresh copy.`);
  }
}

export async function downloadHttpFile(
  url: string,
  destination: string,
  options: { availableBytes?: () => Promise<number>; signal?: AbortSignal; checksum?: FileChecksum; headers?: Headers | Record<string, string> | Array<[string, string]>; fetchFn?: typeof fetch; onProgress?: (downloaded: number, total?: number) => void } = {},
): Promise<{ bytesDownloaded: number; totalBytes?: number; reused: boolean }> {
  options.signal?.throwIfAborted();
  const existingFinal = await stat(destination).catch(() => null);
  if (existingFinal?.isFile()) {
    await verifyFileChecksum(destination, options.checksum, options.signal);
    options.onProgress?.(existingFinal.size, existingFinal.size);
    return { bytesDownloaded: existingFinal.size, totalBytes: existingFinal.size, reused: true };
  }
  const partial = `${destination}.part`;
  const partialStat = await stat(partial).catch(() => null);
  const partialBytes = partialStat?.isFile() ? partialStat.size : 0;
  const headers = new Headers(options.headers);
  if (partialBytes > 0) headers.set("Range", `bytes=${partialBytes}-`);
  const response = await (options.fetchFn ?? fetch)(url, { headers, redirect: "follow", signal: options.signal });
  if (response.status === 416 && partialBytes > 0) {
    const completeSize = response.headers.get("content-range")?.match(/^bytes \*\/(\d+)$/)?.[1];
    if (!completeSize || Number(completeSize) !== partialBytes) {
      await response.body?.cancel();
      throw new Error("Provider rejected the resume offset; partial file size does not match the remote file");
    }
    await response.body?.cancel();
    await verifyFileChecksum(partial, options.checksum, options.signal);
    options.signal?.throwIfAborted();
    await rename(partial, destination);
    options.onProgress?.(partialBytes, partialBytes);
    return { bytesDownloaded: partialBytes, totalBytes: partialBytes, reused: false };
  }
  if (!response.ok || !response.body) throw new Error(`Dataset provider returned HTTP ${response.status}`);
  const append = partialBytes > 0 && response.status === 206;
  const startingBytes = append ? partialBytes : 0;
  const lengthHeader = response.headers.get("content-length");
  const contentLength = lengthHeader === null ? undefined : Number(lengthHeader);
  let totalBytes = contentLength !== undefined && Number.isSafeInteger(contentLength) && contentLength >= 0 ? startingBytes + contentLength : undefined;
  if (response.status === 206) {
    const range = response.headers.get("content-range")?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    const start = Number(range?.[1]);
    const end = Number(range?.[2]);
    const total = Number(range?.[3]);
    if (!range || start !== startingBytes || end < start || end >= total || !Number.isSafeInteger(total) ||
        (contentLength !== undefined && contentLength !== end - start + 1)) {
      await response.body.cancel();
      throw new Error("Provider returned an invalid Content-Range; partial file was preserved");
    }
    totalBytes = total;
  }
  if (totalBytes !== undefined) {
    const freeBytes = options.availableBytes ? await options.availableBytes() : await statfs(path.dirname(destination)).then((disk) => disk.bavail * disk.bsize);
    const required = totalBytes - startingBytes;
    if (required > freeBytes + (append ? 0 : partialBytes)) {
      await response.body.cancel();
      throw new Error("Not enough disk space for this download. Choose a smaller subset or free up space.");
    }
  }
  let downloaded = startingBytes;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      downloaded += chunk.length;
      options.onProgress?.(downloaded, totalBytes);
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body as never), counter, createWriteStream(partial, { flags: append ? "a" : "w" }), { signal: options.signal });
  if (totalBytes !== undefined && downloaded !== totalBytes) throw new Error("Incomplete dataset download; retry to resume the partial file");
  await verifyFileChecksum(partial, options.checksum, options.signal);
  options.signal?.throwIfAborted();
  await rename(partial, destination);
  return { bytesDownloaded: downloaded, ...(totalBytes === undefined ? {} : { totalBytes }), reused: false };
}

async function runHttp(recipe: Extract<DownloadRecipe, { type: "http" }>, targetDir: string, credentials: Record<string, string>, job: DatasetDownloadJob, signal?: AbortSignal): Promise<void> {
  const headers = new Headers();
  if (recipe.basicAuth) {
    const username = credentials[recipe.basicAuth.username] ?? "";
    const password = credentials[recipe.basicAuth.password] ?? "";
    headers.set("Authorization", `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`);
  }
  const result = await downloadHttpFile(recipe.url, path.join(targetDir, recipe.fileName), {
    headers,
    checksum: recipe.checksum,
    signal,
    onProgress: (downloaded, total) => {
      job.bytesDownloaded = downloaded;
      if (total !== undefined) job.totalBytes = total;
    },
  });
  job.bytesDownloaded = result.bytesDownloaded;
  if (result.totalBytes !== undefined) job.totalBytes = result.totalBytes;
}

export async function startDatasetDownload(dataDir: string, datasetId: string, credentials: Record<string, string> = {}, selectionId = "full"): Promise<DatasetDownloadJob> {
  const dataset = DATASET_CATALOG.find((entry) => entry.id === datasetId);
  if (!dataset) throw new Error("dataset not found");
  const option = dataset.downloadOptions?.find((item) => item.id === selectionId);
  const recipe = selectionId === "full" ? dataset.recipe : option?.recipe;
  if (!recipe) throw new Error("This download selection is not available. Open the provider to select data.");
  for (const field of dataset.credentialFields ?? []) {
    if (field.required && !credentials[field.id]?.trim()) throw new Error(`${field.label} is required`);
  }
  if (Object.values(credentials).some((value) => /[\r\n\0]/.test(value))) throw new Error("Credentials must not contain line breaks or null bytes");
  const requirements = await datasetDownloadRequirements(datasetId, selectionId);
  if (requirements.missing.length) throw new Error(`Missing download tools: ${requirements.missing.join(", ")}`);
  const root = path.resolve(dataDir, "data", "datasets");
  const targetDir = selectionId === "full" ? path.join(root, dataset.id) : path.join(root, `${dataset.id}--${selectionId}`);
  if (!targetDir.startsWith(`${root}${path.sep}`)) throw new Error("invalid dataset target");
  const store = await jobStore(dataDir);
  const secrets = { ...credentials };
  const job: DatasetDownloadJob = { id: randomUUID(), datasetId, datasetName: dataset.name, selectionId, selectionLabel: option?.label, status: "queued", targetDir, startedAt: new Date().toISOString() };
  return store.start(job, async (signal) => {
    try {
      await mkdir(targetDir, { recursive: true });
      if (recipe.type === "http") await runHttp(recipe, targetDir, secrets, job, signal);
      else if (recipe.type === "datalad") await runDatalad(recipe, targetDir, signal);
      else if (recipe.type === "command") await runCommand(recipe, targetDir, secrets, signal);
      else {
        let finishedBytes = 0;
        for (const file of recipe.files) {
          const destination = path.resolve(targetDir, file.fileName);
          if (!destination.startsWith(`${targetDir}${path.sep}`)) throw new Error("Invalid sample file path");
          await mkdir(path.dirname(destination), { recursive: true });
          const result = await downloadHttpFile(file.url, destination, { signal, checksum: file.checksum, onProgress: (bytes) => { job.bytesDownloaded = finishedBytes + bytes; } });
          finishedBytes += result.bytesDownloaded;
        }
        job.bytesDownloaded = finishedBytes;
        job.totalBytes = finishedBytes;
      }
    } catch (reason) {
      let message = reason instanceof Error ? reason.message : String(reason);
      for (const value of Object.values(secrets)) if (value) message = message.split(value).join("[redacted]");
      throw new Error(message);
    }
  }, () => { for (const key of Object.keys(secrets)) secrets[key] = ""; });
}
