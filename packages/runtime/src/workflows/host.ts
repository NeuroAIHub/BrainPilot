import { mkdir, readFile, realpath, stat, lstat, writeFile, link, unlink, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  compileWorkflowValidator, isSafeWorkflowOutputPath,
  type WorkflowAgentRequest, type WorkflowArtifactWrite, type WorkflowImplementation,
  type WorkflowRun, type WorkflowToolRequest, type WorkflowToolResult,
} from "@brainpilot/plugin-sdk/workflow";
import type { AgentSessionFactory, IAgentSession, PiMessage, PiUsage, SystemTool, WorkflowAgentModelBinding } from "../types.js";
import { WorkflowRunManager } from "./run-manager.js";
import { executeNativeWorkflowTool, nativeWorkflowCapabilities } from "./native-tools.js";
import { WorkflowStageLifecycle } from "./stage-lifecycle.js";

export interface WorkflowHostOptions {
  sessionId: string;
  workspaceDir: string;
  stateDir: string;
  persist: boolean;
  implementations: () => readonly WorkflowImplementation[];
  isEnabled(id: string): boolean;
  captureBinding(): Promise<WorkflowAgentModelBinding>;
  agentFactory: AgentSessionFactory;
  runWithCapacity<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T>;
  onUsage(stageId: string, usage: PiUsage): void;
  onChanged(): void;
  onTerminal(run: WorkflowRun): Promise<void>;
  stageTimeoutMs?: number;
  /** Bounded wait for a fenced stage's third-party teardown before it is reported incomplete. */
  stageCleanupGraceMs?: number;
  /** Uses the current session resource permissions and configured research tools. */
  runResearchTool?(request: WorkflowToolRequest, signal: AbortSignal): Promise<WorkflowToolResult>;
}

/**
 * One bounded correction for a stage whose turn ended normally without ever
 * calling `submit_result`: the analysis happened, only the delivery is missing.
 * It is sent in the same session, so the original turn and its attachments stay
 * in history; no prose answer is ever parsed or adopted as the stage result.
 */
const NATIVE_RESULT_CORRECTION = [
  "Your previous response ended without calling submit_result, so this stage still has no delivered result.",
  "Finish this same stage now by calling submit_result exactly once, with {\"result\": <the complete output matching that tool's schema>}.",
  "Use only the material already provided and the analysis you have already completed; do not redo or extend the work.",
  "Do not reply with prose or a JSON code block again: only the submit_result tool call delivers this stage's result.",
].join(" ");

/** The same declared model/native-tool capabilities are used for discovery and admission. */
export function workflowHostCapabilities(binding?: Pick<WorkflowAgentModelBinding, "model">): string[] {
  return ["agent", "readText", "writeArtifact", "network", "runTool", ...nativeWorkflowCapabilities(),
    ...(Array.isArray(binding?.model.input) && binding.model.input.includes("image") ? ["images"] : [])];
}

/** Native Pi execution owned by the host. Disabling affects admission only. */
export class WorkflowHost {
  readonly manager: WorkflowRunManager;
  private readonly bindings = new Map<string, WorkflowAgentModelBinding>();
  private readonly snapshots = new Map<string, Map<string, Promise<string>>>();
  private readonly contextRuns = new Map<string, string>();
  private readonly stages = new Map<string, IAgentSession>();

  constructor(private readonly options: WorkflowHostOptions) {
    this.manager = new WorkflowRunManager({
      sessionId: options.sessionId,
      ...(options.persist ? { statePath: join(options.stateDir, "workflows.json") } : {}),
      implementations: options.implementations,
      isEnabled: options.isEnabled,
      availableCapabilities: publicBinding => workflowHostCapabilities(this.bindings.get(publicBinding.id)),
      createContext: (run, signal) => {
        this.contextRuns.set(run.modelBinding.id, run.id);
        return {
        readText: (path: string) => this.readSnapshot(run.id, path, signal),
        writeArtifact: (request: WorkflowArtifactWrite) => this.writeArtifact(run.id, request, signal),
        runAgent: (request: WorkflowAgentRequest) => this.runAgent(run, request, signal),
        runTool: request => ["research_search", "research_resolve"].includes(request.name)
          ? options.runResearchTool ? options.runResearchTool(request, signal) : Promise.reject(new Error("BrainPilot research sources are unavailable in this host"))
          : executeNativeWorkflowTool({ runId: run.id, workspaceDir: options.workspaceDir, request, signal,
          publishFile: async file => this.publishBytes(run.id, { path: file.path, mediaType: file.mediaType, role: file.role,
            content: await this.readWorkspaceBytes(file.sourcePath, 50_000_000, signal) }, signal),
        }),
        emit: () => options.onChanged(),
        };
      },
      onChanged: () => options.onChanged(),
      onTerminal: async (run) => {
        this.bindings.delete(run.modelBinding.id);
        this.contextRuns.delete(run.modelBinding.id);
        this.snapshots.delete(run.id);
        // RunManager joins owned host calls before this callback, including
        // cancelled siblings. Rendered pages are no longer in use at this point.
        try { await this.cleanupTemporaryFiles(run); }
        catch (error) {
          // Cleanup is best-effort; the durable terminal outbox must still run.
          console.warn(`[workflow:${run.id}] Temporary cleanup skipped or failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        await options.onTerminal(run);
      },
    });
  }

  async start(input: { workflowId: string; input: unknown; idempotencyKey: string; turnId?: string }): Promise<WorkflowRun> {
    // Existing retries must return the old record even after disabling. Manager
    // validates idempotency and input identity; no new model work is performed.
    const previous = this.manager.list().find(r => r.workflowId === input.workflowId && r.idempotencyKey === input.idempotencyKey);
    if (previous) return this.manager.start({ ...input, modelBinding: previous.modelBinding });
    if (!this.options.isEnabled(input.workflowId)) throw new Error("WORKFLOW_DISABLED: this workflow is unavailable for new runs");
    const binding = await this.options.captureBinding();
    const id = randomUUID();
    this.bindings.set(id, binding);
    try {
      const run = await this.manager.start({ ...input, modelBinding: {
        id, providerId: binding.model.provider, modelId: binding.model.id,
        thinkingLevel: binding.thinkingLevel,
        ...(binding.model.api ? { api: binding.model.api } : {}),
      } });
      if (run.modelBinding.id !== id) this.bindings.delete(id);
      return run;
    } catch (error) {
      this.bindings.delete(id);
      const contextRun = this.contextRuns.get(id);
      if (contextRun) this.snapshots.delete(contextRun);
      this.contextRuns.delete(id);
      throw error;
    }
  }

  private async cleanupTemporaryFiles(run: WorkflowRun): Promise<void> {
    if (!/^wf_[A-Za-z0-9_-]+$/.test(run.id)) throw new Error("Invalid workflow run directory identity");
    const temporaryPrefix = `workflow-runs/${run.id}/.work`;
    if (run.artifacts.some(artifact => artifact.path === temporaryPrefix || artifact.path.startsWith(`${temporaryPrefix}/`))) {
      throw new Error("Temporary directory contains a published artifact; preserving it");
    }
    const workspace = resolve(this.options.workspaceDir);
    const workspaceInfo = await lstat(workspace);
    if (!workspaceInfo.isDirectory() || workspaceInfo.isSymbolicLink()) throw new Error("Workflow workspace cannot be a symlink during cleanup");
    const root = await realpath(workspace);
    let target = root;
    for (const part of ["workflow-runs", run.id, ".work"]) {
      target = join(target, part);
      let info: Awaited<ReturnType<typeof lstat>>;
      try { info = await lstat(target); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Workflow temporary directories cannot be symlinks");
      if (await realpath(target) !== target) throw new Error("Workflow temporary directory changed during cleanup");
    }
    // Only this run's private scratch directory is removed. fs.rm does not
    // traverse symlinks contained in the scratch tree.
    await rm(target, { recursive: true, force: true });
  }

  private async readSnapshot(runId: string, requested: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    let cache = this.snapshots.get(runId);
    if (!cache) { cache = new Map(); this.snapshots.set(runId, cache); }
    if (!cache.has(requested)) cache.set(requested, this.readWorkspaceText(requested, signal));
    const text = await cache.get(requested)!;
    signal.throwIfAborted();
    return text;
  }

  private async readWorkspaceText(requested: string, signal: AbortSignal): Promise<string> {
    if (!requested || requested.includes("\0")) throw new Error("Invalid workflow input path");
    const root = await realpath(this.options.workspaceDir);
    const logical = requested === "/workspace" ? "." : requested.startsWith("/workspace/") ? requested.slice(11) : requested;
    const candidate = await realpath(isAbsolute(logical) ? logical : resolve(root, logical));
    if (candidate !== root && !candidate.startsWith(root + sep)) throw new Error("Workflow input is outside this session workspace");
    const info = await stat(candidate);
    if (!info.isFile() || info.size > 2_000_000) throw new Error("Workflow input must be a text file of at most 2 MB");
    signal.throwIfAborted();
    return readFile(candidate, { encoding: "utf8", signal });
  }

  private async writeArtifact(runId: string, request: WorkflowArtifactWrite, signal: AbortSignal) {
    return this.publishBytes(runId, request, signal);
  }

  private async readWorkspaceBytes(requested: string, limit: number, signal: AbortSignal): Promise<Buffer> {
    signal.throwIfAborted();
    if (!requested || requested.includes("\0")) throw new Error("Invalid workflow file path");
    const root = await realpath(this.options.workspaceDir);
    const logical = requested.startsWith("/workspace/") ? requested.slice(11) : requested;
    const path = await realpath(isAbsolute(logical) ? logical : resolve(root, logical));
    if (!path.startsWith(root + sep)) throw new Error("Workflow file escapes this session workspace");
    const info = await stat(path);
    if (!info.isFile() || info.size > limit) throw new Error(`Workflow file must be a regular file within ${limit} bytes`);
    return readFile(path, { signal });
  }

  private async publishBytes(runId: string, request: Omit<WorkflowArtifactWrite, "content"> & { content: string | Buffer }, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!isSafeWorkflowOutputPath(request.path)) throw new Error("Invalid workflow artifact path");
    const root = await realpath(this.options.workspaceDir);
    const parts = ["workflow-runs", runId, ...request.path.split("/")];
    let parent = root;
    for (const part of parts.slice(0, -1)) {
      parent = join(parent, part);
      await mkdir(parent, { recursive: false }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
      const info = await lstat(parent);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Workflow output directories cannot be symlinks");
      const canonical = await realpath(parent);
      if (!canonical.startsWith(root + sep)) throw new Error("Workflow artifact directory escapes workspace");
      parent = canonical;
    }
    const target = join(parent, parts.at(-1)!);
    const temporary = `${target}.pending-${randomUUID()}`;
    let committed = false;
    let owned: { ino: number; dev: number } | undefined;
    try {
      await writeFile(temporary, request.content, { encoding: "utf8", flag: "wx", signal });
      owned = await lstat(temporary);
      signal.throwIfAborted();
      // Atomic exclusive publication: an existing target (including a symlink)
      // is never overwritten, even if it appeared after our directory checks.
      await link(temporary, target);
      committed = true;
      signal.throwIfAborted();
    } catch (error) {
      if (committed && owned) {
        const current = await lstat(target).catch(() => undefined);
        if (current?.ino === owned.ino && current.dev === owned.dev) await unlink(target).catch(() => {});
      }
      throw error;
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return { path: relative(root, target).split(sep).join("/"), mediaType: request.mediaType,
      role: request.role, sha256: createHash("sha256").update(request.content).digest("hex"), producerRunId: runId };
  }

  private async runAgent(run: WorkflowRun, request: WorkflowAgentRequest, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    // All filesystem/network actions are exposed as explicit host capabilities;
    // this first workflow uses model-only structured stages.
    if (request.tools?.length) throw new Error("Workflow stage tool capability is not supported by this host yet");
    const binding = this.bindings.get(run.modelBinding.id);
    if (!binding) throw new Error("Accepted workflow model binding is unavailable; create a new run");
    const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
    if (request.images?.length) {
      if (!Array.isArray(binding.model.input) || !binding.model.input.includes("image")) throw new Error("The selected Pi model cannot accept the images required by this workflow");
      let total = 0;
      for (const path of request.images) {
        const data = await this.readWorkspaceBytes(path, 20_000_000, signal);
        total += data.length;
        if (total > 50_000_000) throw new Error("Workflow image attachments exceed 50 MB");
        const mimeType = data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png"
          : data[0] === 255 && data[1] === 216 ? "image/jpeg"
          : data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP" ? "image/webp" : undefined;
        if (!mimeType) throw new Error("Unsupported workflow image format");
        images.push({ type: "image", data: data.toString("base64"), mimeType });
      }
    }
    const validate = compileWorkflowValidator(request.outputSchema, "stage result");
    return this.options.runWithCapacity(async () => {
      signal.throwIfAborted();
      const stageId = `${run.id}:${request.stageId}:${randomUUID()}`;
      const stageDir = join(this.options.stateDir, "workflow-stages", run.id, createHash("sha256").update(stageId).digest("hex").slice(0, 16));
      await mkdir(stageDir, { recursive: true });
      let submitted = false;
      let result: unknown;
      let failed: string | undefined;
      let lastStopReason: string | undefined;
      // Whole-manuscript generations can exceed a short interactive turn. The
      // stage owns a finite deadline of its own, so a provider that keeps
      // streaming past it can no longer hold the run (or its capacity slot)
      // open; caller overrides and parent Stop still win. A stage may request
      // its own budget (validated by the run manager); otherwise the host's
      // configured budget, or the finite lifecycle default, applies.
      const stageTimeoutMs = request.timeoutMs ?? this.options.stageTimeoutMs;
      const lifecycle = new WorkflowStageLifecycle({
        parentSignal: signal,
        ...(stageTimeoutMs === undefined ? {} : { timeoutMs: stageTimeoutMs }),
        ...(this.options.stageCleanupGraceMs === undefined ? {} : { cleanupGraceMs: this.options.stageCleanupGraceMs }),
        onDiagnostic: message => { console.warn(`[workflow:${run.id}] stage ${request.stageId}: ${message}`); },
      });
      try {
        const submitTool: SystemTool = {
          name: "submit_result", description: "Submit this workflow stage's structured result once. Successful submission completes the stage.",
          parameters: { type: "object", additionalProperties: false, required: ["result"], properties: { result: request.outputSchema } },
          execute: async (params) => {
            // The stage's own fence, not just the parent signal: a timed-out or
            // stopped stage rejects a late result even while Pi is still alive.
            lifecycle.assertAcceptingResult();
            validate(params.result);
            if (submitted) throw new Error("Stage result was already submitted");
            result = params.result; submitted = true;
            return { content: [{ type: "text", text: "Result accepted. Stage complete." }] };
          },
        };
        const session = await this.options.agentFactory({
          sessionId: this.options.sessionId, agentName: `workflow-${stageId}`, role: "expert",
          cwd: stageDir, historyPath: join(stageDir, "history.jsonl"),
          systemTools: [submitTool], allowedToolNames: ["submit_result"],
          systemPrompt: `${request.instructions}\n\nReturn this stage's result with submit_result. Successful submission completes the stage.`,
          suppressCoordinationHooks: true, skillPaths: [],
          thinkingLevel: binding.thinkingLevel, workflowModelBinding: binding,
          workflowStageCancellation: lifecycle,
        });
        lifecycle.attach(session);
        this.stages.set(stageId, session);
        const unsubscribe = session.subscribe(event => {
          // Real tokens were billed up to disposal, so usage is still recorded
          // for an aborted attempt; nothing arriving after disposal is used.
          if (!lifecycle.acceptsEvents) return;
          if (event.type !== "message_end") return;
          const message = event.message as PiMessage | undefined;
          if (message?.role !== "assistant") return;
          if (message.usage) this.options.onUsage(stageId, message.usage);
          lastStopReason = typeof message.stopReason === "string" ? message.stopReason : undefined;
          // Pi can retry an incomplete provider response before executing tools.
          // A later complete response supersedes that attempt's error; keep every
          // attempt's usage, but do not permanently poison a recovered stage.
          failed = message.stopReason === "error" || message.errorMessage
            ? String(message.errorMessage || "Workflow model request failed") : undefined;
        });
        try {
          return await lifecycle.run({
            prompt: async () => {
              await session.prompt(JSON.stringify(request.inputs), images.length ? { images } : undefined);
              // A turn that simply stopped — no error, no truncation, no abort —
              // and delivered nothing is a missed tool call, not a result. One
              // correction is sent inside this same stage, session, binding and
              // deadline; anything else (including a second miss) still fails.
              if (submitted || failed || lastStopReason !== "stop" || session.isStreaming) return;
              // Stop and the stage deadline stay authoritative: a fenced stage
              // spends no further model work.
              lifecycle.assertAcceptingResult();
              await session.prompt(NATIVE_RESULT_CORRECTION);
            },
            complete: () => {
              if (failed) throw new Error(failed);
              if (!submitted) throw new Error("Workflow stage ended without a validated submit_result");
              return result;
            },
          });
        } finally {
          unsubscribe(); this.stages.delete(stageId);
        }
      } finally {
        // Releases the deadline, and tears down a session that never ran.
        await lifecycle.close();
      }
    }, signal);
  }
}
