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
import type { AgUiEvent, AgentState, TokenUsage } from "@brainpilot/protocol";
import type { EventBus } from "./event-bus.js";
import { ev, newMessageId, newRunId } from "./events.js";
import { normalizeAgentError, classifyAgentError, type AgentErrorKind } from "./agent-error.js";
import type {
  AgentRole,
  IAgentSession,
  PiAgentEvent,
  PiAssistantMessageEvent,
  PiUsage,
} from "./types.js";

export type AgentStatus = "idle" | "running" | "error" | "stopped";

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
}

export class MasAgent {
  readonly name: string;
  readonly role: AgentRole;
  private readonly sessionId: string;
  private readonly session: IAgentSession;
  private readonly bus: EventBus;
  private readonly unsubscribe: () => void;

  private _status: AgentStatus = "idle";
  private currentRunId: string | undefined;
  private currentMessageId: string | undefined;
  private inReasoning = false;
  private activeToolExecutions = new Set<string>();
  private lastError: AgentState["lastError"];
  /**
   * Cumulative real token usage for THIS agent across every assistant turn,
   * summed from provider-reported `usage` on `message_end`. Read by `usage()`;
   * fed to `onUsage` so the SessionManager can roll up the per-session total.
   */
  private cumulativeUsage: TokenUsage = emptyTokenUsage();
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

  /** §10 authoritative state snapshot. */
  state(): AgentState {
    const s: AgentState = { name: this.name, status: this._status };
    if (this.currentRunId) s.activeRunId = this.currentRunId;
    if (this.activeToolExecutions.size) s.activeToolExecutions = [...this.activeToolExecutions];
    if (this.lastError) s.lastError = this.lastError;
    return s;
  }

  private setStatus(status: AgentStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.opts.onStatusChange?.(this.name, status);
    this.bus.emit(
      ev.agentStatusUpdate({ sessionId: this.sessionId, runId: this.currentRunId }, this.name, status, {
        activeRunId: this.currentRunId,
        activeToolExecutions: [...this.activeToolExecutions],
        lastError: this.lastError,
      }),
    );
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
    this.setStatus("running");
    this.bus.emit(ev.runStarted({ sessionId: this.sessionId, agentName: this.name, runId: this.currentRunId }));
    try {
      await this.session.prompt(text);
      this.bus.emit(
        ev.runFinished({ sessionId: this.sessionId, agentName: this.name, runId: this.currentRunId }),
      );
      // A run that reached here without an in-stream error (message_end /
      // auto_retry_end / delta error all flip status to "error") completed
      // cleanly — clear the error class so the delivery loop's retry counter
      // resets on the next success.
      if (this._status !== "error") {
        this._lastErrorKind = undefined;
        this.setStatus("idle");
      }
    } catch (err) {
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
    } finally {
      this.currentRunId = undefined;
      this.currentMessageId = undefined;
    }
  }

  /**
   * Abort the active run and wait for it to fully settle (#101).
   *
   * `session.abort()` cancels the provider stream (and for the real Pi session
   * already awaits the agent back to idle). We then await the in-flight
   * `prompt()` promise so that by the time abort() resolves: the original run
   * has emitted its terminal RUN_FINISHED/RUN_ERROR, `status` has settled, and
   * no further assistant content can be appended. This lets `interrupt()` start
   * the principal's interrupt-notice run WITHOUT racing the old run (which would
   * otherwise throw "Agent is already processing a prompt").
   */
  async abort(): Promise<void> {
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
    this.activeToolExecutions.clear();
  }

  stop(): void {
    this.unsubscribe();
    this.session.dispose();
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
          const raw = msg.errorMessage || "provider request failed";
          const { message, details } = normalizeAgentError(raw);
          this.recordError(message, details, raw);
          this.setStatus("error");
        }
        // Accumulate real provider token usage for this assistant turn. Pi
        // attaches `usage` to the finalized assistant message; user/tool
        // messages and mock feeds may omit it (addUsage no-ops on undefined).
        if (msg?.role === "assistant" && msg.usage) {
          const delta = addUsage(emptyTokenUsage(), msg.usage);
          addUsage(this.cumulativeUsage, msg.usage);
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
        this.bus.emit(ev.toolCallStart(ctx, t.toolCallId, t.toolName, this.currentMessageId));
        const argsStr = safeStringify(t.args);
        if (argsStr) this.bus.emit(ev.toolCallArgs(ctx, t.toolCallId, argsStr));
        return;
      }

      case "tool_execution_end": {
        const t = e as Extract<PiAgentEvent, { type: "tool_execution_end" }>;
        this.activeToolExecutions.delete(t.toolCallId);
        this.bus.emit(ev.toolCallEnd(ctx, t.toolCallId));
        const resultStr = typeof t.result === "string" ? t.result : safeStringify(t.result);
        this.bus.emit(ev.toolCallResult(ctx, t.toolCallId, resultStr, t.isError));
        // §7 L1: surface tool errors as system_message.
        if (t.isError) {
          this.bus.emit(
            ev.systemMessage(this.sessionId, "warning", `❌ ${t.toolName} 执行失败`, {
              agent: this.name,
              details: resultStr,
              recoverable: true,
            }),
          );
        }
        return;
      }

      case "auto_retry_start": {
        const r = e as Extract<PiAgentEvent, { type: "auto_retry_start" }>;
        this.bus.emit(
          ev.systemMessage(
            this.sessionId,
            "warning",
            `⏳ Agent ${this.name} 遇到 API 错误，正在自动重试 (${r.attempt}/${r.maxAttempts})，${
              r.delayMs / 1000
            }秒后重试...`,
            { agent: this.name, recoverable: true },
          ),
        );
        return;
      }

      case "auto_retry_end": {
        const r = e as Extract<PiAgentEvent, { type: "auto_retry_end" }>;
        if (!r.success) {
          const raw = r.finalError ?? "retry exhausted";
          const { message, details } = normalizeAgentError(raw);
          this.recordError(message, details, raw);
          this.setStatus("error");
        }
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
        // #63: provider failure streamed mid-message. Route to a visible error
        // (the message_end handler also catches the finalized stopReason:"error",
        // but this covers Pi builds that only emit the streaming sub-event).
        const err = amsg as { error?: unknown; reason?: string };
        const raw =
          (err.error as { errorMessage?: string } | undefined)?.errorMessage ??
          (typeof err.error === "string" ? err.error : undefined) ??
          err.reason ??
          "provider request failed";
        const { message, details } = normalizeAgentError(raw);
        this.recordError(message, details, raw);
        this.setStatus("error");
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
