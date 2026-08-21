import { cp, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { SubagentStatus, ThinkingLevel, TokenUsage } from "@brainpilot/protocol";
import { CUSTOM_EVENT } from "@brainpilot/protocol";
import type { EventBus } from "./event-bus.js";
import type { IAgentSession, PiAgentEvent, SystemTool } from "./types.js";
import { ev } from "./events.js";
import { addUsage, emptyTokenUsage } from "./mas-agent.js";
import { loadSubagentProfile, type SubagentProfile } from "./subagent-profiles.js";

export interface SubagentInput {
  scope: "workspace" | "attachments" | "data" | "shared";
  path: string;
  alias?: string;
  mode?: "copy" | "reference";
}

export interface SubagentTask {
  name?: string;
  profile: string;
  task: string;
  inputs?: SubagentInput[];
  workspaceMode?: "isolated" | "shared";
}

export interface SubmittedSubagentResult {
  outcome: "completed" | "blocked";
  summary: string;
  findings: string[];
  artifacts: Array<{ path: string; description?: string }>;
  caveats: string[];
  inspectedPaths: string[];
  commandsRun: string[];
}

export interface SubagentResult extends SubmittedSubagentResult {
  childId: string;
  profile: string;
  status: SubagentStatus["status"];
  error?: string;
  durationMs: number;
  usage: TokenUsage;
}

interface PreparedSubagentRun {
  childId: string;
  status: SubagentStatus;
  parentAgent: string;
  rootRunId: string | null;
  context?: string;
  task: SubagentTask;
  profile: SubagentProfile;
  borrowParent: boolean;
  allowNestedBorrow: boolean;
  parentPromotion?: Promise<object>;
}

interface ProviderCapacityOptions {
  borrowParent: boolean;
  allowNestedBorrow: boolean;
  parentPromotion?: Promise<object>;
}

interface PersistedState { version: 1; runs: SubagentStatus[] }

interface SubagentManagerOptions {
  sessionId: string;
  dataRoot: string;
  stateDir: string;
  workspaceDir: string;
  persistentDir: string;
  sharedDir?: string;
  bus: EventBus;
  createChildSession: (args: {
    childId: string;
    parentAgent: string;
    profile: SubagentProfile;
    cwd: string;
    historyPath: string;
    submitTool: SystemTool;
  }) => Promise<IAgentSession>;
  runWithProviderCapacity: <T>(fn: () => Promise<T>, options: ProviderCapacityOptions) => Promise<T>;
  onUsage: (childId: string, usage: TokenUsage) => void;
  onRunFinished: (info: { childId: string; status: "ok" | "error" | "aborted"; usage: TokenUsage; startedAt: number; finishedAt: number }) => void;
  onChanged: () => void;
  maxConcurrency?: number;
  timeoutMs?: number;
  maxCopyBytes?: number;
  persist?: boolean;
}

class Semaphore {
  private available: number;
  private waiters: Array<() => void> = [];
  constructor(limit: number) { this.available = Math.max(1, limit); }
  acquire(): Promise<() => void> {
    return new Promise((resolveAcquire) => {
      const grant = () => {
        let done = false;
        resolveAcquire(() => {
          if (done) return;
          done = true;
          const next = this.waiters.shift();
          if (next) next(); else this.available++;
        });
      };
      if (this.available > 0) { this.available--; grant(); } else this.waiters.push(grant);
    });
  }
}

function positiveEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function safeSegment(raw: string, fallback: string): string {
  const value = raw.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return value.slice(0, 80) || fallback;
}

function isWithin(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export class SubagentManager {
  private readonly statuses = new Map<string, SubagentStatus>();
  private readonly active = new Map<string, { parentAgent: string; session: IAgentSession }>();
  private readonly executions = new Map<string, Promise<SubagentResult>>();
  private readonly results = new Map<string, SubagentResult>();
  private readonly parentPromotions = new Map<string, (parentLease: object) => void>();
  private readonly semaphore: Semaphore;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly timeoutMs: number;
  private readonly maxCopyBytes: number;

  constructor(private readonly opts: SubagentManagerOptions) {
    this.semaphore = new Semaphore(opts.maxConcurrency ?? positiveEnv("BP_SUBAGENT_MAX_CONCURRENCY", 4));
    this.timeoutMs = opts.timeoutMs ?? positiveEnv("BP_SUBAGENT_TIMEOUT_MS", 1_200_000);
    this.maxCopyBytes = opts.maxCopyBytes ?? positiveEnv("BP_SUBAGENT_COPY_MAX_BYTES", 256 * 1024 * 1024);
  }

  async restore(): Promise<void> {
    if (this.opts.persist === false) return;
    try {
      const parsed = JSON.parse(await readFile(this.statePath(), "utf8")) as PersistedState;
      for (const status of parsed.runs ?? []) {
        if (status.status === "queued" || status.status === "waiting_for_capacity" || status.status === "running") {
          status.status = "interrupted";
          status.finishedAt = new Date().toISOString();
          status.error = "Runtime stopped before the subagent completed.";
        }
        this.statuses.set(status.id, status);
      }
      await this.persist();
    } catch { /* first run or corrupt optional state */ }
  }

  list(): SubagentStatus[] { return [...this.statuses.values()]; }

  hasActiveExecutions(): boolean {
    return [...this.executions.keys()].some((id) => {
      const status = this.statuses.get(id)?.status;
      return this.active.has(id) || (status !== undefined && this.isActive(status));
    });
  }

  listForParent(parentAgent: string, childIds?: string[]): SubagentStatus[] {
    const runs = childIds
      ? this.validateOwnedIds(parentAgent, childIds).map((id) => this.statuses.get(id)!)
      : this.list().filter((run) => run.parentAgent === parentAgent);
    return runs.map((run) => ({ ...run, artifacts: run.artifacts ? [...run.artifacts] : undefined }));
  }

  async runBatch(args: {
    parentAgent: string;
    rootRunId: string | null;
    context?: string;
    tasks: SubagentTask[];
  }): Promise<SubagentResult[]> {
    const prepared = await this.prepareBatch(args, true);
    const results = await Promise.all(prepared.map((run) => this.launch(run)));
    // A completed batch is a natural durability boundary. Waiting here avoids
    // a late status write racing session teardown/restore and makes callers
    // observe terminal child state atomically with their returned results.
    await this.flush();
    return results;
  }

  /** Launch a batch without waiting. The returned ids can be queried, awaited, or cancelled later. */
  async startBatch(args: {
    parentAgent: string;
    rootRunId: string | null;
    context?: string;
    tasks: SubagentTask[];
  }): Promise<SubagentStatus[]> {
    const prepared = await this.prepareBatch(args, false, true);
    for (const run of prepared) void this.launch(run);
    return prepared.map((run) => ({ ...run.status }));
  }

  async waitFor(parentAgent: string, childIds: string[], parentLease?: object): Promise<SubagentResult[]> {
    const ids = this.validateOwnedIds(parentAgent, childIds);
    if (parentLease !== undefined) {
      for (const id of ids) this.parentPromotions.get(id)?.(parentLease);
    }
    const results = await Promise.all(ids.map(async (id) => {
      const execution = this.executions.get(id);
      if (execution) return execution;
      const result = this.results.get(id);
      if (result) return result;
      return this.resultFromStatus(this.statuses.get(id)!);
    }));
    // Waiting for a child is a durability boundary just like runBatch(): once
    // the result is observable, its terminal status must also be on disk.
    await this.flush();
    return results;
  }

  async cancelForParent(parentAgent: string, childIds: string[], reason = "Subagent cancelled by parent agent."): Promise<SubagentStatus[]> {
    const ids = this.validateOwnedIds(parentAgent, childIds);
    await Promise.all(ids.map((id) => this.cancel(id, reason)));
    return ids.map((id) => ({ ...this.statuses.get(id)! }));
  }

  async cancelParent(parentAgent: string): Promise<number> {
    const ids = this.list()
      .filter((run) => run.parentAgent === parentAgent && this.isActive(run.status))
      .map((run) => run.id);
    await Promise.all(ids.map((id) => this.cancel(id, "Cancelled with parent agent.")));
    await this.flush();
    return ids.length;
  }

  async cancel(childId: string, reason = "Subagent cancelled."): Promise<boolean> {
    const status = this.statuses.get(childId);
    if (!status || !this.isActive(status.status)) return false;
    this.update(childId, { status: "cancelled", error: reason });
    await this.active.get(childId)?.session.abort().catch(() => {});
    await this.flush();
    return true;
  }

  async cancelAll(): Promise<number> {
    const ids = this.list().filter((run) => this.isActive(run.status)).map((run) => run.id);
    await Promise.all(ids.map((id) => this.cancel(id, "Session interrupted.")));
    return ids.length;
  }

  async dispose(): Promise<void> {
    await this.cancelAll();
    for (const { session } of this.active.values()) session.dispose();
    this.active.clear();
    await this.flush();
  }

  async flush(): Promise<void> { await this.writeChain; }

  /** Apply a session-level thinking change to every currently active child. */
  setThinkingLevel(level: ThinkingLevel): void {
    for (const { session } of this.active.values()) session.setThinkingLevel(level);
  }

  private validateBatch(tasks: SubagentTask[]): void {
    if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 4) throw new Error("tasks must contain 1 to 4 items");
    const names = new Set<string>();
    for (const task of tasks) {
      if (!task.task?.trim()) throw new Error("each subagent task must be non-empty");
      if (task.task.length > 16_000) throw new Error("subagent task exceeds 16000 characters");
      if (!task.profile?.trim()) throw new Error("each subagent task requires a profile");
      if ((task.inputs?.length ?? 0) > 32) throw new Error("a subagent task may have at most 32 inputs");
      if (task.workspaceMode && task.workspaceMode !== "isolated" && task.workspaceMode !== "shared") {
        throw new Error(`invalid subagent workspace mode: ${task.workspaceMode}`);
      }
      if (task.name?.trim()) {
        const key = task.name.trim().toLowerCase();
        if (names.has(key)) throw new Error(`duplicate subagent task name: ${task.name}`);
        names.add(key);
      }
    }
  }

  private validateOwnedIds(parentAgent: string, childIds: string[]): string[] {
    if (!Array.isArray(childIds) || childIds.length < 1 || childIds.length > 32) {
      throw new Error("child_ids must contain 1 to 32 items");
    }
    const ids = [...new Set(childIds.map((id) => String(id).trim()).filter(Boolean))];
    if (ids.length !== childIds.length) throw new Error("child_ids must be non-empty and unique");
    for (const id of ids) {
      const status = this.statuses.get(id);
      if (!status) throw new Error(`unknown subagent: ${id}`);
      if (status.parentAgent !== parentAgent) throw new Error(`subagent ${id} is not owned by ${parentAgent}`);
    }
    return ids;
  }

  private async prepareBatch(args: {
    parentAgent: string; rootRunId: string | null; context?: string; tasks: SubagentTask[];
  }, allowParentBorrow: boolean, allowParentPromotion = false): Promise<PreparedSubagentRun[]> {
    if ((args.context?.length ?? 0) > 32_000) throw new Error("subagent context exceeds 32000 characters");
    this.validateBatch(args.tasks);
    const profiles = await Promise.all(args.tasks.map(async (task) => {
      const profile = await loadSubagentProfile(this.opts.dataRoot, task.profile);
      if (!profile) throw new Error(`unknown subagent profile: ${task.profile}`);
      if (!profile.allowedParents.includes(args.parentAgent)) {
        throw new Error(`agent ${args.parentAgent} is not allowed to spawn profile ${task.profile}`);
      }
      return profile;
    }));
    return args.tasks.map((task, index) => {
      const profile = profiles[index]!;
      const childId = `${safeSegment(task.name ?? profile.name, profile.name)}-${randomUUID().slice(0, 8)}`;
      const status: SubagentStatus = {
        id: childId, parentAgent: args.parentAgent, rootRunId: args.rootRunId,
        profile: profile.name, label: task.name?.trim() || profile.description,
        task: task.task, status: "queued",
      };
      this.statuses.set(childId, status);
      this.emit(status);
      let parentPromotion: Promise<object> | undefined;
      if (allowParentPromotion) {
        parentPromotion = new Promise<object>((resolvePromotion) => {
          this.parentPromotions.set(childId, resolvePromotion);
        });
      }
      return {
        childId, status, parentAgent: args.parentAgent,
        rootRunId: args.rootRunId, context: args.context, task, profile,
        borrowParent: allowParentBorrow && index === 0,
        allowNestedBorrow: allowParentBorrow,
        parentPromotion,
      };
    });
  }

  private launch(run: PreparedSubagentRun): Promise<SubagentResult> {
    const existing = this.executions.get(run.childId);
    if (existing) return existing;
    const execution = this.runOne(run).then((result) => {
      this.results.set(run.childId, result);
      return result;
    }).finally(() => {
      this.parentPromotions.delete(run.childId);
      if (this.executions.get(run.childId) === execution) {
        this.executions.delete(run.childId);
        this.opts.onChanged();
      }
    });
    this.executions.set(run.childId, execution);
    return execution;
  }

  private async runOne(args: PreparedSubagentRun): Promise<SubagentResult> {
    const childId = args.childId;
    const base = join(this.opts.stateDir, "subagents", childId);
    const workspaceMode = args.task.workspaceMode ?? "shared";
    const sharedWorkspace = workspaceMode === "shared";
    const scratchDir = sharedWorkspace
      ? join(this.opts.workspaceDir, ".subagent-scratch", childId)
      : join(base, "workspace");
    const cwd = sharedWorkspace ? this.opts.workspaceDir : scratchDir;
    const historyPath = join(base, "history.jsonl");
    const started = Date.now();
    let session: IAgentSession | undefined;
    let release: (() => void) | undefined;
    let unsubscribe: (() => void) | undefined;
    let submitted: SubmittedSubagentResult | undefined;
    let usage = emptyTokenUsage();
    let timedOut = false;
    try {
      release = await this.semaphore.acquire();
      if (this.statuses.get(childId)?.status === "cancelled") throw new Error("subagent was cancelled before start");
      await Promise.all([mkdir(cwd, { recursive: true }), mkdir(scratchDir, { recursive: true })]);
      const inputs = await this.materializeInputs(
        sharedWorkspace ? scratchDir : cwd,
        args.task.inputs ?? [],
        cwd,
      );
      if (this.statuses.get(childId)?.status === "cancelled") throw new Error("subagent was cancelled before session creation");
      const submitTool = this.submitTool(cwd, (value) => { submitted = value; });
      session = await this.opts.createChildSession({ childId, parentAgent: args.parentAgent, profile: args.profile, cwd, historyPath, submitTool });
      this.active.set(childId, { parentAgent: args.parentAgent, session });
      if (this.statuses.get(childId)?.status === "cancelled") throw new Error("subagent was cancelled before prompt");
      unsubscribe = session.subscribe((event) => {
        const u = this.usageFromEvent(event);
        if (u) addUsage(usage, u);
      });
      const prompt = this.renderPrompt(
        args.task.task,
        args.context,
        inputs,
        workspaceMode,
        relative(cwd, scratchDir).split(sep).join("/") || ".",
      );
      const timeout = args.profile.timeoutMs ?? this.timeoutMs;
      const run = async () => {
        await session!.prompt(prompt);
        for (let reminder = 0; !submitted && reminder < 2; reminder++) {
          await session!.prompt("You have not submitted a result. Call submit_result now with the best complete result available.");
        }
      };
      this.update(childId, { status: "waiting_for_capacity" });
      await this.opts.runWithProviderCapacity(async () => {
        if (this.statuses.get(childId)?.status === "cancelled") throw new Error("subagent was cancelled before execution");
        this.update(childId, { status: "running", startedAt: new Date().toISOString() });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            run(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => { timedOut = true; reject(new Error(`subagent timed out after ${timeout}ms`)); }, timeout);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      }, {
        borrowParent: args.borrowParent,
        allowNestedBorrow: args.allowNestedBorrow,
        parentPromotion: args.parentPromotion,
      });
      if (!submitted) throw new Error("subagent exited without calling submit_result");
      if (this.statuses.get(childId)?.status === "cancelled") throw new Error("subagent was cancelled");
      const published = await this.publishArtifacts(childId, cwd, submitted.artifacts, sharedWorkspace);
      const finished = Date.now();
      const finalStatus = submitted.outcome === "blocked" ? "blocked" : "succeeded";
      const result: SubagentResult = { ...submitted, artifacts: published, childId, profile: args.profile.name, status: finalStatus, durationMs: finished - started, usage };
      this.update(childId, { status: finalStatus, finishedAt: new Date(finished).toISOString(), durationMs: result.durationMs, resultSummary: submitted.summary, artifacts: published.map((item) => item.path) });
      this.opts.onUsage(childId, usage);
      this.opts.onRunFinished({ childId, status: finalStatus === "succeeded" ? "ok" : "error", usage, startedAt: started, finishedAt: finished });
      return result;
    } catch (error) {
      const finished = Date.now();
      const current = this.statuses.get(childId)?.status;
      const finalStatus = current === "cancelled" ? "cancelled" : timedOut ? "timed_out" : "failed";
      const message = (error as Error).message;
      this.update(childId, { status: finalStatus, finishedAt: new Date(finished).toISOString(), durationMs: finished - started, error: message });
      if (timedOut && session) await session.abort().catch(() => {});
      this.opts.onUsage(childId, usage);
      this.opts.onRunFinished({
        childId,
        status: finalStatus === "cancelled" || finalStatus === "timed_out" ? "aborted" : "error",
        usage,
        startedAt: started,
        finishedAt: finished,
      });
      return { childId, profile: args.profile.name, status: finalStatus, outcome: "blocked", summary: "", findings: [], artifacts: [], caveats: [], inspectedPaths: [], commandsRun: [], error: message, durationMs: finished - started, usage };
    } finally {
      unsubscribe?.();
      if (session) session.dispose();
      this.active.delete(childId);
      release?.();
    }
  }

  private resultFromStatus(status: SubagentStatus): SubagentResult {
    return {
      childId: status.id,
      profile: status.profile,
      status: status.status,
      outcome: status.status === "succeeded" ? "completed" : "blocked",
      summary: status.resultSummary ?? "",
      findings: [],
      artifacts: (status.artifacts ?? []).map((path) => ({ path })),
      caveats: status.status === "interrupted" ? ["The runtime restarted before this subagent completed."] : [],
      inspectedPaths: [],
      commandsRun: [],
      ...(status.error ? { error: status.error } : {}),
      durationMs: status.durationMs ?? 0,
      usage: emptyTokenUsage(),
    };
  }

  private submitTool(cwd: string, accept: (value: SubmittedSubagentResult) => void): SystemTool {
    let called = false;
    return {
      name: "submit_result",
      description: "Submit the final structured result to your parent agent. Call exactly once.",
      parameters: {
        type: "object",
        properties: {
          outcome: { type: "string", enum: ["completed", "blocked"], description: "Use blocked when required inputs or checks were unavailable." },
          summary: { type: "string" },
          findings: { type: "array", items: { type: "string" } },
          artifacts: { type: "array", items: { type: "object", properties: { path: { type: "string" }, description: { type: "string" } }, required: ["path"] } },
          caveats: { type: "array", items: { type: "string" } },
          inspected_paths: { type: "array", items: { type: "string" }, description: "Workspace or input paths actually inspected." },
          commands_run: { type: "array", items: { type: "string" }, description: "Exact validation commands actually run." },
        },
        required: ["outcome", "summary"],
      },
      execute: async (params) => {
        if (called) return { content: [{ type: "text", text: "submit_result was already called" }], isError: true };
        const summary = String(params.summary ?? "").trim();
        if (!summary) return { content: [{ type: "text", text: "summary is required" }], isError: true };
        const outcome = params.outcome === "completed" || params.outcome === "blocked" ? params.outcome : undefined;
        if (!outcome) return { content: [{ type: "text", text: "outcome must be completed or blocked" }], isError: true };
        const artifactPaths = new Set<string>();
        const artifacts = Array.isArray(params.artifacts) ? params.artifacts.slice(0, 50).map((item) => {
          const record = item as Record<string, unknown>;
          const path = String(record.path ?? "");
          const abs = resolve(cwd, path);
          if (!path || path === "." || isAbsolute(path) || !isWithin(abs, cwd)) throw new Error(`artifact escapes child workspace: ${path}`);
          if (artifactPaths.has(path)) throw new Error(`duplicate artifact path: ${path}`);
          artifactPaths.add(path);
          return { path, ...(record.description ? { description: String(record.description) } : {}) };
        }) : [];
        called = true;
        accept({
          outcome,
          summary: summary.slice(0, 16_000),
          findings: Array.isArray(params.findings) ? params.findings.slice(0, 50).map((value) => String(value).slice(0, 4_000)) : [],
          artifacts,
          caveats: Array.isArray(params.caveats) ? params.caveats.slice(0, 20).map((value) => String(value).slice(0, 4_000)) : [],
          inspectedPaths: Array.isArray(params.inspected_paths) ? params.inspected_paths.slice(0, 100).map((value) => String(value).slice(0, 2_000)) : [],
          commandsRun: Array.isArray(params.commands_run) ? params.commands_run.slice(0, 100).map((value) => String(value).slice(0, 4_000)) : [],
        });
        return { content: [{ type: "text", text: "result submitted" }] };
      },
    };
  }

  private async materializeInputs(
    materializeDir: string,
    inputs: SubagentInput[],
    childCwd = materializeDir,
  ): Promise<Array<{ alias: string; path: string; mode: string; source: string }>> {
    const out: Array<{ alias: string; path: string; mode: string; source: string }> = [];
    const aliases = new Set<string>();
    for (const [index, input] of inputs.entries()) {
      const inputParts = input.path.replaceAll("\\", "/").split("/");
      if (!input.path || isAbsolute(input.path) || inputParts.includes("..")) throw new Error(`invalid subagent input path: ${input.path}`);
      const root = input.scope === "workspace" ? this.opts.workspaceDir
        : input.scope === "attachments" ? join(this.opts.workspaceDir, ".attachments")
        : input.scope === "data" ? this.opts.persistentDir : this.opts.sharedDir;
      if (!root) throw new Error(`input scope is unavailable: ${input.scope}`);
      const source = resolve(root, input.path);
      if (!isWithin(source, root)) throw new Error(`input escapes ${input.scope}: ${input.path}`);
      await lstat(source);
      const [actualRoot, actualSource] = await Promise.all([realpath(root), realpath(source)]);
      if (!isWithin(actualSource, actualRoot)) throw new Error(`input symlink escapes ${input.scope}: ${input.path}`);
      const alias = safeSegment(input.alias ?? basename(input.path), `input-${index + 1}`);
      if (aliases.has(alias)) throw new Error(`duplicate input alias: ${alias}`);
      aliases.add(alias);
      const mode = input.mode ?? (input.scope === "workspace" || input.scope === "attachments" ? "copy" : "reference");
      if (mode === "copy") {
        const size = await this.treeSize(source, this.maxCopyBytes, actualRoot);
        if (size > this.maxCopyBytes) throw new Error(`input exceeds copy limit (${this.maxCopyBytes} bytes): ${input.path}`);
        const dest = join(materializeDir, "inputs", alias);
        await mkdir(join(materializeDir, "inputs"), { recursive: true });
        await cp(source, dest, { recursive: true, dereference: false, errorOnExist: true });
        const path = isWithin(dest, childCwd)
          ? relative(childCwd, dest).split(sep).join("/")
          : await realpath(dest);
        out.push({ alias, path, mode, source: `${input.scope}:${input.path}` });
      } else {
        out.push({ alias, path: await realpath(source), mode, source: `${input.scope}:${input.path}` });
      }
    }
    return out;
  }

  private async treeSize(path: string, stopAfter: number, allowedRoot: string): Promise<number> {
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      const target = await realpath(path);
      if (!isWithin(target, allowedRoot)) throw new Error(`input symlink escapes allowed root: ${path}`);
      throw new Error(`copy input contains a symbolic link: ${path}`);
    }
    if (!info.isDirectory()) return info.size;
    let total = 0;
    for (const entry of await readdir(path)) {
      total += await this.treeSize(join(path, entry), stopAfter - total, allowedRoot);
      if (total > stopAfter) return total;
    }
    return total;
  }

  private async publishArtifacts(
    childId: string,
    cwd: string,
    artifacts: Array<{ path: string; description?: string }>,
    sharedWorkspace: boolean,
  ): Promise<Array<{ path: string; description?: string }>> {
    const published: Array<{ path: string; description?: string }> = [];
    for (const artifact of artifacts) {
      const source = resolve(cwd, artifact.path);
      if (!isWithin(source, cwd)) throw new Error(`artifact escapes child workspace: ${artifact.path}`);
      await lstat(source);
      const [actualCwd, actualSource] = await Promise.all([realpath(cwd), realpath(source)]);
      if (!isWithin(actualSource, actualCwd)) throw new Error(`artifact symlink escapes child workspace: ${artifact.path}`);
      await this.assertTreeConfined(source, actualCwd);
      const rel = artifact.path.split(/[\\/]+/).filter((part) => part && part !== ".").join("/");
      if (sharedWorkspace) {
        const workspaceRel = relative(actualCwd, actualSource).split(sep).join("/");
        published.push({ path: workspaceRel, ...(artifact.description ? { description: artifact.description } : {}) });
        continue;
      }
      const destRel = `subagent-results/${childId}/${rel}`;
      const dest = join(this.opts.workspaceDir, ...destRel.split("/"));
      await mkdir(dirname(dest), { recursive: true });
      await cp(source, dest, { recursive: true, dereference: false, force: false, errorOnExist: true });
      published.push({ path: destRel, ...(artifact.description ? { description: artifact.description } : {}) });
    }
    return published;
  }

  private async assertTreeConfined(path: string, allowedRoot: string): Promise<void> {
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      if (!isWithin(await realpath(path), allowedRoot)) throw new Error(`artifact symlink escapes child workspace: ${path}`);
      throw new Error(`artifact contains a symbolic link: ${path}`);
    }
    if (!info.isDirectory()) return;
    for (const entry of await readdir(path)) await this.assertTreeConfined(join(path, entry), allowedRoot);
  }

  private renderPrompt(
    task: string,
    context: string | undefined,
    inputs: Array<{ alias: string; path: string; mode: string; source: string }>,
    workspaceMode: "isolated" | "shared",
    scratchDir: string,
  ): string {
    return [
      "<subagent_task>", task.trim(), "</subagent_task>",
      `<workspace_mode>${workspaceMode}</workspace_mode>`,
      `<scratch_dir>${scratchDir}</scratch_dir>`,
      context?.trim() ? `<context>\n${context.trim()}\n</context>` : "",
      `<inputs>\n${inputs.length ? JSON.stringify(inputs, null, 2) : "No file inputs were provided."}\n</inputs>`,
      "Complete only this task, then call submit_result.",
    ].filter(Boolean).join("\n\n");
  }

  private isActive(status: SubagentStatus["status"]): boolean {
    return status === "queued" || status === "waiting_for_capacity" || status === "running";
  }

  private usageFromEvent(event: PiAgentEvent): Partial<TokenUsage> | undefined {
    if (event.type !== "message_end") return undefined;
    const usage = (event as { message?: { usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } } }).message?.usage;
    if (!usage) return undefined;
    return { input: Number(usage.input ?? 0), output: Number(usage.output ?? 0), cacheRead: Number(usage.cacheRead ?? 0), cacheWrite: Number(usage.cacheWrite ?? 0) };
  }

  private update(id: string, patch: Partial<SubagentStatus>): void {
    const current = this.statuses.get(id);
    if (!current) return;
    Object.assign(current, patch);
    this.emit(current);
  }

  private emit(status: SubagentStatus): void {
    this.opts.bus.emit(ev.custom({ sessionId: this.opts.sessionId, agentName: status.parentAgent, runId: status.rootRunId ?? undefined }, CUSTOM_EVENT.SUBAGENT_STATE, { ...status }));
    void this.persist();
    this.opts.onChanged();
  }

  private statePath(): string { return join(this.opts.stateDir, "subagents", "runs.json"); }
  private persist(): Promise<void> {
    if (this.opts.persist === false) return Promise.resolve();
    const snapshot: PersistedState = { version: 1, runs: this.list() };
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(join(this.opts.stateDir, "subagents"), { recursive: true });
      await writeFile(this.statePath(), JSON.stringify(snapshot, null, 2), "utf8");
    }).catch(() => {});
    return this.writeChain;
  }
}
