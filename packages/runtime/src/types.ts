/**
 * @brainpilot/runtime — internal types.
 *
 * Domain/event/HTTP types come from `@brainpilot/protocol`. This file holds
 * only runtime-internal shapes (the Pi-SDK-facing agent abstraction, config,
 * dependency bundles) that are NOT part of the wire contract.
 */
import type { AgUiEvent, AgentState, ThinkingLevel, TraceGraph } from "@brainpilot/protocol";

/** Agent role — drives tool access control (§9) and hook behavior (§8). */
export type AgentRole = "principal" | "expert" | "trace";

/**
 * Minimal surface of a Pi SDK `AgentSession` that the runtime depends on.
 * The real implementation wraps `@earendil-works/pi-coding-agent`'s
 * `AgentSession`; the mock implementation (BP_MOCK=1) emits a scripted event
 * stream. Both speak the SAME Pi event vocabulary so the translator (§6) is
 * exercised identically in tests and production.
 */
/** How a prompt sent while the agent is already streaming should be queued. */
export type StreamingBehavior = "steer" | "followUp";

export interface PromptOptions {
  /**
   * When the agent is already streaming, the underlying SDK refuses a plain
   * prompt and requires a queueing mode: "steer" interrupts the current turn,
   * "followUp" waits for it to finish then continues. Ignored when idle.
   */
  streamingBehavior?: StreamingBehavior;
}

export interface IAgentSession {
  readonly sessionId: string;
  /**
   * True while a run is in flight (the SDK is streaming). A plain `prompt()`
   * during this window throws in the real SDK; callers must pass
   * `streamingBehavior` to queue the message instead.
   */
  readonly isStreaming: boolean;
  /** Subscribe to Pi events. Returns an unsubscribe fn. */
  subscribe(listener: (event: PiAgentEvent) => void): () => void;
  /** Send a prompt. Resolves when the run completes (or is aborted). */
  prompt(text: string, opts?: PromptOptions): Promise<void>;
  /** Update the shared Pi reasoning effort for future turns. */
  setThinkingLevel(level: ThinkingLevel): void;
  /**
   * Hard-abort the active run. For the real Pi session this aborts the provider
   * stream AND awaits the agent returning to idle (SDK `AgentSession.abort()`
   * is itself `abort() + waitForIdle()`); the mock/test sessions signal their
   * loop to stop. Callers that must fence the old stream before starting a new
   * run should await this (see `MasAgent.abort`, #101).
   */
  abort(): Promise<void>;
  /** Drop SDK steering/follow-up messages that must not survive Stop. */
  clearQueue?(): unknown;
  /** Cancel one locally-running tool without aborting the enclosing agent turn. */
  interruptTool?(toolCallId: string): boolean;
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
  // Pi SDK context compaction (auto/manual). Surfaced onto the AG-UI CUSTOM
  // channel (`name:"compaction"`) so clients can render the compaction event
  // rather than silently seeing the history collapse. `result` mirrors Pi's
  // `CompactionResult`; loose here because Pi may extend the shape.
  | { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
  | {
      type: "compaction_end";
      reason: "manual" | "threshold" | "overflow";
      aborted?: boolean;
      willRetry?: boolean;
      errorMessage?: string;
      result?: {
        summary?: string;
        firstKeptEntryId?: string;
        tokensBefore?: number;
        estimatedTokensAfter?: number;
        [k: string]: unknown;
      };
    }
  // Internal / suppressed (queue, etc.) — kept loose.
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
  /**
   * Provider-reported token usage, present on finalized assistant messages
   * (Pi's `AssistantMessage.usage`). The runtime reads this on `message_end`
   * to accumulate real per-session/per-agent token stats. Optional + loose
   * because user/tool messages and mock feeds may omit it.
   */
  usage?: PiUsage;
  [k: string]: unknown;
}

/** Pi/provider token usage counters (mirrors `@earendil-works/pi-ai` Usage). */
export interface PiUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
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
  /** Session-wide reasoning effort shared by every agent. */
  thinkingLevel: ThinkingLevel;
  /** Leaf sessions use submit_result and must not receive persistent-expert coordination hooks. */
  suppressCoordinationHooks?: boolean;
  /**
   * Explicit skill directories to load through Pi's native skill pipeline
   * (`additionalSkillPaths`). Host-global auto-discovery stays disabled
   * (`noSkills: true`); these dirs are loaded on top of that. Typically a single
   * entry: `<dataRoot>/bp_template/skills`. Omitted by the mock factory.
   */
  skillPaths?: string[];
  /** Enabled plugin runtime projections loaded for a new principal session. */
  compatPluginProjections?: Array<{
    schemaVersion: 1;
    id: string;
    version: string;
    format: "brainpilot" | "pi-package" | "codex" | "claude-code";
    root: string;
    dataDir: string;
    mcpConfigPath?: string;
    hookConfig?: { dialect: "codex" | "claude-code"; path: string };
    extensionPaths?: string[];
  }>;
  /**
   * #309: when true, register the router-skill-guard extension so generic file
   * tools cannot read `<dataRoot>/bp_template/skills-router`. Set when
   * `skill_search` is disabled. Requires `routerSkillsDir`.
   */
  blockRouterSkills?: boolean;
  /**
   * Absolute path to the router skill library. Required when
   * `blockRouterSkills` is true; ignored otherwise.
   */
  routerSkillsDir?: string;
  /**
   * #346: durable roots for logical path rewrite (`/workspace`, `/data`, …).
   * When set, the real factory registers managed-path-guard so Pi write/edit/
   * bash map logical prefixes onto the volume instead of the ephemeral
   * container FS. `cwd` is the session workspace (same as `params.cwd`).
   * Omitted by the mock factory.
   */
  managedPathRoots?: {
    cwd: string;
    persistentDir: string;
    sharedDir?: string;
  };
  /**
   * 意图二 fallback (Pi-native hooks): invoked by the trace-reminder extension
   * when an expert was reminded once and STILL did not report back, so the host
   * can notify each pending task's creator, so no sender dead-waits.
   */
  onUnreplied?: (agentName: string) => void | Promise<void>;
  hasPendingTasks?: () => boolean;
  claimTaskReminder?: (agentName: string) => Promise<boolean>;
  /**
   * #97: compute a fresh "team status" block to inject at the top of every turn
   * (via the agent-status extension's Pi `context` hook). Called once per turn;
   * returns "" when there is nothing to inject. Supplied only for the principal
   * (the coordinator that benefits from the whole-team view); omitted for other
   * roles and by the mock factory.
   */
  renderAgentStatus?: () => string;
  /** Fresh flat task-list context, injected ephemerally on every turn. */
  renderTaskContext?: () => string;
  /** Principal-only, host-owned mandatory delegation guard. Omitted for other roles. */
  principalWorkflowGuard?: {
    renderState: () => string;
    hasQualifyingDelegation: () => boolean;
    claimReminder: () => boolean | Promise<boolean>;
    onViolation: () => void | Promise<void>;
  };
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
    contextWindow?: number;
    reasoningEnabled?: boolean;
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
