import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, posix, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import type {
  TraceCausalRollbackConflict,
  TraceCheckpointDetail,
  TraceCheckpointFileChange,
  TraceCheckpointRef,
  TraceCheckpointSkippedFile,
  TraceRestorePreview,
} from "@brainpilot/protocol";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 200 * 1024 * 1024;
const MAX_DIFF_BYTES = 1024 * 1024;
const DEFAULT_GIT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REPOSITORY_BYTES = 2 * 1024 * 1024 * 1024;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const HARD_EXCLUDED_ROOTS = new Set([".attachments", ".truncated"]);

type Skipped = TraceCheckpointSkippedFile;

interface CheckpointRecord {
  ref: TraceCheckpointRef;
  skipped: Skipped[];
  treeId?: string;
  kind: "trace" | "recovery" | "baseline";
}
interface CheckpointIndex {
  version: 2;
  headCheckpointId?: string;
  checkpoints: Record<string, CheckpointRecord>;
}

interface TreeSnapshot {
  treeId: string;
  files: string[];
  skipped: Skipped[];
}

export interface CheckpointFileProvenance extends TraceCheckpointFileChange {
  baseBlobId?: string;
  resultBlobId?: string;
}

export interface CausalWorkspacePreview {
  stateToken: string;
  files: TraceCheckpointFileChange[];
  skipped: Skipped[];
  conflicts: TraceCausalRollbackConflict[];
}

interface CausalTreeResult extends CausalWorkspacePreview {
  current: TreeSnapshot;
  target?: TreeSnapshot;
}

interface RunResult {
  stdout: Buffer;
  stderr: Buffer;
  truncated?: boolean;
}

export interface WorkspaceCheckpointOptions {
  gitTimeoutMs?: number;
  maxRepositoryBytes?: number;
}

function safeRelativePath(value: string): string | null {
  if (value.includes("\0")) return null;
  const normalized = posix.normalize(value.replaceAll("\\", "/"));
  if (!normalized || normalized === "." || normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../")) {
    return null;
  }
  return normalized;
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 500);
}

/**
 * Per-session, Git-backed workspace snapshots. The git dir lives under .bp and
 * is never placed in, nor inferred from, the user's workspace.
 */
export class WorkspaceCheckpointStore {
  private chain: Promise<unknown> = Promise.resolve();
  private loaded?: CheckpointIndex;

  constructor(
    private readonly sessionId: string,
    private readonly workspaceDir: string,
    private readonly stateDir: string,
    options: WorkspaceCheckpointOptions = {},
  ) {
    this.gitTimeoutMs = Math.max(1, Math.trunc(options.gitTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS));
    this.maxRepositoryBytes = Math.max(1, Math.trunc(options.maxRepositoryBytes ?? DEFAULT_MAX_REPOSITORY_BYTES));
  }

  private readonly gitTimeoutMs: number;
  private readonly maxRepositoryBytes: number;

  private get gitDir(): string {
    return join(this.stateDir, "workspace-checkpoints.git");
  }

  private get indexPath(): string {
    return join(this.stateDir, "workspace-checkpoints.json");
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }

  private async runGit(
    args: string[],
    input?: Buffer | string,
    extraEnv?: Record<string, string>,
    maxStdoutBytes?: number,
  ): Promise<RunResult> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn("git", args, {
        cwd: this.workspaceDir,
        env: {
          ...process.env,
          GIT_DIR: this.gitDir,
          GIT_WORK_TREE: this.workspaceDir,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
          GIT_CONFIG_COUNT: "0",
          ...extraEnv,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let truncated = false;
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`git ${args[0] ?? "command"} timed out after ${this.gitTimeoutMs} ms`));
      }, this.gitTimeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        const remaining = maxStdoutBytes === undefined ? chunk.byteLength : Math.max(0, maxStdoutBytes - stdoutBytes);
        if (remaining > 0) {
          const kept = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
          stdout.push(kept);
          stdoutBytes += kept.byteLength;
        }
        if (maxStdoutBytes !== undefined && chunk.byteLength > remaining) truncated = true;
      });
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const result = { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), truncated };
        if (code === 0) resolvePromise(result);
        else reject(new Error(`git ${args[0] ?? "command"} failed (${code}): ${result.stderr.toString("utf8").trim()}`));
      });
      if (input !== undefined) child.stdin.end(input);
      else child.stdin.end();
    });
  }

  private async ensureRepo(): Promise<void> {
    await mkdir(this.workspaceDir, { recursive: true });
    await mkdir(this.stateDir, { recursive: true });
    try {
      await lstat(join(this.gitDir, "HEAD"));
    } catch {
      await new Promise<void>((resolvePromise, reject) => {
        const child = spawn("git", ["init", "--bare", this.gitDir], { stdio: ["ignore", "pipe", "pipe"] });
        const stderr: Buffer[] = [];
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`git init timed out after ${this.gitTimeoutMs} ms`));
        }, this.gitTimeoutMs);
        child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
        child.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) resolvePromise();
          else reject(new Error(`git init failed (${code}): ${Buffer.concat(stderr).toString("utf8")}`));
        });
      });
    }
  }

  private async index(): Promise<CheckpointIndex> {
    if (this.loaded) return this.loaded;
    try {
      const parsed = JSON.parse(await readFile(this.indexPath, "utf8")) as {
        version?: number;
        headCheckpointId?: string;
        checkpoints?: Record<string, CheckpointRecord & { files?: string[] }>;
      };
      if ((parsed.version === 1 || parsed.version === 2) && parsed.checkpoints) {
        // V1 duplicated the complete file list in every record. Tree contents
        // are already authoritative in Git, so migrate that redundant field
        // away in memory and on the next ordinary index write.
        const checkpoints: Record<string, CheckpointRecord> = {};
        for (const [id, record] of Object.entries(parsed.checkpoints)) {
          checkpoints[id] = {
            ref: record.ref,
            skipped: record.skipped ?? [],
            ...(record.treeId ? { treeId: record.treeId } : {}),
            kind: record.kind === "recovery" || record.kind === "baseline" ? record.kind : "trace",
          };
        }
        this.loaded = { version: 2, headCheckpointId: parsed.headCheckpointId, checkpoints };
      }
    } catch {
      // First use or a corrupt optional index. Start clean; trace recording must continue.
    }
    this.loaded ??= { version: 2, checkpoints: {} };
    return this.loaded;
  }

  private async saveIndex(index: CheckpointIndex): Promise<void> {
    await mkdir(dirname(this.indexPath), { recursive: true });
    const temp = `${this.indexPath}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(index, null, 2), "utf8");
    await rename(temp, this.indexPath);
  }

  private async repositoryBytes(): Promise<number> {
    await this.ensureRepo();
    const output = (await this.runGit(["count-objects", "-v"])).stdout.toString("utf8");
    const values = new Map(output.split("\n").flatMap((line) => {
      const separator = line.indexOf(":");
      if (separator < 0) return [];
      const value = Number(line.slice(separator + 1).trim());
      return Number.isFinite(value) ? [[line.slice(0, separator), value] as const] : [];
    }));
    return ((values.get("size") ?? 0) + (values.get("size-pack") ?? 0) + (values.get("size-garbage") ?? 0)) * 1024;
  }

  private hardExcluded(path: string): boolean {
    const parts = path.replace(/\/$/, "").split("/");
    return parts.includes(".git") || HARD_EXCLUDED_ROOTS.has(parts[0] ?? "");
  }

  private workspacePath(rawPath: string): string {
    const path = safeRelativePath(rawPath);
    if (!path) throw new Error("invalid checkpoint path");
    const root = resolve(this.workspaceDir);
    const absolute = resolve(root, path);
    if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) throw new Error("checkpoint path escapes workspace");
    return absolute;
  }

  private gitObject(value: string): string {
    if (!/^[a-f0-9]{40,64}$/i.test(value)) throw new Error("invalid checkpoint Git object id");
    return value;
  }

  private async workspaceFiles(): Promise<{ candidates: Array<{ path: string; size: number }>; skipped: Skipped[] }> {
    // Let Git apply all nested .gitignore rules and collapse fully ignored
    // directories (node_modules, datasets, etc.) to one skipped entry. This
    // avoids walking millions of ignored files merely to discover they are out
    // of scope.
    const eligibleOutput = await this.runGit(["ls-files", "--others", "--exclude-standard", "-z"]);
    const ignoredOutput = await this.runGit([
      "ls-files", "--others", "--ignored", "--exclude-standard",
      "--directory", "--no-empty-directory", "-z",
    ]);
    const eligible = eligibleOutput.stdout.toString("utf8").split("\0").filter(Boolean).sort();
    const ignored = ignoredOutput.stdout.toString("utf8").split("\0").filter(Boolean).sort();
    const skipped: Skipped[] = ignored.map((path) => ({ path, reason: "ignored" }));
    const candidates: Array<{ path: string; size: number }> = [];
    for (const path of eligible) {
      if (this.hardExcluded(path)) {
        skipped.push({ path, reason: "internal" });
        continue;
      }
      try {
        const info = await lstat(this.workspacePath(path));
        if (!info.isFile() && !info.isSymbolicLink()) {
          skipped.push({ path, reason: "unsupported" });
          continue;
        }
        candidates.push({ path, size: info.isSymbolicLink() ? 0 : info.size });
      } catch {
        skipped.push({ path, reason: "unsupported" });
      }
    }
    for (const root of HARD_EXCLUDED_ROOTS) {
      try {
        await lstat(join(this.workspaceDir, root));
        if (!skipped.some((item) => item.path === root || item.path === `${root}/`)) {
          skipped.push({ path: `${root}/`, reason: "internal" });
        }
      } catch {
        // Absent internal directories are not reported.
      }
    }
    return { candidates, skipped };
  }

  private async buildTree(repositoryBudgetBytes?: number): Promise<TreeSnapshot> {
    await this.ensureRepo();
    const { candidates, skipped } = await this.workspaceFiles();
    const selected: string[] = [];
    let total = 0;
    for (const item of candidates) {
      if (item.size > MAX_FILE_BYTES) {
        skipped.push({ path: item.path, reason: "too_large", size: item.size });
      } else if (total + item.size > MAX_SNAPSHOT_BYTES) {
        skipped.push({ path: item.path, reason: "total_limit", size: item.size });
      } else {
        selected.push(item.path);
        total += item.size;
      }
    }
    if (repositoryBudgetBytes !== undefined && total > repositoryBudgetBytes) {
      throw new Error(`checkpoint repository quota exceeded: snapshot needs up to ${total} bytes with ${repositoryBudgetBytes} bytes remaining`);
    }

    const temp = await mkdtemp(join(tmpdir(), `bp-checkpoint-${this.sessionId}-`));
    const indexFile = join(temp, "index");
    const env = { GIT_INDEX_FILE: indexFile };
    try {
      await this.runGit(["read-tree", "--empty"], undefined, env);
      if (selected.length > 0) {
        await this.runGit(
          ["add", "--all", "--pathspec-from-file=-", "--pathspec-file-nul"],
          Buffer.from(`${selected.join("\0")}\0`),
          env,
        );
      }
      const treeId = (await this.runGit(["write-tree"], undefined, env)).stdout.toString("utf8").trim();
      return { treeId, files: selected, skipped: skipped.sort((a, b) => a.path.localeCompare(b.path)) };
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }

  private async changesBetween(from: string, to: string): Promise<TraceCheckpointFileChange[]> {
    from = this.gitObject(from);
    to = this.gitObject(to);
    const output = (await this.runGit(["diff", "--name-status", "-z", "--find-renames", from, to])).stdout;
    const tokens = output.toString("utf8").split("\0").filter(Boolean);
    const changes: TraceCheckpointFileChange[] = [];
    for (let i = 0; i < tokens.length;) {
      const code = tokens[i++]!;
      if (code.startsWith("R")) {
        const previousPath = tokens[i++]!;
        const path = tokens[i++]!;
        changes.push({ path, previousPath, status: "renamed", binary: false });
      } else {
        const path = tokens[i++]!;
        const status = code[0] === "A" ? "added" : code[0] === "D" ? "deleted" : "modified";
        changes.push({ path, status, binary: false });
      }
    }

    const numstat = (await this.runGit(["diff", "--numstat", "-z", from, to])).stdout.toString("utf8");
    for (const row of numstat.split("\0").filter(Boolean)) {
      const [a, d, ...rest] = row.split("\t");
      const path = rest.join("\t");
      const match = changes.find((item) => item.path === path);
      if (!match) continue;
      if (a === "-" || d === "-") match.binary = true;
      else {
        match.additions = Number(a);
        match.deletions = Number(d);
      }
    }
    return changes;
  }

  private async treeFiles(treeId: string): Promise<string[]> {
    const output = await this.runGit(["ls-tree", "-r", "--name-only", "-z", this.gitObject(treeId)]);
    return output.stdout.toString("utf8").split("\0").filter(Boolean).sort();
  }

  private async blobAt(treeish: string, rawPath: string): Promise<string | undefined> {
    const path = safeRelativePath(rawPath);
    if (!path) return undefined;
    const output = await this.runGit(["ls-tree", "-z", this.gitObject(treeish), "--", path]);
    const row = output.stdout.toString("utf8").split("\0").find(Boolean);
    if (!row) return undefined;
    const header = row.slice(0, row.indexOf("\t"));
    const objectId = header.split(" ")[2];
    return objectId && /^[a-f0-9]{40,64}$/i.test(objectId) ? objectId : undefined;
  }

  /** File-level Git evidence for binding one checkpoint to its GoT node. */
  async provenance(id: string): Promise<CheckpointFileProvenance[] | undefined> {
    const index = await this.index();
    const record = index.checkpoints[id];
    if (!record?.ref.commitId) return undefined;
    const base = record.ref.baseCheckpointId
      ? index.checkpoints[record.ref.baseCheckpointId]?.ref.commitId ?? EMPTY_TREE
      : EMPTY_TREE;
    const changes = (await this.changesBetween(base, record.ref.commitId))
      .filter((item) => !this.isSkipped(item.path, record.skipped));
    return Promise.all(changes.map(async (change) => {
      const basePath = change.previousPath ?? change.path;
      const [baseBlobId, resultBlobId] = await Promise.all([
        this.blobAt(base, basePath),
        this.blobAt(record.ref.commitId!, change.path),
      ]);
      return {
        ...change,
        ...(baseBlobId ? { baseBlobId } : {}),
        ...(resultBlobId ? { resultBlobId } : {}),
      };
    }));
  }

  private stats(changes: TraceCheckpointFileChange[]) {
    return {
      files: changes.length,
      added: changes.filter((item) => item.status === "added").length,
      modified: changes.filter((item) => item.status === "modified").length,
      deleted: changes.filter((item) => item.status === "deleted").length,
      renamed: changes.filter((item) => item.status === "renamed").length,
    };
  }

  private isSkipped(path: string, skipped: Skipped[]): boolean {
    return skipped.some((item) => {
      const skippedPath = item.path.replaceAll("\\", "/");
      return path === skippedPath || (skippedPath.endsWith("/") && path.startsWith(skippedPath));
    });
  }

  private async captureUnlocked(sourceAgent: string | undefined, kind: "trace" | "recovery" | "baseline"): Promise<TraceCheckpointRef> {
    const id = `checkpoint_${randomUUID()}`;
    const capturedAt = new Date().toISOString();
    const index = await this.index();
    const base = index.headCheckpointId ? index.checkpoints[index.headCheckpointId] : undefined;
    try {
      const repositoryBytes = await this.repositoryBytes();
      if (repositoryBytes >= this.maxRepositoryBytes) {
        throw new Error(`checkpoint repository quota exceeded: ${repositoryBytes} bytes >= ${this.maxRepositoryBytes} bytes`);
      }
      const tree = await this.buildTree(this.maxRepositoryBytes - repositoryBytes);
      const args = ["commit-tree", tree.treeId];
      if (base?.ref.commitId) args.push("-p", this.gitObject(base.ref.commitId));
      const commitId = (await this.runGit(args, `BrainPilot ${kind} checkpoint ${id}\n`, {
        GIT_AUTHOR_NAME: "BrainPilot",
        GIT_AUTHOR_EMAIL: "checkpoint@brainpilot.local",
        GIT_COMMITTER_NAME: "BrainPilot",
        GIT_COMMITTER_EMAIL: "checkpoint@brainpilot.local",
      })).stdout.toString("utf8").trim();
      await this.runGit(["update-ref", `refs/brainpilot/checkpoints/${id}`, commitId]);
      const changes = (await this.changesBetween(base?.ref.commitId ?? EMPTY_TREE, commitId))
        .filter((item) => !this.isSkipped(item.path, tree.skipped));
      const ref: TraceCheckpointRef = {
        id,
        commitId,
        status: tree.skipped.length > 0 ? "partial" : "ready",
        capturedAt,
        sourceAgent,
        baseCheckpointId: base?.ref.id,
        stats: this.stats(changes),
        skippedCount: tree.skipped.length,
      };
      index.checkpoints[id] = { ref, skipped: tree.skipped, treeId: tree.treeId, kind };
      index.headCheckpointId = id;
      await this.saveIndex(index);
      return ref;
    } catch (error) {
      const unavailable = error instanceof Error && /ENOENT|spawn git/.test(error.message);
      const ref: TraceCheckpointRef = {
        id,
        status: unavailable ? "unavailable" : "failed",
        capturedAt,
        sourceAgent,
        skippedCount: 0,
        error: errorText(error),
      };
      index.checkpoints[id] = { ref, skipped: [], kind };
      await this.saveIndex(index).catch(() => undefined);
      return ref;
    }
  }

  capture(sourceAgent?: string, kind: "trace" | "recovery" = "trace"): Promise<TraceCheckpointRef> {
    return this.exclusive(() => this.captureUnlocked(sourceAgent, kind));
  }

  async refs(ids: string[]): Promise<TraceCheckpointRef[]> {
    const index = await this.index();
    return ids.map((id) => index.checkpoints[id]?.ref).filter((item): item is TraceCheckpointRef => Boolean(item));
  }

  async detail(id: string): Promise<TraceCheckpointDetail | undefined> {
    const index = await this.index();
    const record = index.checkpoints[id];
    if (!record) return undefined;
    const files = record.ref.commitId
      ? await this.changesBetween(
          record.ref.baseCheckpointId ? index.checkpoints[record.ref.baseCheckpointId]?.ref.commitId ?? EMPTY_TREE : EMPTY_TREE,
          record.ref.commitId,
        )
      : [];
    return { checkpoint: record.ref, files: files.filter((item) => !this.isSkipped(item.path, record.skipped)), skipped: record.skipped };
  }

  async diff(id: string, rawPath: string): Promise<string | undefined> {
    const path = safeRelativePath(rawPath);
    if (!path) throw new Error("invalid checkpoint diff path");
    const index = await this.index();
    const record = index.checkpoints[id];
    if (!record?.ref.commitId) return undefined;
    const base = record.ref.baseCheckpointId ? index.checkpoints[record.ref.baseCheckpointId]?.ref.commitId ?? EMPTY_TREE : EMPTY_TREE;
    const result = await this.runGit(
      ["diff", "--no-color", "--no-ext-diff", "--unified=3", this.gitObject(base), this.gitObject(record.ref.commitId), "--", path],
      undefined,
      undefined,
      MAX_DIFF_BYTES,
    );
    return `${result.stdout.toString("utf8")}${result.truncated ? `\n\n[diff truncated at ${MAX_DIFF_BYTES} bytes]\n` : ""}`;
  }

  private stateToken(tree: TreeSnapshot): string {
    return createHash("sha256")
      .update(tree.treeId)
      .update("\0")
      .update(tree.files.join("\0"))
      .update("\0")
      .update(tree.skipped.map((item) => `${item.path}:${item.reason}:${item.size ?? ""}`).join("\0"))
      .digest("hex");
  }

  private causalStateToken(tree: TreeSnapshot, checkpointIds: string[]): string {
    return createHash("sha256")
      .update(this.stateToken(tree))
      .update("\0causal\0")
      .update([...checkpointIds].sort().join("\0"))
      .digest("hex");
  }

  private async synthesizeCausalTree(checkpointIds: string[]): Promise<CausalTreeResult> {
    const index = await this.index();
    const records = checkpointIds
      .map((id) => index.checkpoints[id])
      .filter((record): record is CheckpointRecord => Boolean(record?.ref.commitId && record.treeId))
      .sort((a, b) => {
        const byTime = b.ref.capturedAt.localeCompare(a.ref.capturedAt);
        return byTime || b.ref.id.localeCompare(a.ref.id);
      });
    const orderedIds = records.map((record) => record.ref.id);
    const current = await this.buildTree();
    const stateToken = this.causalStateToken(current, orderedIds);
    const skippedByKey = new Map<string, Skipped>();
    for (const item of [...current.skipped, ...records.flatMap((record) => record.skipped)]) {
      skippedByKey.set(`${item.reason}:${item.path}`, item);
    }
    const skipped = [...skippedByKey.values()].sort((a, b) => a.path.localeCompare(b.path));
    if (records.length === 0) {
      return { current, target: current, stateToken, files: [], skipped, conflicts: [] };
    }

    const temp = await mkdtemp(join(tmpdir(), `bp-causal-${this.sessionId}-`));
    const indexFile = join(temp, "index");
    const env = { GIT_INDEX_FILE: indexFile };
    const conflicts: TraceCausalRollbackConflict[] = [];
    try {
      await this.runGit(["read-tree", this.gitObject(current.treeId)], undefined, env);
      for (const record of records) {
        const commitId = this.gitObject(record.ref.commitId!);
        const baseCommit = record.ref.baseCheckpointId
          ? index.checkpoints[record.ref.baseCheckpointId]?.ref.commitId ?? EMPTY_TREE
          : EMPTY_TREE;
        const patch = (await this.runGit([
          "diff", "--binary", "--full-index", this.gitObject(baseCommit), commitId,
        ])).stdout;
        if (patch.length === 0) continue;
        try {
          await this.runGit(
            ["apply", "--reverse", "--3way", "--cached", "--whitespace=nowarn"],
            patch,
            env,
          );
        } catch (error) {
          const unmerged = await this.runGit(["ls-files", "-u", "-z"], undefined, env).catch(() => undefined);
          const unmergedPaths = unmerged?.stdout.toString("utf8").split("\0").filter(Boolean).map((row) => row.slice(row.indexOf("\t") + 1)) ?? [];
          const fallback = (await this.changesBetween(baseCommit, commitId)).flatMap((change) => [change.previousPath, change.path].filter((path): path is string => Boolean(path)));
          for (const path of [...new Set(unmergedPaths.length ? unmergedPaths : fallback)]) {
            conflicts.push({ path, checkpointIds: [record.ref.id], reason: errorText(error) });
          }
          break;
        }
      }
      if (conflicts.length > 0) {
        return { current, stateToken, files: [], skipped, conflicts };
      }
      const treeId = (await this.runGit(["write-tree"], undefined, env)).stdout.toString("utf8").trim();
      const target: TreeSnapshot = { treeId, files: await this.treeFiles(treeId), skipped };
      const files = (await this.changesBetween(current.treeId, treeId))
        .filter((item) => !this.isSkipped(item.path, skipped));
      return { current, target, stateToken, files, skipped, conflicts: [] };
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }

  previewCausal(checkpointIds: string[]): Promise<CausalWorkspacePreview> {
    return this.exclusive(async () => {
      const result = await this.synthesizeCausalTree(checkpointIds);
      return {
        stateToken: result.stateToken,
        files: result.files,
        skipped: result.skipped,
        conflicts: result.conflicts,
      };
    });
  }

  restoreCausal(
    checkpointIds: string[],
    expectedStateToken: string,
  ): Promise<void> {
    return this.exclusive(async () => {
      const plan = await this.synthesizeCausalTree(checkpointIds);
      if (plan.stateToken !== expectedStateToken) {
        const error = new Error("workspace or causal rollback scope changed after preview");
        (error as Error & { code?: string }).code = "STALE_WORKSPACE";
        throw error;
      }
      if (plan.conflicts.length > 0 || !plan.target) {
        const error = new Error("causal rollback has file conflicts; resolve or change the rollback scope");
        (error as Error & { code?: string; conflicts?: TraceCausalRollbackConflict[] }).code = "CAUSAL_CONFLICT";
        (error as Error & { conflicts?: TraceCausalRollbackConflict[] }).conflicts = plan.conflicts;
        throw error;
      }
      const recoveryRef = await this.captureUnlocked("system", "recovery");
      const index = await this.index();
      const recovery = index.checkpoints[recoveryRef.id];
      if (!recovery?.ref.commitId) throw new Error("failed to create recovery checkpoint");
      try {
        await this.applyTree(plan.target, plan.current);
        const baseline = await this.captureUnlocked("system", "baseline");
        if (!baseline.commitId) throw new Error(baseline.error ?? "failed to create post-restore baseline");
      } catch (error) {
        const failedState = await this.buildTree().catch(() => plan.current);
        await this.applyRecord(recovery, failedState).catch(() => undefined);
        throw error;
      }
    });
  }

  preview(id: string): Promise<TraceRestorePreview | undefined> {
    return this.exclusive(async () => {
      const index = await this.index();
      const target = index.checkpoints[id];
      if (!target?.ref.commitId || !target.treeId) return undefined;
      const current = await this.buildTree();
      const files = await this.changesBetween(current.treeId, target.treeId);
      return {
        checkpointId: id,
        stateToken: this.stateToken(current),
        files: files.filter((item) => !this.isSkipped(item.path, [...target.skipped, ...current.skipped])),
        skipped: target.skipped,
      };
    });
  }

  private async materializeTree(treeish: string): Promise<string> {
    const temp = await mkdtemp(join(tmpdir(), `bp-restore-${this.sessionId}-`));
    const indexFile = join(temp, "index");
    const outputDir = join(temp, "tree");
    await mkdir(outputDir);
    await this.runGit(["read-tree", this.gitObject(treeish)], undefined, { GIT_INDEX_FILE: indexFile });
    await this.runGit(["checkout-index", "-a", `--prefix=${outputDir}/`], undefined, { GIT_INDEX_FILE: indexFile });
    return temp;
  }

  private async applyTree(target: TreeSnapshot, current: TreeSnapshot): Promise<void> {
    const temp = await this.materializeTree(target.treeId);
    const sourceRoot = join(temp, "tree");
    const targetFiles = new Set(target.files);
    const protectedEntries = [...target.skipped, ...current.skipped];
    try {
      for (const path of current.files) {
        if (!targetFiles.has(path) && !this.isSkipped(path, protectedEntries)) {
          await rm(this.workspacePath(path), { force: true, recursive: true });
        }
      }
      for (const path of target.files) {
        if (this.isSkipped(path, protectedEntries)) continue;
        const source = join(sourceRoot, path);
        const destination = this.workspacePath(path);
        const info = await lstat(source);
        await mkdir(dirname(destination), { recursive: true });
        await rm(destination, { force: true, recursive: true });
        if (info.isSymbolicLink()) await symlink(await readlink(source), destination);
        else {
          await copyFile(source, destination);
          await chmod(destination, info.mode & 0o777);
        }
      }
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }

  private async applyRecord(record: CheckpointRecord, current: TreeSnapshot): Promise<void> {
    if (!record.treeId) throw new Error("checkpoint has no Git tree");
    await this.applyTree({ treeId: record.treeId, files: await this.treeFiles(record.treeId), skipped: record.skipped }, current);
  }

  restore(id: string, expectedStateToken: string): Promise<{ restoredCheckpointId: string }> {
    return this.exclusive(async () => {
      const index = await this.index();
      const target = index.checkpoints[id];
      if (!target?.ref.commitId || !target.treeId) throw new Error("checkpoint is not restorable");
      const current = await this.buildTree();
      if (this.stateToken(current) !== expectedStateToken) {
        const error = new Error("workspace changed after restore preview");
        (error as Error & { code?: string }).code = "STALE_WORKSPACE";
        throw error;
      }
      const recoveryRef = await this.captureUnlocked("system", "recovery");
      const recovery = index.checkpoints[recoveryRef.id];
      if (!recovery?.ref.commitId) throw new Error("failed to create recovery checkpoint");
      try {
        await this.applyRecord(target, current);
        const baseline = await this.captureUnlocked("system", "baseline");
        if (!baseline.commitId) throw new Error(baseline.error ?? "failed to create post-restore baseline");
      } catch (error) {
        const failedState = await this.buildTree().catch(() => current);
        await this.applyRecord(recovery, failedState).catch(() => undefined);
        throw error;
      }
      return { restoredCheckpointId: id };
    });
  }
}
