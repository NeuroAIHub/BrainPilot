/**
 * MasAgent — wraps one Pi (or mock) AgentSession.
 *
 * Responsibilities:
 *  - Own the agent's authoritative `status` (idle/running/error/stopped) — §10.
 *  - Translate Pi events → AG-UI events (§6) onto the session EventBus.
 *  - Per-agent error isolation (§7 L2): a thrown prompt never escapes; it is
 *    converted to RUN_ERROR + system_message and the agent goes to `error`.
 *  - Map Pi `auto_retry_start/end` → agent_status_update + system_message;
 *    suppress internal events (turn_*, compaction_*).
 *
 * Behavioural hooks (remind/trace/reply/delegate) used to live here as per-turn
 * TurnTrackers (#79). They now live in the Pi-native `trace-reminder` extension
 * (`extensions/trace-reminder.ts`), registered per AgentSession by the real
 * factory. MasAgent is back to a pure Pi→AG-UI translator.
 */
import {
  CUSTOM_EVENT,
  type AgUiEvent,
  type ActiveToolExecution,
  type AgentRetryState,
  type AgentState,
  type AgentStats,
  type RunStatsStatus,
  type TokenUsage,
} from "@brainpilot/protocol";
import type { EventBus } from "./event-bus.js";
import { ev, newMessageId, newRunId } from "./events.js";
import { normalizeAgentError, classifyAgentError, type AgentErrorKind } from "./agent-error.js";
import {
  cloneAgentStats,
  emptyAgentStats,
  recordSkillCall,
  subtractAgentStats,
} from "./usage-stats.js";
import type {
  AgentRole,
  IAgentSession,
  PiAgentEvent,
  PiAssistantMessageEvent,
  PiUsage,
} from "./types.js";
import {
  domainResourceUsageOnStart,
  domainResourceUsageOnSuccess,
} from "./domain-resources.js";

export type AgentStatus = "idle" | "running" | "error" | "stopped";
export type ToolInterruptResult = {
  interrupted: boolean;
  reason?: "already_finished" | "not_cancellable" | "timeout";
};

const TOOL_INTERRUPT_TIMEOUT_MS = 10_000;

/** Zeroed token counters — the identity element for accumulation. */
export function emptyTokenUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

/**
 * Fold a provider-reported `PiUsage` into a running `TokenUsage` total
 * (mutates and returns `acc`). Missing fields count as 0. `total` is summed
 * from the components rather than trusting the provider's `totalTokens` so the
 * per-agent breakdown always sums to the session total under one definition.
 */
export function addUsage(acc: TokenUsage, u: PiUsage | undefined): TokenUsage {
  if (!u) return acc;
  const input = u.input ?? 0;
  const output = u.output ?? 0;
  const cacheRead = u.cacheRead ?? 0;
  const cacheWrite = u.cacheWrite ?? 0;
  acc.input += input;
  acc.output += output;
  acc.cacheRead += cacheRead;
  acc.cacheWrite += cacheWrite;
  acc.total += input + output + cacheRead + cacheWrite;
  return acc;
}

export interface MasAgentOpts {
  sessionId: string;
  name: string;
  role: AgentRole;
  session: IAgentSession;
  bus: EventBus;
  onStatusChange?: (name: string, status: AgentStatus) => void;
  /**
   * Invoked after each assistant turn whose `message_end` carried provider
   * token usage. `delta` is just-added usage for this turn; `cumulative` is the
   * agent's running total. The SessionManager uses this to roll up the
   * per-session total, push a session_state frame, and persist usage.json.
   */
  onUsage?: (name: string, delta: TokenUsage, cumulative: TokenUsage) => void;
  /**
   * Per-run summary callback (usage-stats feature). Invoked once per completed
   * run with the delta (tools/skills/errors/tokens added during that run) and
   * the agent's post-run cumulative snapshot. The SessionManager uses this to
   * append a `RunStats` entry to `stats.json` and re-aggregate the session's
   * `byAgent[name]` / `total` fields.
   */
  onRunStats?: (info: {
    name: string;
    runId: string;
    startedAt: number;
    finishedAt: number;
    status: RunStatsStatus;
    delta: AgentStats;
    cumulative: AgentStats;
  }) => void;
}

export class MasAgent {
  readonly name: string;
  readonly role: AgentRole;
  private readonly sessionId: string;
  private readonly session: IAgentSession;
  private readonly bus: EventBus;
  private readonly unsubscribe: () => void;

  private _status: AgentStatus = "idle";
  /** Present only while Pi is sleeping before another provider attempt. */
  private currentRetry: AgentRetryState | undefined;
  /** Provider errors are held until Pi either retries successfully or exhausts. */
  private pendingProviderError: string | undefined;
  /** True while an explicit BrainPilot interrupt is unwinding the active run. */
  private abortRequested = false;
  private currentRunId: string | undefined;
  private currentMessageId: string | undefined;
  private inReasoning = false;
  private activeToolExecutions = new Set<string>();
  /** Runtime authority for live tools; chat events are only its persisted projection. */
  private activeToolCalls = new Map<string, {
    toolName: string;
    args: Record<string, unknown>;
    startedAt: number;
    status: "running" | "stopping";
    cancellable: boolean;
    interruptionReason?: "user_requested" | "task_interrupted" | "agent_interrupted";
    completion: Promise<void>;
    complete: () => void;
  }>();
  private toolInterrupts = new Map<string, Promise<ToolInterruptResult>>();
  private lastError: AgentState["lastError"];
  /**
   * Cumulative real token usage for THIS agent across every assistant turn,
   * summed from provider-reported `usage` on `message_end`. Read by `usage()`;
   * fed to `onUsage` so the SessionManager can roll up the per-session total.
   */
  private cumulativeUsage: TokenUsage = emptyTokenUsage();
  /**
   * Full cumulative stats for THIS agent (tokens + tools + skills + errors).
   * `cumulativeUsage` above is kept as a separate mirror because
   * `mas-agent.ts`'s legacy `usage()` and `onUsage` callback plus the existing
   * `usage.json` persistence path depend on that exact reference — the delta
   * arithmetic here rolls the same numbers up but into a richer shape used
   * only by the new `stats.json` path.
   */
  private cumulativeStats: AgentStats = emptyAgentStats();
  /**
   * Baseline snapshot captured at the start of the currently-running prompt.
   * `runPrompt` clones `cumulativeStats` into this on entry, and the terminal
   * event computes the run's delta as `cumulativeStats - runStartSnapshot`.
   * Undefined between runs.
   */
  private runStartSnapshot: AgentStats | undefined;
  /**
   * Wall-clock start of the currently-running prompt (Date.now() at
   * `RUN_STARTED` emit time). Stamped onto the resulting `RunStats.startedAt`.
   */
  private runStartedAt: number | undefined;
  /**
   * #97 error path: recoverability class of the most recent error, or undefined
   * when the last run did not error. The delivery loop reads this after a run to
   * decide self-retry (retryable) vs immediate escalation to the principal
   * (fatal). Reset to undefined whenever a run completes without error.
   */
  private _lastErrorKind: AgentErrorKind | undefined;
  /**
   * The in-flight `prompt()` promise (its try/catch/finally inclusive), or
   * undefined when idle. `abort()` awaits this so a caller can fence the old
   * run — guaranteeing RUN_FINISHED is emitted and `status` has settled —
   * before starting a new one (#101).
   */
  private currentPrompt: Promise<void> | undefined;

  constructor(private readonly opts: MasAgentOpts) {
    this.name = opts.name;
    this.role = opts.role;
    this.sessionId = opts.sessionId;
    this.session = opts.session;
    this.bus = opts.bus;
    this.unsubscribe = this.session.subscribe((e) => this.onPiEvent(e));
  }

  get status(): AgentStatus {
    return this._status;
  }

  /**
   * #97: the recoverability class of the last error (`retryable`/`fatal`), or
   * undefined if the last run did not error. Read by the delivery loop to choose
   * self-retry vs escalation. The headline of that error is in `lastError`.
   */
  get lastErrorKind(): AgentErrorKind | undefined {
    return this._lastErrorKind;
  }

  /**
   * Cumulative real token usage for this agent (a copy, safe to mutate). Used
   * by the SessionManager when rebuilding the per-session breakdown and when
   * persisting usage.json.
   */
  usage(): TokenUsage {
    return { ...this.cumulativeUsage };
  }

  /**
   * Restore this agent's cumulative usage from persisted state (restore path,
   * before any new turn). No-op if `u` is undefined.
   */
  seedUsage(u: TokenUsage | undefined): void {
    if (u) this.cumulativeUsage = { ...u };
  }

  /**
   * Cumulative full stats for this agent (a deep copy, safe to mutate). Used
   * by SessionManager to rebuild the per-session breakdown and to persist
   * `stats.json`.
   */
  stats(): AgentStats {
    return cloneAgentStats(this.cumulativeStats);
  }

  /**
   * Restore this agent's cumulative stats from persisted state (restore path,
   * before any new turn). No-op if `s` is undefined.
   */
  seedStats(s: AgentStats | undefined): void {
    if (s) this.cumulativeStats = cloneAgentStats(s);
  }

  /** §10 authoritative state snapshot. */
  state(): AgentState {
    const s: AgentState = { name: this.name, status: this._status };
    if (this.currentRunId) s.activeRunId = this.currentRunId;
    s.activeToolExecutions = [...this.activeToolExecutions];
    s.activeTools = this.activeTools();
    if (this.currentRetry) s.retry = this.currentRetry;
    if (this.lastError) s.lastError = this.lastError;
    return s;
  }

  private emitStateUpdate(): void {
    // The callback publishes the wholesale session_state snapshot; the
    // standalone event keeps incremental clients live between snapshots.
    this.opts.onStatusChange?.(this.name, this._status);
    this.bus.emit(
      ev.agentStatusUpdate({ sessionId: this.sessionId, runId: this.currentRunId }, this.name, this._status, {
        activeRunId: this.currentRunId,
        activeToolExecutions: [...this.activeToolExecutions],
        activeTools: this.activeTools(),
        retry: this.currentRetry,
        lastError: this.lastError,
      }),
    );
  }

  private activeTools(): ActiveToolExecution[] {
    return [...this.activeToolCalls.entries()].map(([toolCallId, tool]) => ({
      toolCallId,
      toolName: tool.toolName,
      ...(this.currentRunId ? { runId: this.currentRunId } : {}),
      startedAt: new Date(tool.startedAt).toISOString(),
      cancellable: tool.cancellable,
      status: tool.status,
    }));
  }

  hasActiveTools(): boolean {
    return this.activeToolCalls.size > 0;
  }

  hasTool(toolCallId: string): boolean {
    return this.activeToolCalls.has(toolCallId);
  }

  interruptTool(toolCallId: string): Promise<ToolInterruptResult> {
    const inflight = this.toolInterrupts.get(toolCallId);
    if (inflight) return inflight;
    const tool = this.activeToolCalls.get(toolCallId);
    if (!tool) return Promise.resolve({ interrupted: false, reason: "already_finished" });
    if (!tool.cancellable || !this.session.interruptTool) {
      return Promise.resolve({ interrupted: false, reason: "not_cancellable" });
    }
    const operation = (async (): Promise<ToolInterruptResult> => {
      tool.status = "stopping";
      tool.interruptionReason = "user_requested";
      this.emitStateUpdate();
      if (!this.session.interruptTool!(toolCallId)) {
        tool.status = "running";
        tool.interruptionReason = undefined;
        this.emitStateUpdate();
        return { interrupted: false, reason: "already_finished" };
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settled = await Promise.race([
        tool.completion.then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), TOOL_INTERRUPT_TIMEOUT_MS);
        }),
      ]);
      if (timer) clearTimeout(timer);
      return settled
        ? { interrupted: true }
        : { interrupted: false, reason: "timeout" };
    })().finally(() => this.toolInterrupts.delete(toolCallId));
    this.toolInterrupts.set(toolCallId, operation);
    return operation;
  }

  private setStatus(status: AgentStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.emitStateUpdate();
  }

  private finishTool(
    ctx: { sessionId: string; agentName: string; runId?: string },
    toolCallId: string,
    toolName: string,
    result: unknown,
    isError: boolean,
    emitFailureWarning = true,
  ): void {
    const started = this.activeToolCalls.get(toolCallId);
    if (!started) return; // terminal event already claimed
    const durationMs = Math.max(0, Date.now() - started.startedAt);
    const interrupted = started.interruptionReason !== undefined;
    const status = interrupted ? "interrupted" : isError ? "failed" : "completed";
    const resultStr = interrupted
      ? started.interruptionReason === "user_requested"
        ? "Command interrupted by user"
        : "Command interrupted because the task was stopped"
      : typeof result === "string"
        ? result
        : safeStringify(result);

    this.activeToolExecutions.delete(toolCallId);
    this.activeToolCalls.delete(toolCallId);
    this.bus.emit(
      ev.toolCallEnd(ctx, toolCallId, {
        status,
        durationMs,
        reason: started.interruptionReason,
      }),
    );
    this.bus.emit(
      ev.toolCallResult(ctx, toolCallId, resultStr, interrupted || isError, `tool-result:${toolCallId}`),
    );
    started.complete();
    this.emitStateUpdate();

    const usage = domainResourceUsageOnSuccess(
      started.toolName,
      started.args,
      interrupted || isError,
      result,
    );
    if (usage) this.bus.emit(ev.custom(ctx, CUSTOM_EVENT.DOMAIN_RESOURCE_USAGE, usage));
    if (isError && !interrupted && emitFailureWarning) {
      this.bus.emit(
        ev.systemMessage(this.sessionId, "warning", `❌ ${toolName} 执行失败`, {
          agent: this.name,
          details: resultStr,
          recoverable: true,
        }),
      );
    }
  }

  private finishDanglingTools(reason?: "task_interrupted" | "agent_interrupted"): void {
    const ctx = { sessionId: this.sessionId, agentName: this.name, runId: this.currentRunId };
    for (const [toolCallId, tool] of [...this.activeToolCalls]) {
      if (reason) tool.interruptionReason ??= reason;
      // Reconciliation is intentionally quiet: the run has already ended and
      // this synthetic terminal exists to prevent a stale card from reviving.
      this.finishTool(ctx, toolCallId, tool.toolName, "Tool ended without a terminal event", true, false);
    }
  }

  /**
   * Send a prompt and stream events. Error-isolated (§7 L2): never throws.
   * The settled promise is tracked in `currentPrompt` so `abort()` can await it.
   */
  prompt(text: string): Promise<void> {
    const p = this.runPrompt(text).finally(() => {
      // Clear the tracker only if no newer prompt has replaced it.
      if (this.currentPrompt === p) this.currentPrompt = undefined;
    });
    this.currentPrompt = p;
    return p;
  }

  /** True while a run is streaming — a plain prompt() would be rejected. */
  get isStreaming(): boolean {
    return this.session.isStreaming;
  }

  /**
   * Queue a user message onto the *in-flight* run instead of starting a new one
   * (#: concurrent send). The SDK's agent loop drains follow-ups before it emits
   * agent_end, so the message is handled after the current turn without a fresh
   * RUN_STARTED/runId — the events keep flowing under the current run. Unlike
   * `prompt()`, this does NOT open a new run lifecycle. Error-isolated: a queue
   * failure is surfaced as a run error, never thrown to the caller.
   *
   * Falls back to a normal `prompt()` if the run has already drained (not
   * streaming anymore) by the time this lands, so a race can't drop the message.
   */
  followUp(text: string): Promise<void> {
    if (!this.session.isStreaming) {
      // Race: the run finished between the caller's check and here — just start
      // a normal run so the message isn't lost.
      return this.prompt(text);
    }
    return this.session.prompt(text, { streamingBehavior: "followUp" }).catch((err) => {
      const raw = (err as Error)?.message ?? String(err);
      const { message, details } = normalizeAgentError(raw);
      this.recordError(message, details, raw);
      this.bus.emit(
        ev.runError({ sessionId: this.sessionId, agentName: this.name, runId: this.currentRunId }, message),
      );
      this.setStatus("error");
    });
  }

  private async runPrompt(text: string): Promise<void> {
    this.currentRunId = newRunId();
    this.runStartedAt = Date.now();
    this.abortRequested = false;
    this.currentRetry = undefined;
    this.pendingProviderError = undefined;
    // Snapshot cumulative stats BEFORE any events flow so the eventual delta
    // (`cumulative_after - snapshot`) captures exactly this run's contribution.
    this.runStartSnapshot = cloneAgentStats(this.cumulativeStats);
    this.setStatus("running");
    this.bus.emit(ev.runStarted({ sessionId: this.sessionId, agentName: this.name, runId: this.currentRunId }));
    let runOutcome: RunStatsStatus = "ok";
    try {
      await this.session.prompt(text);
      this.finishDanglingTools(this.abortRequested ? "task_interrupted" : undefined);
      if (this.abortRequested) {
        // Pi reports an interrupted retry sleep as auto_retry_end(false,
        // "Retry cancelled"). An explicit Stop is a lifecycle outcome, not a
        // provider failure: discard the held attempt error and keep the agent
        // out of the error/escalation path.
        this.currentRetry = undefined;
        this.pendingProviderError = undefined;
        runOutcome = "aborted";
      } else if (this.pendingProviderError) {
        const raw = this.pendingProviderError;
        this.pendingProviderError = undefined;
        const { message, details } = normalizeAgentError(raw);
        this.recordError(message, details, raw);
        this.setStatus("error");
      }
      this.bus.emit(
        ev.runFinished({ sessionId: this.sessionId, agentName: this.name, runId: this.currentRunId }),
      );
      // A run that reached here without an exhausted provider error completed
      // cleanly (or was intentionally aborted) — clear the error class so the
      // delivery loop cannot mistake cancellation for a retryable failure.
      if (this._status !== "error") {
        this._lastErrorKind = undefined;
        this.setStatus("idle");
      } else {
        // Stream-error path (message_end stopReason="error", etc.): the run
        // did reach RUN_FINISHED via the happy path above, but status flipped
        // to "error" mid-stream. Classify as "error" for the RunStats entry.
        runOutcome = "error";
      }
    } catch (err) {
      this.finishDanglingTools(this.abortRequested ? "task_interrupted" : undefined);
      this.currentRetry = undefined;
      this.pendingProviderError = undefined;
      if (this.abortRequested) {
        // Some session implementations reject prompt() on abort rather than
        // resolving it. Normalize both forms to the same non-error lifecycle.
        this.bus.emit(
          ev.runFinished({ sessionId: this.sessionId, agentName: this.name, runId: this.currentRunId }),
        );
        this._lastErrorKind = undefined;
        this.setStatus("idle");
        runOutcome = "aborted";
      } else {
        const raw = (err as Error)?.message ?? String(err);
        // issue #45: never surface raw SDK guidance (/login, node_modules paths)
        // — normalize to a product message / redact local paths before it hits
        // the event stream, events.jsonl, and lastError.
        const { message, details } = normalizeAgentError(raw);
        this.recordError(message, details, raw);
        this.bus.emit(
          ev.runError({ sessionId: this.sessionId, agentName: this.name, runId: this.currentRunId }, message),
        );
        this.setStatus("error");
        runOutcome = "error";
      }
    } finally {
      // Emit the per-run stats delta before clearing run-scoped state so
      // consumers see a stable `runId`. Aborted-mid-run is caught by
      // `abort()`'s own cleanup path (see abort()); if we reach here with a
      // clean or error path, either way we have a well-formed snapshot.
      this.emitRunStats(runOutcome);
      this.currentRunId = undefined;
      this.currentMessageId = undefined;
      this.runStartSnapshot = undefined;
      this.runStartedAt = undefined;
    }
  }

  /**
   * Fire the `onRunStats` callback with the run's delta. Called from
   * `runPrompt`'s finally block for ok/error/aborted paths. Idempotent: if no
   * snapshot exists (e.g. abort called with no run in flight), this is a no-op.
   */
  private emitRunStats(status: RunStatsStatus): void {
    if (!this.runStartSnapshot || !this.currentRunId || this.runStartedAt === undefined) return;
    const cumulative = cloneAgentStats(this.cumulativeStats);
    const delta = subtractAgentStats(this.cumulativeStats, this.runStartSnapshot);
    this.opts.onRunStats?.({
      name: this.name,
      runId: this.currentRunId,
      startedAt: this.runStartedAt,
      finishedAt: Date.now(),
      status,
      delta,
      cumulative,
    });
  }

  /**
   * Abort the active run and wait for it to fully settle (#101).
   *
   * `session.abort()` cancels the provider stream (and for the real Pi session
   * already awaits the agent back to idle). We then await the in-flight
   * `prompt()` promise so that by the time abort() resolves: the original run
   * has emitted its terminal RUN_FINISHED/RUN_ERROR, `status` has settled, and
   * no further assistant content can be appended. Whole-session interrupt waits
   * on this settlement before emitting its deterministic system ack (#327) —
   * it must not start a follow-up provider run while the old run is still open.
   */
  async abort(): Promise<void> {
    // Snapshot the run identity before session.abort() causes runPrompt's
    // finally-block to clear `currentRunId` — we need to know whether *this*
    // call actually interrupted a live run so we can stamp the RunStats with
    // "aborted". If runPrompt's finally already fired (race), it will have
    // emitted with status "ok"/"error"; we don't double-emit here.
    const wasLiveRun = Boolean(this.currentRunId);
    if (wasLiveRun) this.abortRequested = true;
    for (const tool of this.activeToolCalls.values()) {
      tool.status = "stopping";
      tool.interruptionReason ??= "task_interrupted";
    }
    if (this.activeToolCalls.size > 0) this.emitStateUpdate();
    try {
      await this.session.abort();
    } catch {
      /* abort best-effort */
    }
    // Wait for the interrupted prompt to unwind its try/finally (RUN_FINISHED,
    // status settle) before returning — do NOT optimistically force idle here.
    try {
      await this.currentPrompt;
    } catch {
      /* prompt() is error-isolated; nothing to surface */
    }
    this.finishDanglingTools("task_interrupted");
    // Keep abortRequested true until prompt() has fully unwound so both Pi's
    // resolving and rejecting abort paths are recorded as "aborted". A future
    // prompt resets it synchronously at run start.
    this.abortRequested = false;
  }

  stop(): void {
    this.unsubscribe();
    this.session.dispose();
    this.finishDanglingTools("agent_interrupted");
    this.setStatus("stopped");
  }

  /** Emit a compaction-related system_message with the agent tag pre-filled. */
  private emitCompactionSystemMessage(level: "info" | "warning", message: string, details?: string): void {
    this.bus.emit(
      ev.systemMessage(this.sessionId, level, message, { agent: this.name, details, recoverable: true }),
    );
  }

  private recordError(message: string, details?: string, raw?: string): void {
    const prev = this.lastError?.consecutiveCount ?? 0;
    this.lastError = { message, timestamp: new Date().toISOString(), consecutiveCount: prev + 1 };
    // #97: classify from the rawest signal we have (raw provider blob when the
    // caller has it, else the normalized headline) so the delivery loop can pick
    // self-retry vs escalation.
    this._lastErrorKind = classifyAgentError(raw ?? message);
    this.bus.emit(
      ev.systemMessage(this.sessionId, "error", `⚠️ Agent ${this.name} 遇到错误: ${message}`, {
        agent: this.name,
        details,
        recoverable: true,
      }),
    );
  }

  /** Translate one Pi event into zero or more AG-UI events (§6). */
  private onPiEvent(e: PiAgentEvent): void {
    const ctx = { sessionId: this.sessionId, agentName: this.name, runId: this.currentRunId };
    switch (e.type) {
      case "agent_start":
      case "agent_end":
      case "turn_start":
      case "turn_end":
      case "queue_update":
        // Internal / suppressed (§6 table: turn_*, queue_update not exposed).
        // Behavioural reactions to turn_*/agent_end now live in the Pi-native
        // trace-reminder extension, not here.
        return;

      // Pi auto-compacts when context nears the model window (threshold) or an
      // overflow error came back. Surface both edges on the AG-UI CUSTOM channel
      // (structured, name:"compaction") plus a `system_message` so text-only UIs
      // see them too.
      case "compaction_start": {
        const cs = e as Extract<PiAgentEvent, { type: "compaction_start" }>;
        const reason = normalizeCompactionReason(cs.reason);
        this.bus.emit(ev.compactionStart(ctx, reason));
        this.emitCompactionSystemMessage(
          "info",
          `🗜️ Agent ${this.name} 正在压缩上下文 (${COMPACTION_REASON_LABEL[reason]})…`,
        );
        return;
      }

      case "compaction_end": {
        const ce = e as Extract<PiAgentEvent, { type: "compaction_end" }>;
        const reason = normalizeCompactionReason(ce.reason);
        const { aborted, willRetry, errorMessage } = ce;
        const r = ce.result as
          | { tokensBefore?: number; estimatedTokensAfter?: number; firstKeptEntryId?: string }
          | undefined;
        this.bus.emit(
          ev.compactionEnd(ctx, {
            reason,
            aborted: Boolean(aborted),
            willRetry: Boolean(willRetry),
            errorMessage,
            tokensBefore: r?.tokensBefore,
            estimatedTokensAfter: r?.estimatedTokensAfter,
            firstKeptEntryId: r?.firstKeptEntryId,
          }),
        );
        const label = COMPACTION_REASON_LABEL[reason];
        if (errorMessage) {
          this.emitCompactionSystemMessage("warning", `⚠️ Agent ${this.name} 上下文压缩失败 (${label})`, errorMessage);
        } else if (aborted) {
          this.emitCompactionSystemMessage("info", `🛑 Agent ${this.name} 上下文压缩已中止`);
        } else {
          const delta =
            r?.tokensBefore !== undefined && r?.estimatedTokensAfter !== undefined
              ? `：${r.tokensBefore.toLocaleString()} → ~${r.estimatedTokensAfter.toLocaleString()} tokens`
              : "";
          this.emitCompactionSystemMessage("info", `✅ Agent ${this.name} 上下文压缩完成 (${label})${delta}`);
        }
        return;
      }

      case "message_start": {
        const msg = e as Extract<PiAgentEvent, { type: "message_start" }>;
        if (msg.message?.role === "assistant") {
          this.currentMessageId = newMessageId();
          this.inReasoning = false;
          this.bus.emit(ev.textMessageStart(ctx, this.currentMessageId));
        }
        return;
      }

      case "message_update": {
        const upd = e as Extract<PiAgentEvent, { type: "message_update" }>;
        this.onAssistantDelta(ctx, upd.assistantMessageEvent);
        return;
      }

      case "message_end": {
        const end = e as Extract<PiAgentEvent, { type: "message_end" }>;
        // #63: a provider/HTTP error does NOT throw out of session.prompt(); Pi
        // finalizes the assistant message with stopReason "error" + errorMessage
        // and emits it here. Surface it as a visible error instead of letting the
        // run end with an empty assistant bubble.
        const msg = end.message as
          | { role?: string; stopReason?: string; errorMessage?: string; usage?: PiUsage }
          | undefined;
        if (msg?.stopReason === "error") {
          // #365: Pi decides whether to retry only after message_end. Hold the
          // error until session.prompt settles so transient attempts do not
          // produce red bubbles or briefly flip the agent out of "running".
          this.pendingProviderError = msg.errorMessage || "provider request failed";
        } else if (msg?.role === "assistant") {
          // A successful retry supersedes every earlier failed attempt.
          this.pendingProviderError = undefined;
        }
        // Accumulate real provider token usage for this assistant turn. Pi
        // attaches `usage` to the finalized assistant message; user/tool
        // messages and mock feeds may omit it (addUsage no-ops on undefined).
        if (msg?.role === "assistant" && msg.usage) {
          const delta = addUsage(emptyTokenUsage(), msg.usage);
          addUsage(this.cumulativeUsage, msg.usage);
          // Mirror the same delta into cumulativeStats.tokens so per-run
          // deltas cover tokens too. Kept in sync with cumulativeUsage —
          // both fold `msg.usage` on the same event.
          addUsage(this.cumulativeStats.tokens, msg.usage);
          this.opts.onUsage?.(this.name, delta, { ...this.cumulativeUsage });
        }
        if (this.currentMessageId) {
          if (this.inReasoning) {
            this.bus.emit(ev.reasoningMessageEnd(ctx, this.currentMessageId));
            this.inReasoning = false;
          }
          this.bus.emit(ev.textMessageEnd(ctx, this.currentMessageId));
          this.currentMessageId = undefined;
        }
        return;
      }

      case "tool_execution_start": {
        const t = e as Extract<PiAgentEvent, { type: "tool_execution_start" }>;
        this.activeToolExecutions.add(t.toolCallId);
        const args =
          typeof t.args === "object" && t.args !== null && !Array.isArray(t.args)
            ? (t.args as Record<string, unknown>)
            : {};
        let complete!: () => void;
        const completion = new Promise<void>((resolve) => (complete = resolve));
        this.activeToolCalls.set(t.toolCallId, {
          toolName: t.toolName,
          args,
          startedAt: Date.now(),
          status: "running",
          cancellable: t.toolName === "bash" && typeof this.session.interruptTool === "function",
          completion,
          complete,
        });
        // Usage-stats: count *invocation attempts* on start. If Pi ever calls
        // start-without-end (hard abort mid-prep), the invocation still counts —
        // matches "attempted N times" semantics on the wire.
        this.cumulativeStats.tools[t.toolName] = (this.cumulativeStats.tools[t.toolName] ?? 0) + 1;
        if (t.toolName === "skill_search") {
          recordSkillCall(this.cumulativeStats.skills, t.args);
        }
        this.bus.emit(ev.toolCallStart(ctx, t.toolCallId, t.toolName, this.currentMessageId));
        const argsStr = safeStringify(t.args);
        if (argsStr) this.bus.emit(ev.toolCallArgs(ctx, t.toolCallId, argsStr));
        const usage = domainResourceUsageOnStart(t.toolName, args);
        if (usage) {
          this.bus.emit(ev.custom(ctx, CUSTOM_EVENT.DOMAIN_RESOURCE_USAGE, usage));
        }
        this.emitStateUpdate();
        return;
      }

      case "tool_execution_end": {
        const t = e as Extract<PiAgentEvent, { type: "tool_execution_end" }>;
        const started = this.activeToolCalls.get(t.toolCallId);
        // Usage-stats: `errors` is additive to `tools`, never subtracted.
        if (t.isError) {
          this.cumulativeStats.errors[t.toolName] =
            (this.cumulativeStats.errors[t.toolName] ?? 0) + 1;
        }
        if (started) this.finishTool(ctx, t.toolCallId, t.toolName, t.result, t.isError);
        return;
      }

      case "auto_retry_start": {
        // #365: publish retry progress as live agent state. The web reuses the
        // existing "principal is working" toast instead of appending a chat
        // bubble for every failed provider attempt.
        const r = e as Extract<PiAgentEvent, { type: "auto_retry_start" }>;
        this.currentRetry = {
          attempt: r.attempt,
          maxAttempts: r.maxAttempts,
          delayMs: r.delayMs,
        };
        this.emitStateUpdate();
        return;
      }

      case "auto_retry_end": {
        const r = e as Extract<PiAgentEvent, { type: "auto_retry_end" }>;
        this.currentRetry = undefined;
        if (!r.success && this.abortRequested) {
          // User Stop during backoff: discard both Pi's "Retry cancelled" and
          // the provider error held from the failed attempt. runPrompt records
          // an aborted lifecycle and settles the agent back to idle.
          this.pendingProviderError = undefined;
        } else if (!r.success) {
          this.pendingProviderError = r.finalError ?? this.pendingProviderError ?? "retry exhausted";
        }
        this.emitStateUpdate();
        return;
      }

      default:
        return; // unknown / future Pi events: ignore.
    }
  }

  private onAssistantDelta(
    ctx: { sessionId: string; agentName: string; runId?: string },
    amsg: PiAssistantMessageEvent,
  ): void {
    if (!this.currentMessageId) {
      this.currentMessageId = newMessageId();
      this.bus.emit(ev.textMessageStart(ctx, this.currentMessageId));
    }
    const id = this.currentMessageId;
    switch (amsg.type) {
      case "text_delta":
        this.bus.emit(ev.textMessageContent(ctx, id, String((amsg as { delta: string }).delta ?? "")));
        return;
      case "reasoning_start":
        this.inReasoning = true;
        this.bus.emit(ev.reasoningMessageStart(ctx, id));
        return;
      case "reasoning_delta":
        if (!this.inReasoning) {
          this.inReasoning = true;
          this.bus.emit(ev.reasoningMessageStart(ctx, id));
        }
        this.bus.emit(ev.reasoningMessageContent(ctx, id, String((amsg as { delta: string }).delta ?? "")));
        return;
      case "reasoning_end":
        this.bus.emit(ev.reasoningMessageEnd(ctx, id));
        this.inReasoning = false;
        return;
      case "error": {
        // #63/#365: provider failure streamed mid-message. Hold it until the
        // prompt settles for the same reason as message_end: Pi may retry it.
        // This also covers Pi builds that only emit the streaming sub-event.
        const err = amsg as { error?: unknown; reason?: string };
        const raw =
          (err.error as { errorMessage?: string } | undefined)?.errorMessage ??
          (typeof err.error === "string" ? err.error : undefined) ??
          err.reason ??
          "provider request failed";
        this.pendingProviderError = raw;
        return;
      }
      default:
        return;
    }
  }
}

type CompactionReason = "manual" | "threshold" | "overflow";
/** Coerce Pi's `reason` field to the wire enum. Defaults to "manual" on unknown. */
function normalizeCompactionReason(r: unknown): CompactionReason {
  return r === "threshold" || r === "overflow" ? r : "manual";
}
const COMPACTION_REASON_LABEL: Record<CompactionReason, string> = {
  manual: "手动",
  threshold: "接近上下文上限",
  overflow: "上下文溢出",
};

function safeStringify(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export type { AgUiEvent };
