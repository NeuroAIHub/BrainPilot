import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  assertWorkflowAgentRequest,
  assertWorkflowArtifact,
  assertWorkflowChecks,
  assertWorkflowJson,
  assertWorkflowModelBinding,
  assertWorkflowResult,
  compileWorkflowValidator,
  defineWorkflow,
  freezeWorkflowValue,
  isSafeWorkflowOutputPath,
  parseWorkflowDefinition,
  type WorkflowAgentRequest,
  type WorkflowArtifact,
  type WorkflowArtifactWrite,
  type WorkflowContext,
  type WorkflowDefinition,
  type WorkflowEvent,
  type WorkflowImplementation,
  type WorkflowModelBinding,
  type WorkflowRun,
  type WorkflowRunStatus,
  type WorkflowToolRequest, type WorkflowToolResult,
} from "@brainpilot/plugin-sdk/workflow";

export interface WorkflowHostContext {
  runAgent(request: WorkflowAgentRequest): Promise<unknown>;
  runTool?(request: WorkflowToolRequest): Promise<WorkflowToolResult>;
  readText(path: string): Promise<string>;
  /** Host must fence filesystem commit with the supplied createContext signal. */
  writeArtifact(request: WorkflowArtifactWrite): Promise<WorkflowArtifact>;
  emit?(event: WorkflowEvent): void;
}

export interface WorkflowRunManagerOptions {
  sessionId: string;
  statePath?: string;
  /** Trusted registry. Each accepted run captures its implementation once. */
  implementations: () => readonly WorkflowImplementation[];
  /** Admission gate only: disabling never revokes an accepted run. */
  isEnabled: (workflowId: string) => boolean | Promise<boolean>;
  availableCapabilities?: (binding: WorkflowModelBinding) => readonly string[];
  createContext: (run: WorkflowRun, signal: AbortSignal) => WorkflowHostContext | Promise<WorkflowHostContext>;
  onChanged?: (run: WorkflowRun) => void;
  onTerminal?: (run: WorkflowRun) => void | Promise<void>;
}

export interface StartWorkflowInput {
  workflowId: string;
  input: unknown;
  idempotencyKey: string;
  modelBinding: WorkflowModelBinding;
  turnId?: string;
}

interface ActiveRun {
  record: WorkflowRun;
  implementation: WorkflowImplementation;
  host: WorkflowHostContext;
  controller: AbortController;
  execution?: Promise<void>;
  outputPaths: Set<string>;
  pending: Set<Promise<unknown>>;
}

export class WorkflowStartError extends Error {
  constructor(readonly code: "WORKFLOW_DISABLED" | "WORKFLOW_UNAVAILABLE" | "WORKFLOW_PREFLIGHT" | "WORKFLOW_IDEMPOTENCY_CONFLICT" | "WORKFLOW_STOPPING", message: string) {
    super(message);
    this.name = "WorkflowStartError";
  }
}

const TERMINAL = new Set<WorkflowRunStatus>(["succeeded", "failed", "cancelled", "interrupted"]);
const STATUSES = new Set<WorkflowRunStatus>(["queued", "running", ...TERMINAL]);
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  const scalar = JSON.stringify(value);
  if (scalar === undefined) throw new Error("Expected validated JSON input.");
  return scalar;
}

function inputHash(input: unknown): string { return createHash("sha256").update(canonicalJson(input)).digest("hex"); }
function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Workflow cancelled by session Stop.");
}

/**
 * Per-session execution owner. UI/plugin enablement is admission, not cancellation.
 * This first contract restores records only; in-flight work becomes interrupted.
 */
export class WorkflowRunManager {
  private readonly records = new Map<string, WorkflowRun>();
  private readonly active = new Map<string, ActiveRun>();
  /** Admission preflight has no accepted Run yet, but Stop must own its signal. */
  private readonly admissions = new Map<string, AbortController>();
  private operations: Promise<unknown> = Promise.resolve();
  private stopEpoch = 0;
  private stopping: Promise<number> | undefined;

  constructor(private readonly options: WorkflowRunManagerOptions) {}

  definitions(): WorkflowDefinition[] {
    return this.options.implementations().map((implementation) => parseWorkflowDefinition(implementation.definition));
  }

  get(id: string): WorkflowRun | undefined {
    const record = this.records.get(id);
    return record ? copy(record) : undefined;
  }

  list(): WorkflowRun[] { return [...this.records.values()].map(copy); }
  /** Includes terminal-delivery work, so callers do not observe a false idle gap. */
  hasActive(): boolean { return this.active.size > 0 || this.admissions.size > 0; }

  async start(request: StartWorkflowInput): Promise<WorkflowRun> {
    const epoch = this.stopEpoch;
    if (this.stopping) throw new WorkflowStartError("WORKFLOW_STOPPING", "Session Stop is in progress.");
    assertWorkflowJson(request.input, "workflow input");
    assertWorkflowModelBinding(request.modelBinding);
    if (typeof request.idempotencyKey !== "string" || !request.idempotencyKey.trim() || request.idempotencyKey.length > 256) throw new Error("idempotencyKey must contain 1–256 characters");
    const captured = copy(request);
    const hash = inputHash(captured.input);
    return this.serial(async () => {
      const previous = [...this.records.values()].find((run) => run.workflowId === captured.workflowId && run.idempotencyKey === captured.idempotencyKey);
      if (previous) {
        if (previous.inputHash !== hash) throw new WorkflowStartError("WORKFLOW_IDEMPOTENCY_CONFLICT", "This idempotency key was accepted with different input.");
        // A retry only reads the original acceptance, including its original model.
        return copy(previous);
      }
      this.checkAdmissionEpoch(epoch);
      if (!await this.options.isEnabled(captured.workflowId)) throw new WorkflowStartError("WORKFLOW_DISABLED", `Workflow is disabled: ${captured.workflowId}`);
      const candidates = this.options.implementations().filter((item) => item.definition.id === captured.workflowId);
      if (candidates.length !== 1) throw new WorkflowStartError("WORKFLOW_UNAVAILABLE", `Expected one trusted implementation for ${captured.workflowId}; found ${candidates.length}.`);
      const implementation = defineWorkflow(candidates[0]!);
      compileWorkflowValidator(implementation.definition.inputSchema, "workflow input")(captured.input);
      if (this.options.availableCapabilities) {
        const available = new Set(this.options.availableCapabilities(captured.modelBinding));
        const missing = implementation.definition.requiredCapabilities.filter((capability) => !available.has(capability));
        if (missing.length) throw new WorkflowStartError("WORKFLOW_PREFLIGHT", `Missing required capabilities: ${missing.join(", ")}`);
      }
      const record: WorkflowRun = {
        id: `wf_${randomUUID()}`, sessionId: this.options.sessionId,
        ...(captured.turnId ? { turnId: captured.turnId } : {}),
        workflowId: implementation.definition.id, workflowVersion: implementation.definition.version,
        definition: copy(implementation.definition), modelBinding: copy(captured.modelBinding),
        idempotencyKey: captured.idempotencyKey, input: captured.input, inputHash: hash,
        status: "queued", acceptedAt: new Date().toISOString(), artifacts: [],
      };
      const controller = new AbortController();
      this.admissions.set(record.id, controller);
      this.changed(record);
      try {
        const host = await this.options.createContext(freezeWorkflowValue(copy(record)), controller.signal);
        checkSignal(controller.signal);
        if (implementation.preflight) {
          const checks = await implementation.preflight(freezeWorkflowValue(copy(record.input)), {
            signal: controller.signal,
            readText: async (path) => {
              checkSignal(controller.signal);
              const text = await host.readText(path);
              checkSignal(controller.signal);
              return text;
            },
          });
          checkSignal(controller.signal);
          assertWorkflowChecks(checks);
          const blocked = checks.filter((check) => check.required !== false && check.status !== "pass");
          if (blocked.length) throw new WorkflowStartError("WORKFLOW_PREFLIGHT", blocked.map((check) => `${check.kind}: ${check.message}`).join("; "));
        }
        // Preflight may yield while a user changes the switch. Acceptance is here.
        const enabled = await this.options.isEnabled(captured.workflowId);
        this.checkAdmissionEpoch(epoch);
        checkSignal(controller.signal);
        if (!enabled) throw new WorkflowStartError("WORKFLOW_DISABLED", `Workflow was disabled before acceptance: ${captured.workflowId}`);
        record.acceptedAt = new Date().toISOString();
        this.records.set(record.id, record);
        try { await this.persist(); }
        catch (error) { this.records.delete(record.id); throw error; }
        const active: ActiveRun = { record, implementation, host, controller, outputPaths: new Set(), pending: new Set() };
        this.active.set(record.id, active);
        this.changed(record);
        active.execution = Promise.resolve().then(() => this.execute(active)).catch((error) => {
          // A persistence/callback failure must not leave an unowned execution or
          // an unhandled rejection. No terminal delivery is claimed in this path.
          record.status = controller.signal.aborted ? "cancelled" : "failed";
          record.error = `Workflow lifecycle failed: ${messageOf(error)}`;
          record.finishedAt = new Date().toISOString();
          delete record.result;
          this.active.delete(record.id);
          this.changed(record);
        });
        return copy(record);
      } finally {
        this.admissions.delete(record.id);
        this.changed(record);
      }
    });
  }

  /** Wait for execution and terminal callback; never starts or resumes a run. */
  async wait(id: string): Promise<WorkflowRun | undefined> {
    await this.active.get(id)?.execution;
    return this.get(id);
  }

  async cancel(id: string): Promise<boolean> {
    const active = this.active.get(id);
    if (!active || TERMINAL.has(active.record.status)) return false;
    active.controller.abort();
    await active.execution;
    return true;
  }

  cancelAll(): Promise<number> {
    if (this.stopping) return this.stopping;
    this.stopEpoch++;
    const owned = [...this.active.values()];
    const targets = owned.filter((run) => !TERMINAL.has(run.record.status));
    const admissions = [...this.admissions.values()];
    const cancelled = new Set([...admissions, ...targets.map((run) => run.controller)]);
    for (const controller of cancelled) controller.abort();
    const operation = (async () => {
      // Admission checks queued before Stop must settle without accepting work.
      await this.operations;
      // A run whose acceptance was already being persisted can transition from
      // admission to active while Stop awaits that write. Fence and join it too.
      const settledOwners = new Set([...owned, ...this.active.values()]);
      for (const run of settledOwners) {
        if (!TERMINAL.has(run.record.status)) {
          cancelled.add(run.controller);
          run.controller.abort();
        }
      }
      await Promise.all([...settledOwners].map((run) => run.execution));
      return cancelled.size;
    })();
    this.stopping = operation.finally(() => { this.stopping = undefined; });
    return this.stopping;
  }

  async restore(): Promise<void> {
    await this.serial(async () => {
      if (this.active.size) throw new Error("Cannot restore workflow records during execution.");
      if (!this.options.statePath) return;
      let raw: string;
      try { raw = await readFile(this.options.statePath, "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
      const stored = JSON.parse(raw) as { version?: unknown; runs?: unknown };
      if (stored.version !== 1 || !Array.isArray(stored.runs)) throw new Error("Invalid workflow run state.");
      const recovered = new Map<string, WorkflowRun>();
      const keys = new Set<string>();
      for (const value of stored.runs) {
        assertWorkflowJson(value, "persisted workflow run");
        const record = value as WorkflowRun;
        if (typeof record.id !== "string" || !record.id.startsWith("wf_") || recovered.has(record.id)
          || record.sessionId !== this.options.sessionId || !STATUSES.has(record.status)
          || typeof record.idempotencyKey !== "string" || !record.idempotencyKey.trim()
          || typeof record.acceptedAt !== "string" || !Array.isArray(record.artifacts)) throw new Error("Invalid persisted workflow run identity.");
        parseWorkflowDefinition(record.definition);
        assertWorkflowModelBinding(record.modelBinding);
        if (record.workflowId !== record.definition.id || record.workflowVersion !== record.definition.version
          || record.inputHash !== inputHash(record.input)) throw new Error("Persisted workflow run does not match its definition/input.");
        const key = `${record.workflowId}\0${record.idempotencyKey}`;
        if (keys.has(key)) throw new Error("Duplicate persisted workflow idempotency key.");
        keys.add(key);
        for (const artifact of record.artifacts) {
          assertWorkflowArtifact(artifact);
          if (artifact.producerRunId !== record.id) throw new Error("Persisted artifact belongs to another run.");
        }
        if (record.result) {
          assertWorkflowResult(record.result);
          compileWorkflowValidator(record.definition.outputSchema, "workflow output data")(record.result.data);
        }
        if (record.status === "succeeded" && !record.result) throw new Error("Succeeded workflow record has no validated result.");
        if (!TERMINAL.has(record.status)) {
          record.status = "interrupted";
          record.finishedAt = new Date().toISOString();
          record.error = "Runtime stopped before this workflow completed. Start an explicit new run to retry; resume is unsupported.";
        }
        recovered.set(record.id, record);
      }
      this.records.clear();
      for (const [id, record] of recovered) this.records.set(id, record);
      await this.persist();
      for (const record of this.records.values()) this.changed(record);
      // Restore is inspection only. Never replay old terminal notifications.
    });
  }

  async flush(): Promise<void> { await this.operations; }

  private checkAdmissionEpoch(epoch: number): void {
    if (this.stopping || this.stopEpoch !== epoch) throw new WorkflowStartError("WORKFLOW_STOPPING", "Session Stop interrupted workflow admission.");
  }

  private context(active: ActiveRun): WorkflowContext {
    const { controller, record, host } = active;
    const own = async <T>(operation: Promise<T>): Promise<T> => {
      active.pending.add(operation);
      try { return await operation; } finally { active.pending.delete(operation); }
    };
    return {
      runId: record.id,
      modelBinding: freezeWorkflowValue(copy(record.modelBinding)),
      signal: controller.signal,
      readText: async (path) => {
        checkSignal(controller.signal);
        const text = await host.readText(path);
        checkSignal(controller.signal);
        return text;
      },
      runAgent: async (request) => {
        checkSignal(controller.signal);
        assertWorkflowAgentRequest(request);
        const validate = compileWorkflowValidator(request.outputSchema, `stage ${request.stageId} output`);
        const result = await own(host.runAgent(freezeWorkflowValue(copy(request))));
        checkSignal(controller.signal);
        validate(result);
        return copy(result);
      },
      runTool: async request => {
        checkSignal(controller.signal);
        assertWorkflowJson(request, "workflow tool request");
        if (!request.name?.trim() || !host.runTool) throw new Error("The workflow tool is not available in this host");
        const result = await own(host.runTool(freezeWorkflowValue(copy(request))));
        checkSignal(controller.signal);
        assertWorkflowJson(result, "workflow tool result");
        if (!("data" in result) || !Array.isArray(result.artifacts)) throw new Error("A workflow tool must return data and artifacts");
        for (const artifact of result.artifacts) {
          assertWorkflowArtifact(artifact);
          if (artifact.producerRunId !== record.id) throw new Error("Tool artifact belongs to a different run");
        }
        await this.serial(async () => {
          checkSignal(controller.signal);
          for (const artifact of result.artifacts) {
            const previous = record.artifacts.find(item => item.path === artifact.path);
            if (previous && canonicalJson(previous) !== canonicalJson(artifact)) throw new Error("A tool cannot replace a published artifact");
            if (!previous) record.artifacts.push(copy(artifact));
          }
          await this.persist(); this.changed(record);
        });
        return copy(result);
      },
      writeArtifact: async (request) => {
        checkSignal(controller.signal);
        if (!isSafeWorkflowOutputPath(request.path)) throw new Error("Workflow artifact path must remain inside the run output directory.");
        if (typeof request.content !== "string" || !request.mediaType?.trim() || !request.role?.trim()) throw new Error("Artifact requires text content, mediaType, and role.");
        if (active.outputPaths.has(request.path)) throw new Error("Workflow artifacts are immutable; use a new path for a revision.");
        active.outputPaths.add(request.path);
        const artifact = await host.writeArtifact({ ...request });
        checkSignal(controller.signal);
        assertWorkflowArtifact(artifact);
        if (artifact.producerRunId !== record.id || artifact.mediaType !== request.mediaType || artifact.role !== request.role
          || artifact.sha256 !== createHash("sha256").update(request.content).digest("hex")) throw new Error("Host artifact does not match this run/write request.");
        await this.serial(async () => {
          checkSignal(controller.signal);
          if (record.artifacts.some((item) => item.path === artifact.path)) throw new Error("Workflow artifacts are immutable; use a new path for a revision.");
          record.artifacts.push(copy(artifact));
          await this.persist();
          this.changed(record);
        });
        return copy(artifact);
      },
      emit: (event) => {
        checkSignal(controller.signal);
        assertWorkflowJson(event, "workflow event");
        if (typeof event.type !== "string" || !event.type.trim()) throw new Error("Workflow event type is required.");
        host.emit?.(copy(event));
      },
    };
  }

  private async execute(active: ActiveRun): Promise<void> {
    const { record, controller, implementation } = active;
    try {
      await this.serial(async () => {
        checkSignal(controller.signal);
        record.status = "running";
        record.startedAt = new Date().toISOString();
        await this.persist();
        this.changed(record);
      });
      const result = await implementation.run(freezeWorkflowValue(copy(record.input)), this.context(active));
      await Promise.all([...active.pending]);
      checkSignal(controller.signal);
      assertWorkflowResult(result);
      compileWorkflowValidator(record.definition.outputSchema, "workflow output data")(result.data);
      const seen = new Set<string>();
      for (const artifact of result.artifacts) {
        if (seen.has(artifact.path) || !record.artifacts.some((item) => canonicalJson(item) === canonicalJson(artifact))) {
          throw new Error("Workflow result references an uncommitted or duplicate artifact.");
        }
        seen.add(artifact.path);
      }
      await this.serial(async () => {
        checkSignal(controller.signal);
        record.result = copy(result);
        record.status = "succeeded";
        record.finishedAt = new Date().toISOString();
        await this.persist();
        this.changed(record);
      });
    } catch (error) {
      const cancelled = controller.signal.aborted;
      controller.abort(error);
      await Promise.allSettled([...active.pending]);
      await this.serial(async () => {
        record.status = cancelled ? "cancelled" : "failed";
        record.error = messageOf(error);
        record.finishedAt = new Date().toISOString();
        delete record.result;
        await this.persist();
        this.changed(record);
      });
    }
    try {
      await this.options.onTerminal?.(copy(record));
    } catch (error) {
      await this.serial(async () => {
        record.terminalDeliveryError = messageOf(error);
        await this.persist();
        this.changed(record);
      });
    } finally {
      this.active.delete(record.id);
      this.changed(record);
    }
  }

  private changed(record: WorkflowRun): void {
    try { this.options.onChanged?.(copy(record)); }
    catch { /* An observational UI listener cannot change execution ownership. */ }
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation);
    this.operations = result.catch(() => undefined);
    return result;
  }

  private async persist(): Promise<void> {
    if (!this.options.statePath) return;
    await mkdir(dirname(this.options.statePath), { recursive: true });
    const temporary = `${this.options.statePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, runs: [...this.records.values()] }, null, 2), "utf8");
    await rename(temporary, this.options.statePath);
  }
}
