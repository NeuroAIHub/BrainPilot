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
 *  - Event-driven hooks (§8): track reply/trace/delegate per turn.
 */
import type { AgUiEvent, AgentState } from "@brainpilot/protocol";
import type { EventBus } from "./event-bus.js";
import { ev, newMessageId, newRunId } from "./events.js";
import { normalizeAgentError } from "./agent-error.js";
import type {
  AgentRole,
  IAgentSession,
  PiAgentEvent,
  PiAssistantMessageEvent,
} from "./types.js";

export type AgentStatus = "idle" | "running" | "error" | "stopped";

export interface MasAgentOpts {
  sessionId: string;
  name: string;
  role: AgentRole;
  session: IAgentSession;
  bus: EventBus;
  onStatusChange?: (name: string, status: AgentStatus) => void;
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

  // §8 hook trackers (reset each turn).
  private trackers = { replied: false, traced: false, delegated: false };

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
   */
  async prompt(text: string): Promise<void> {
    this.currentRunId = newRunId();
    this.resetTrackers();
    this.setStatus("running");
    this.bus.emit(ev.runStarted({ sessionId: this.sessionId, agentName: this.name, runId: this.currentRunId }));
    try {
      await this.session.prompt(text);
      this.bus.emit(
        ev.runFinished({ sessionId: this.sessionId, agentName: this.name, runId: this.currentRunId }),
      );
      if (this._status !== "error") this.setStatus("idle");
    } catch (err) {
      const raw = (err as Error)?.message ?? String(err);
      // issue #45: never surface raw SDK guidance (/login, node_modules paths)
      // — normalize to a product message / redact local paths before it hits
      // the event stream, events.jsonl, and lastError.
      const message = normalizeAgentError(raw);
      this.recordError(message);
      this.bus.emit(
        ev.runError({ sessionId: this.sessionId, agentName: this.name, runId: this.currentRunId }, message),
      );
      this.setStatus("error");
    } finally {
      this.currentRunId = undefined;
      this.currentMessageId = undefined;
    }
  }

  async abort(): Promise<void> {
    try {
      await this.session.abort();
    } catch {
      /* abort best-effort */
    }
    this.activeToolExecutions.clear();
    this.setStatus("idle");
  }

  stop(): void {
    this.unsubscribe();
    this.session.dispose();
    this.setStatus("stopped");
  }

  private recordError(message: string, details?: string): void {
    const prev = this.lastError?.consecutiveCount ?? 0;
    this.lastError = { message, timestamp: new Date().toISOString(), consecutiveCount: prev + 1 };
    this.bus.emit(
      ev.systemMessage(this.sessionId, "error", `⚠️ Agent ${this.name} 遇到错误: ${message}`, {
        agent: this.name,
        details,
        recoverable: true,
      }),
    );
  }

  private resetTrackers(): void {
    this.trackers = { replied: false, traced: false, delegated: false };
  }

  /** Translate one Pi event into zero or more AG-UI events (§6). */
  private onPiEvent(e: PiAgentEvent): void {
    const ctx = { sessionId: this.sessionId, agentName: this.name, runId: this.currentRunId };
    switch (e.type) {
      case "agent_start":
      case "turn_end":
      case "agent_end":
      case "compaction_start":
      case "compaction_end":
      case "queue_update":
        // Internal / suppressed (§6 table: turn_*, compaction_* not exposed).
        return;

      case "turn_start":
        this.resetTrackers();
        return;

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
        // §8 hooks: mark replied/traced/delegated from tool results.
        this.onToolResult(t.toolName, t.isError);
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
          this.recordError(r.finalError ?? "retry exhausted");
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
      default:
        return;
    }
  }

  private onToolResult(toolName: string, isError: boolean): void {
    if (isError) return;
    if (toolName === "send_message") this.trackers.replied = true;
    if (toolName === "record_trace" || toolName.startsWith("create_trace")) this.trackers.traced = true;
    if (toolName === "create_agent") this.trackers.delegated = true;
  }

  /** Expose tracker state (for hook tests). */
  getTrackers(): { replied: boolean; traced: boolean; delegated: boolean } {
    return { ...this.trackers };
  }
}

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
