import { accessSync, constants, statSync } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { delimiter, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { isSafeWorkflowOutputPath, type WorkflowArtifact } from "@brainpilot/plugin-sdk/workflow";

const COMMAND_TIMEOUT_MS = 30_000;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 128;
const MAX_ENTRIES = 512;
const MAX_DEPTH = 12;
const MAX_RENDER_PAGES = 24;
const MAX_COMMAND_OUTPUT = 256 * 1024;
const MAX_COMPILE_LOG = 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export type NativeWorkflowExecutable = "pdflatex" | "bibtex" | "pdftotext" | "pdftoppm";
export interface NativeWorkflowCommand {
  command: NativeWorkflowExecutable;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  timeoutMs: number;
  maxOutputBytes: number;
}
export interface NativeWorkflowCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputTruncated?: boolean;
  error?: string;
}
export type NativeWorkflowCommandRunner = (command: NativeWorkflowCommand) => Promise<NativeWorkflowCommandResult>;

export interface NativeWorkflowToolOptions {
  runId: string;
  workspaceDir: string;
  request: { name: string; input: unknown };
  signal: AbortSignal;
  publishFile(args: { sourcePath: string; path: string; mediaType: string; role: string }): Promise<WorkflowArtifact>;
  /** Test injection only. Workflow requests cannot choose commands or executables. */
  runner?: NativeWorkflowCommandRunner;
}

function executableInPath(command: string, searchPath: string): string | undefined {
  for (const directory of searchPath.split(delimiter)) {
    const candidate = resolve(directory || ".", command);
    try { if (statSync(candidate).isFile()) { accessSync(candidate, constants.X_OK); return candidate; } }
    catch { /* try the next configured directory */ }
  }
  return undefined;
}

/** Only POSIX hosts with the actual executables advertise process-backed tools. */
export function nativeWorkflowCapabilities(searchPath = process.env.PATH ?? ""): string[] {
  const capabilities = ["copy_files", "list_files"];
  if (process.platform === "win32") return capabilities;
  if (["pdflatex", "bibtex", "pdftotext"].every((command) => executableInPath(command, searchPath))) capabilities.push("compile_latex");
  if (executableInPath("pdftoppm", searchPath)) capabilities.push("render_pdf");
  return capabilities;
}

/** Spawn one allowlisted binary, bound its output and terminate its owned group. */
export const runNativeWorkflowCommand: NativeWorkflowCommandRunner = async (request) => {
  request.signal.throwIfAborted();
  if (process.platform === "win32") throw new Error("Native workflow process tools require POSIX process-group cancellation");
  const executable = executableInPath(request.command, request.env.PATH ?? "");
  if (!executable) return { exitCode: null, stdout: "", stderr: "", timedOut: false, error: `Required executable not found: ${request.command}` };
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, request.args, { cwd: request.cwd, env: request.env, shell: false,
      detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout: Buffer = Buffer.alloc(0); let stderr: Buffer = Buffer.alloc(0);
    let outputTruncated = false; let timedOut = false; let spawnError: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const halfLimit = Math.max(1, Math.floor(request.maxOutputBytes / 2));
    const append = (previous: Buffer, chunk: Buffer) => {
      const remaining = Math.max(0, halfLimit - previous.length);
      if (chunk.length > remaining) outputTruncated = true;
      return remaining ? Buffer.concat([previous, chunk.subarray(0, remaining)]) : previous;
    };
    const killGroup = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") spawnError ??= `Unable to stop owned process group: ${(error as Error).message}`; }
    };
    const stop = () => {
      killGroup("SIGTERM");
      escalation ??= setTimeout(() => killGroup("SIGKILL"), 1_000);
      escalation.unref();
    };
    child.stdout?.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.once("error", (error) => { spawnError = error.message; });
    request.signal.addEventListener("abort", stop, { once: true });
    timer = setTimeout(() => { timedOut = true; stop(); }, request.timeoutMs);
    timer.unref();
    child.once("close", (exitCode) => {
      clearTimeout(timer); clearTimeout(escalation);
      request.signal.removeEventListener("abort", stop);
      // A child can exit before an ignoring grandchild. Finish the owned group
      // before resolving cancellation, even when that grandchild closed stdio.
      if (timedOut || request.signal.aborted) killGroup("SIGKILL");
      if (request.signal.aborted) { reject(request.signal.reason ?? new Error("Workflow command cancelled")); return; }
      resolveResult({ exitCode, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), timedOut,
        ...(outputTruncated ? { outputTruncated } : {}), ...(spawnError ? { error: spawnError } : {}) });
    });
    if (request.signal.aborted) stop();
  });
};

const fileMapping = z.object({ sourcePath: z.string().min(1), targetPath: z.string().min(1) }).strict();
const compileInput = z.object({
  stem: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/), source: z.string().min(1),
  bibliography: z.string().optional(), assets: z.array(fileMapping).max(MAX_FILES).optional(),
}).strict();
const renderInput = z.object({ pdfPath: z.string().min(1) }).strict();
const copyInput = z.object({ files: z.array(fileMapping).min(1).max(MAX_FILES) }).strict();
const listInput = z.object({ path: z.string().min(1) }).strict();

function byteLimit(text: string, label: string): void {
  if (Buffer.byteLength(text) > MAX_TEXT_BYTES) throw new Error(`${label} exceeds ${MAX_TEXT_BYTES} bytes`);
}
function workspaceRelative(root: string, path: string): string { return relative(root, path).split(sep).join("/"); }
function assertRelativeOutput(path: string): void {
  if (!isSafeWorkflowOutputPath(path) || path === ".work" || path.startsWith(".work/")) throw new Error("Output path must remain in the run output directory");
}

/** Resolve without following any input symlinks or accepting lexical traversal. */
async function safePath(root: string, requested: string): Promise<string> {
  if (!requested || requested.includes("\0") || requested.includes("\\") || requested.split("/").includes("..")) throw new Error("Invalid or traversing workspace path");
  const logical = requested === "/workspace" ? "." : requested.startsWith("/workspace/") ? requested.slice(11) : requested;
  const target = isAbsolute(logical) ? resolve(logical) : resolve(root, logical);
  if (target !== root && !target.startsWith(root + sep)) throw new Error("File is outside the workflow workspace");
  const parts = relative(root, target).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error("Workflow tools cannot follow symlinks");
  }
  const canonical = await realpath(target);
  if (canonical !== root && !canonical.startsWith(root + sep)) throw new Error("File escapes the workflow workspace");
  return canonical;
}

async function readRegular(root: string, requested: string, signal: AbortSignal, maximum = MAX_FILE_BYTES): Promise<{ path: string; bytes: Buffer }> {
  signal.throwIfAborted();
  const path = await safePath(root, requested);
  const beforeOpen = await lstat(path);
  if (!beforeOpen.isFile() || beforeOpen.size > maximum) throw new Error(`Expected a regular file of at most ${maximum} bytes`);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maximum) throw new Error(`Expected a regular file of at most ${maximum} bytes`);
    const chunks: Buffer[] = []; let total = 0;
    for (;;) {
      signal.throwIfAborted();
      const buffer = Buffer.alloc(Math.min(64 * 1024, maximum + 1 - total));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maximum) throw new Error(`File grew beyond ${maximum} bytes while reading`);
      chunks.push(buffer.subarray(0, bytesRead));
    }
    signal.throwIfAborted();
    return { path, bytes: Buffer.concat(chunks, total) };
  } finally { await file.close(); }
}

async function safeDirectories(root: string, parts: string[]): Promise<string> {
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    await mkdir(current).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Workflow output directories cannot be symlinks");
    const canonical = await realpath(current);
    if (!canonical.startsWith(root + sep)) throw new Error("Workflow output directory escaped its root");
    current = canonical;
  }
  return current;
}

async function temporaryDirectory(root: string, runId: string, prefix: string): Promise<string> {
  const work = await safeDirectories(root, ["workflow-runs", runId, ".work"]);
  return mkdtemp(join(work, `${prefix}-`));
}

function commandEnvironment(cwd: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const sensitive = /(api[_-]?key|token|secret|password|credential|authorization|cookie)/i;
  const texOverrides = new Set(["TEXINPUTS", "TEXMFHOME", "TEXMF", "TEXMFVAR", "TEXMFCONFIG", "TEXMFOUTPUT"]);
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !sensitive.test(key) && !texOverrides.has(key)) env[key] = value;
  // The upstream utility removes inherited TeX search overrides. Keep that
  // isolation and place any per-user caches inside this invocation's directory.
  return { ...env, TEXMFVAR: join(cwd, "texmf-var"), TEXMFCONFIG: join(cwd, "texmf-config"),
    TEXMFHOME: join(cwd, "texmf-home"), openin_any: "p", openout_any: "p", shell_escape: "f" };
}

function mediaType(path: string): string {
  return ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pdf": "application/pdf",
    ".svg": "image/svg+xml", ".tex": "application/x-tex", ".bib": "application/x-bibtex", ".json": "application/json",
    ".md": "text/markdown", ".csv": "text/csv", ".txt": "text/plain", ".cls": "text/plain", ".sty": "text/plain" } as Record<string, string>)[extname(path).toLowerCase()] ?? "application/octet-stream";
}

async function command(options: NativeWorkflowToolOptions, cwd: string, executable: NativeWorkflowExecutable, args: string[], maxOutputBytes = MAX_COMMAND_OUTPUT): Promise<NativeWorkflowCommandResult> {
  options.signal.throwIfAborted();
  const result = await (options.runner ?? runNativeWorkflowCommand)({ command: executable, args, cwd, env: commandEnvironment(cwd),
    signal: options.signal, timeoutMs: COMMAND_TIMEOUT_MS, maxOutputBytes });
  options.signal.throwIfAborted();
  return result;
}

function logEntry(name: string, args: string[], result: NativeWorkflowCommandResult, omitStdout = false): string {
  return [`$ ${name} ${args.join(" ")}`, `exit=${result.exitCode}; timeout=${result.timedOut}`,
    result.error ?? "", omitStdout ? `[extracted ${Buffer.byteLength(result.stdout)} text bytes]` : result.stdout,
    result.stderr, result.outputTruncated ? "[command output truncated]" : ""].filter(Boolean).join("\n");
}

async function compileLatex(options: NativeWorkflowToolOptions, root: string) {
  const input = compileInput.parse(options.request.input);
  byteLimit(input.source, "LaTeX source"); byteLimit(input.bibliography ?? "", "Bibliography");
  const cwd = await temporaryDirectory(root, options.runId, "latex");
  try {
    await writeFile(join(cwd, "main.tex"), input.source, { flag: "wx", signal: options.signal });
    await writeFile(join(cwd, "references.bib"), input.bibliography ?? "", { flag: "wx", signal: options.signal });
    let bytes = Buffer.byteLength(input.source) + Buffer.byteLength(input.bibliography ?? "");
    const targets = new Set<string>();
    for (const asset of input.assets ?? []) {
      assertRelativeOutput(asset.targetPath);
      if (targets.has(asset.targetPath) || /^main\.[^/]+$/i.test(asset.targetPath) || asset.targetPath === "references.bib") throw new Error("Asset collides with a compiler-owned or duplicate target");
      targets.add(asset.targetPath);
      const source = await readRegular(root, asset.sourcePath, options.signal);
      bytes += source.bytes.length;
      if (bytes > MAX_TOTAL_BYTES) throw new Error("LaTeX assets exceed the total byte limit");
      const parent = await safeDirectories(cwd, asset.targetPath.split("/").slice(0, -1));
      await writeFile(join(parent, asset.targetPath.split("/").at(-1)!), source.bytes, { flag: "wx", signal: options.signal });
    }
    // Faithful command order from PaperOrchestra utils/pdf_utils.py (ca1b3fa).
    // BibTeX always runs; its normal no-citations failure does not end the loop.
    const commands: Array<[NativeWorkflowExecutable, string[]]> = [
      ["pdflatex", ["-interaction=nonstopmode", "-no-shell-escape", "main.tex"]],
      ["bibtex", ["main"]],
      ["pdflatex", ["-interaction=nonstopmode", "-no-shell-escape", "main.tex"]],
      ["pdflatex", ["-interaction=nonstopmode", "-no-shell-escape", "main.tex"]],
    ];
    const results: NativeWorkflowCommandResult[] = []; const logs: string[] = [];
    for (const [name, args] of commands) {
      let result: NativeWorkflowCommandResult;
      try { result = await command(options, cwd, name, args); }
      catch (error) { options.signal.throwIfAborted(); result = { exitCode: null, stdout: "", stderr: "", timedOut: false, error: (error as Error).message }; }
      results.push(result); logs.push(logEntry(name, args, result));
    }
    let success = !results.some((item) => item.timedOut) && results.at(-1)?.exitCode === 0;
    let pdf: { path: string; bytes: Buffer } | undefined; let text: string | undefined;
    try {
      pdf = await readRegular(root, join(cwd, "main.pdf"), options.signal);
      if (!pdf.bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) || !pdf.bytes.subarray(-1024).includes(Buffer.from("%%EOF"))) throw new Error("Compiler did not produce a complete PDF file");
    } catch (error) { options.signal.throwIfAborted(); success = false; logs.push((error as Error).message); }
    if (success && pdf) {
      try {
        const args = ["-enc", "UTF-8", "main.pdf", "-"];
        const extracted = await command(options, cwd, "pdftotext", args, MAX_TEXT_BYTES);
        logs.push(logEntry("pdftotext", args, extracted, true));
        if (extracted.exitCode === 0 && !extracted.timedOut) text = extracted.stdout;
      } catch (error) { options.signal.throwIfAborted(); logs.push(`PDF text extraction unavailable: ${(error as Error).message}`); }
    }
    const fullLog = logs.join("\n\n");
    const log = Buffer.byteLength(fullLog) > MAX_COMPILE_LOG
      ? Buffer.from(fullLog).subarray(0, MAX_COMPILE_LOG).toString("utf8") + "\n[compile log truncated]" : fullLog;
    const logPath = join(cwd, "compile-output.log");
    await writeFile(logPath, log, { flag: "wx", signal: options.signal });
    options.signal.throwIfAborted();
    const artifacts = [await options.publishFile({ sourcePath: logPath, path: `${input.stem}-compile.log`, mediaType: "text/plain", role: "compile-log" })];
    if (!success || !pdf) return { data: { success: false, log }, artifacts };
    options.signal.throwIfAborted();
    const artifact = await options.publishFile({ sourcePath: pdf.path, path: `${input.stem}.pdf`, mediaType: "application/pdf", role: "manuscript-pdf" });
    artifacts.push(artifact);
    return { data: { success: true, pdfPath: artifact.path, ...(text !== undefined ? { text } : {}), log }, artifacts };
  } finally { await rm(cwd, { recursive: true, force: true }); }
}

async function renderPdf(options: NativeWorkflowToolOptions, root: string) {
  const input = renderInput.parse(options.request.input);
  const pdf = await readRegular(root, input.pdfPath, options.signal);
  if (!pdf.bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("render_pdf requires a PDF file");
  const cwd = await temporaryDirectory(root, options.runId, "render");
  let keep = false;
  try {
    await writeFile(join(cwd, "input.pdf"), pdf.bytes, { flag: "wx", signal: options.signal });
    // One extra page detects oversized papers without silently returning a prefix.
    // scale-to bounds per-page pixels; ordinary 100-dpi paper pages fit unchanged.
    const result = await command(options, cwd, "pdftoppm", ["-png", "-r", "100", "-scale-to", "1600", "-f", "1", "-l", String(MAX_RENDER_PAGES + 1), "input.pdf", "page"]);
    if (result.exitCode !== 0 || result.timedOut || result.error) throw new Error(`PDF rendering failed: ${result.error ?? result.stderr}`);
    const pages = (await readdir(cwd)).filter((name) => /^page-\d+\.png$/.test(name)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    if (!pages.length || pages.length > MAX_RENDER_PAGES) throw new Error(`PDF rendering requires 1–${MAX_RENDER_PAGES} pages`);
    const imagePaths: string[] = []; let total = 0;
    for (const page of pages) {
      const image = await readRegular(root, join(cwd, page), options.signal);
      if (!image.bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("Renderer output is not a PNG image");
      total += image.bytes.length;
      if (total > MAX_TOTAL_BYTES) throw new Error("Rendered images exceed the total byte limit");
      imagePaths.push(workspaceRelative(root, image.path));
    }
    options.signal.throwIfAborted(); keep = true;
    return { data: { imagePaths }, artifacts: [] };
  } finally { if (!keep) await rm(cwd, { recursive: true, force: true }); }
}

async function copyFiles(options: NativeWorkflowToolOptions, root: string) {
  const input = copyInput.parse(options.request.input);
  const runRoot = await safeDirectories(root, ["workflow-runs", options.runId]);
  const targets = new Set<string>(); let total = 0;
  const prepared = [];
  for (const file of input.files) {
    assertRelativeOutput(file.targetPath);
    if (targets.has(file.targetPath)) throw new Error("copy_files targets must be unique");
    targets.add(file.targetPath);
    const source = await readRegular(root, file.sourcePath, options.signal);
    total += source.bytes.length;
    if (total > MAX_TOTAL_BYTES) throw new Error("copy_files exceeds the total byte limit");
    const target = join(runRoot, file.targetPath);
    prepared.push({ ...file, source, target });
  }
  const artifacts: WorkflowArtifact[] = []; const files: Array<{ sourcePath: string; path: string }> = [];
  for (const file of prepared) {
    options.signal.throwIfAborted();
    let existing: Awaited<ReturnType<typeof readRegular>> | undefined;
    try { existing = await readRegular(root, file.target, options.signal); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    let artifact: WorkflowArtifact;
    if (existing) {
      if (!existing.bytes.equals(file.source.bytes)) throw new Error(`copy_files will not overwrite changed target: ${file.targetPath}`);
      artifact = { path: workspaceRelative(root, existing.path), mediaType: mediaType(file.targetPath), role: "supporting-file",
        sha256: createHash("sha256").update(existing.bytes).digest("hex"), producerRunId: options.runId };
    } else {
      artifact = await options.publishFile({ sourcePath: file.source.path, path: file.targetPath, mediaType: mediaType(file.targetPath), role: "supporting-file" });
    }
    artifacts.push(artifact); files.push({ sourcePath: file.sourcePath, path: artifact.path });
  }
  return { data: { files }, artifacts };
}

async function listFiles(options: NativeWorkflowToolOptions, root: string) {
  const input = listInput.parse(options.request.input);
  const requestedRoot = await safePath(root, input.path);
  if (!(await lstat(requestedRoot)).isDirectory()) throw new Error("list_files requires a workspace directory");
  const files: Array<{ path: string; relativePath: string }> = [];
  let entries = 0; let bytes = 0;
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) throw new Error("list_files exceeds the directory depth limit");
    for (const name of (await readdir(directory)).sort()) {
      options.signal.throwIfAborted();
      if (++entries > MAX_ENTRIES) throw new Error("list_files exceeds the entry limit");
      const path = await safePath(root, join(directory, name));
      const info = await lstat(path);
      if (info.isDirectory()) { await walk(path, depth + 1); continue; }
      if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error("list_files only accepts bounded regular files");
      bytes += info.size;
      if (files.length >= MAX_FILES || bytes > MAX_TOTAL_BYTES) throw new Error("list_files exceeds its file/byte limit");
      files.push({ path: workspaceRelative(root, path), relativePath: workspaceRelative(requestedRoot, path) });
    }
  };
  await walk(requestedRoot, 0);
  return { data: { files }, artifacts: [] };
}

export async function executeNativeWorkflowTool(options: NativeWorkflowToolOptions): Promise<{ data: unknown; artifacts: WorkflowArtifact[] }> {
  options.signal.throwIfAborted();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(options.runId)) throw new Error("Invalid workflow run directory identity");
  const root = await realpath(options.workspaceDir);
  switch (options.request.name) {
    case "compile_latex": return compileLatex(options, root);
    case "render_pdf": return renderPdf(options, root);
    case "copy_files": return copyFiles(options, root);
    case "list_files": return listFiles(options, root);
    default: throw new Error(`Unknown native workflow tool: ${options.request.name}`);
  }
}
