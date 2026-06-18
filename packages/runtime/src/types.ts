/**
 * @brainpilot/runtime — internal types.
 *
 * Domain/event/HTTP types come from `@brainpilot/protocol`. This file holds
 * only runtime-internal shapes (the Pi-SDK-facing agent abstraction, config,
 * dependency bundles) that are NOT part of the wire contract.
 */
import type { AgUiEvent, AgentState, TraceGraph } from "@brainpilot/protocol";

/** Agent role — drives tool access control (§9) and hook behavior (§8). */
export type AgentRole = "principal" | "expert" | "trace";

/**
 * Minimal surface of a Pi SDK `AgentSession` that the runtime depends on.
 * The real implementation wraps `@earendil-works/pi-coding-agent`'s
 * `AgentSession`; the mock implementation (BP_MOCK=1) emits a scripted event
 * stream. Both speak the SAME Pi event vocabulary so the translator (§6) is
 * exercised identically in tests and production.
 */
export interface IAgentSession {
  readonly sessionId: string;
  /** Subscribe to Pi events. Returns an unsubscribe fn. */
  subscribe(listener: (event: PiAgentEvent) => void): () => void;
  /** Send a prompt. Resolves when the run completes (or is aborted). */
  prompt(text: string): Promise<void>;
  /** Hard-abort the active run. */
  abort(): Promise<void>;
  /** Tear down; release resources. */
  dispose(): void;
}

/**
 * The subset of Pi `AgentSessionEvent` the runtime consumes. Field names match
 * the real SDK verbatim (confirmed against the installed v0.79 dist +
 * docs/json.md). Unhandled Pi event types are passed through structurally.
 */
export type PiAgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: unknown[]; willRetry?: boolean }
  | { type: "turn_start" }
  | { type: "turn_end"; message?: unknown; toolResults?: unknown[] }
  | { type: "message_start"; message: PiMessage }
  | {
      type: "message_update";
      message: PiMessage;
      assistantMessageEvent: PiAssistantMessageEvent;
    }
  | { type: "message_end"; message: PiMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args: unknown;
      partialResult: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    }
  | { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
  | { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
  // Internal / suppressed (compaction, queue, etc.) — kept loose.
  | { type: string; [k: string]: unknown };

/** Pi assistant streaming sub-event (carried by `message_update`). */
export type PiAssistantMessageEvent =
  | { type: "text_delta"; delta: string }
  | { type: "text_start" }
  | { type: "text_end" }
  | { type: "reasoning_delta"; delta: string }
  | { type: "reasoning_start" }
  | { type: "reasoning_end" }
  // #63: provider/HTTP failure surfaced mid-stream (e.g. a protocol mismatch
  // 404). Pi emits this instead of throwing, so the runtime must route it to an
  // error event rather than dropping it (which produced an empty reply).
  | { type: "error"; error?: unknown; reason?: string }
  | { type: string; [k: string]: unknown };

/** Pi message (assistant/user/tool). We read `role` + `content` blocks. */
export interface PiMessage {
  role: string;
  content?: PiContentBlock[];
  [k: string]: unknown;
}

export interface PiContentBlock {
  type: string;
  text?: string;
  [k: string]: unknown;
}

/**
 * Factory that produces an `IAgentSession` for a given agent. Injected into
 * the SessionManager so BP_MOCK=1 can swap the whole Pi layer for a mock.
 */
export type AgentSessionFactory = (params: {
  sessionId: string;
  agentName: string;
  role: AgentRole;
  /** Filesystem path for this agent's Pi history jsonl (§5). */
  historyPath: string;
  /** Agent cwd (the session workspace). */
  cwd: string;
  /** BrainPilot system tools (already access-filtered for this agent). */
  systemTools: SystemTool[];
  /** Tool names this agent may use (for Pi built-in allowlist). */
  allowedToolNames: string[];
  /** System prompt for the agent. */
  systemPrompt: string;
  /**
   * App-controlled skill directories loaded for this agent (template dir shared
   * by all sessions + this session's own dir). Replaces the host-global skill
   * discovery — see agent-factory `noSkills: true`.
   */
  skillPaths: string[];
  /**
   * Per-session LLM provider resolved from providers.json. When omitted, the
   * factory falls back to Pi's env-based default (Docker/static compat).
   */
  providerConfig?: {
    providerId: string;
    baseUrl?: string;
    /** #63: wire protocol (Pi models.json api). Defaults to anthropic-messages. */
    api?: string;
    /** #68: coarse adapter family (auto/openai/anthropic); derives api when api unset. */
    adapter?: string;
    apiKey: string;
    modelId?: string;
  };
}) => Promise<IAgentSession>;

/**
 * A BrainPilot system tool definition (pre-`defineTool`). The real factory
 * passes these to Pi's `defineTool`; the mock can invoke `execute` directly.
 */
export interface SystemTool {
  name: string;
  description: string;
  /** JSON-schema parameter object (Pi `defineTool` accepts plain JSON schema). */
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<SystemToolResult>;
}

export interface SystemToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/** Listener for outgoing AG-UI events, scoped to a session. */
export type EventListener = (event: AgUiEvent) => void;

/** Re-exports for convenience. */
export type { AgUiEvent, AgentState, TraceGraph };
