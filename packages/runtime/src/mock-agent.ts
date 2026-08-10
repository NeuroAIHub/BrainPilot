/**
 * Mock AgentSession (BP_MOCK=1). Deterministic, no API calls.
 *
 * Emits a scripted Pi event stream that exercises the SAME translator the real
 * Pi session feeds (agent_start → message_start → message_update(text_delta)*
 * → message_end → tool_execution_* (optional) → agent_end). This lets tests +
 * CI cover the full orchestration path without burning quota.
 *
 * Prompt control protocol (so tests can drive behavior):
 *   - default: streams a short scripted assistant reply.
 *   - contains "[[tool:NAME {json}]]": invokes system tool NAME with parsed
 *     args and emits tool_execution_start/end around it.
 *   - contains "[[error]]": emits an agent-level failure (auto_retry then end).
 */
import type { IAgentSession, PiAgentEvent, PromptOptions, SystemTool } from "./types.js";
import { PROVIDER_MAX_RETRIES } from "./pi-retry.js";

export interface MockSessionConfig {
  sessionId: string;
  agentName: string;
  systemTools: SystemTool[];
  /** Scripted assistant text (default: deterministic per agent). */
  scriptText?: string;
}

const TOOL_RE = /\[\[tool:([a-zA-Z_]+)\s*(\{.*?\})?\]\]/;

export class MockAgentSession implements IAgentSession {
  readonly sessionId: string;
  private readonly listeners = new Set<(e: PiAgentEvent) => void>();
  private readonly toolMap: Map<string, SystemTool>;
  private aborted = false;
  private disposed = false;
  private processing = false;

  constructor(private readonly cfg: MockSessionConfig) {
    this.sessionId = cfg.sessionId;
    this.toolMap = new Map(cfg.systemTools.map((t) => [t.name, t]));
  }

  get isStreaming(): boolean {
    return this.processing;
  }

  subscribe(listener: (e: PiAgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: PiAgentEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        /* isolate */
      }
    }
  }

  // The mock ignores streamingBehavior — it processes each prompt to completion
  // synchronously within the await, so there is no real streaming window to
  // queue against. The opts param keeps the IAgentSession contract.
  async prompt(text: string, _opts?: PromptOptions): Promise<void> {
    if (this.disposed) return;
    this.aborted = false;
    this.processing = true;
    try {
      await this.runPrompt(text);
    } finally {
      this.processing = false;
    }
  }

  private async runPrompt(text: string): Promise<void> {
    this.emit({ type: "agent_start" });
    this.emit({ type: "turn_start" });

    if (text.includes("[[error]]")) {
      this.emit({
        type: "auto_retry_start",
        attempt: 1,
        maxAttempts: PROVIDER_MAX_RETRIES,
        delayMs: 0,
        errorMessage: "mock API error",
      });
      this.emit({ type: "auto_retry_end", success: false, attempt: 1, finalError: "mock API error" });
      this.emit({ type: "agent_end", messages: [], willRetry: false });
      return;
    }

    // Stream a short assistant message.
    const msg = { role: "assistant", content: [] as Array<{ type: string; text?: string }> };
    this.emit({ type: "message_start", message: { ...msg } });
    const script = this.cfg.scriptText ?? `mock reply from ${this.cfg.agentName}`;
    for (const chunk of script.match(/.{1,8}/g) ?? [script]) {
      if (this.aborted) break;
      this.emit({
        type: "message_update",
        message: { ...msg },
        assistantMessageEvent: { type: "text_delta", delta: chunk },
      });
    }
    this.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: script }],
        // Deterministic token usage so token-stats tests can assert exact
        // numbers without a real provider. Derived from the reply length.
        usage: {
          input: 10,
          output: Math.max(1, Math.ceil(script.length / 4)),
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 10 + Math.max(1, Math.ceil(script.length / 4)),
        },
      },
    });

    // Optional tool invocation driven by the prompt.
    const m = TOOL_RE.exec(text);
    if (m && !this.aborted) {
      const toolName = m[1]!;
      const args = m[2] ? safeJson(m[2]) : {};
      const tool = this.toolMap.get(toolName);
      const toolCallId = `tc_${toolName}_${Date.now()}`;
      this.emit({ type: "tool_execution_start", toolCallId, toolName, args });
      if (tool) {
        try {
          const res = await tool.execute(args);
          const textOut = res.content.map((c) => c.text).join("");
          this.emit({
            type: "tool_execution_end",
            toolCallId,
            toolName,
            result: textOut,
            isError: res.isError ?? false,
          });
        } catch (err) {
          this.emit({
            type: "tool_execution_end",
            toolCallId,
            toolName,
            result: String((err as Error).message),
            isError: true,
          });
        }
      } else {
        // Tool not available to this agent (access-controlled away).
        this.emit({
          type: "tool_execution_end",
          toolCallId,
          toolName,
          result: `tool ${toolName} not available`,
          isError: true,
        });
      }
    }

    // Leaf sessions have one mandatory delivery channel. Auto-submit in mock
    // mode so lifecycle tests do not depend on model tool-selection behavior.
    if (!m && !this.aborted) {
      const submit = this.toolMap.get("submit_result");
      if (submit) {
        await submit.execute({
          outcome: "completed",
          summary: script,
          findings: [`mock result from ${this.cfg.agentName}`],
          artifacts: [],
          caveats: [],
          inspected_paths: [],
          commands_run: [],
        });
      }
    }

    this.emit({ type: "turn_end" });
    this.emit({ type: "agent_end", messages: [], willRetry: false });
  }

  async abort(): Promise<void> {
    this.aborted = true;
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}
