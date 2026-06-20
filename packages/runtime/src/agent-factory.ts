/**
 * Agent session factories.
 *
 *  - `mockAgentFactory`: deterministic, no API. Used when BP_MOCK=1.
 *  - `realAgentFactory`: wraps `@earendil-works/pi-coding-agent`'s AgentSession.
 *
 * `selectFactory()` picks based on env (BP_MOCK).
 *
 * Real factory notes (confirmed against installed Pi SDK v0.79):
 *   - `createAgentSession({ cwd, tools, customTools, sessionManager, ... })`
 *     returns `{ session }`.
 *   - `session.subscribe(cb)` streams `AgentSessionEvent`s; `session.prompt()`,
 *     `session.abort()`, `session.dispose()`.
 *   - `SystemTool` is adapted to Pi's `defineTool` (params is a plain JSON
 *     schema, which `defineTool` accepts — verified empirically).
 */
import type { AgentSessionFactory, IAgentSession, PiAgentEvent, SystemTool } from "./types.js";
import { MockAgentSession } from "./mock-agent.js";
import { resolveGatewayModel, resolveSessionModel, type PiProviderSdk } from "./pi-provider.js";
import { makeTraceReminderExt } from "./extensions/trace-reminder.js";
import { makeAgentStatusExt } from "./extensions/agent-status.js";

export function isMockMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.BP_MOCK === "1" || env.BP_MOCK === "true";
}

export const mockAgentFactory: AgentSessionFactory = async ({ sessionId, agentName, systemTools }) => {
  return new MockAgentSession({ sessionId, agentName, systemTools });
};

/**
 * Wrap the real Pi SDK. Imported lazily so mock-mode tests never load the SDK
 * (and never need API credentials).
 */
export const realAgentFactory: AgentSessionFactory = async (params) => {
  const sdk = (await import("@earendil-works/pi-coding-agent")) as unknown as PiSdk;
  const { createAgentSession, defineTool, SessionManager, DefaultResourceLoader, getAgentDir } = sdk;

  const customTools = params.systemTools.map((t) => adaptTool(defineTool, t));

  const agentDir = getAgentDir();

  // Target a custom Anthropic-compatible gateway. A per-session providerConfig
  // (from providers.json) wins and isolates its key via setRuntimeApiKey;
  // otherwise fall back to the env-based gateway (Docker/static compat).
  const resolved = params.providerConfig
    ? resolveSessionModel(sdk as unknown as PiProviderSdk, agentDir, params.providerConfig)
    : resolveGatewayModel(sdk as unknown as PiProviderSdk, agentDir);
  const { model, modelRegistry, authStorage } = resolved;

  // `createAgentSession` has NO `systemPrompt`/`instructions` option — the
  // per-role persona is injected through a DefaultResourceLoader. We use
  // `appendSystemPrompt` (NOT `systemPrompt`) so Pi's built-in tool-calling
  // guidance is preserved and our role persona is appended after it.
  //
  // Skills: Pi's DefaultResourceLoader otherwise auto-discovers skills from the
  // HOST machine's global dirs (~/.pi/agent/skills, ~/.agents/skills), which
  // makes agent behaviour depend on whoever runs the runtime — not reproducible.
  // We set `noSkills: true` to drop that implicit discovery, then load ONLY our
  // controlled skill dir(s) via `additionalSkillPaths` (honored even with
  // noSkills, verified against Pi v0.79 source). Pi's native skill pipeline
  // already does progressive disclosure: each skill's name+description goes into
  // the system prompt and the body is read on demand. The built-in skill content
  // (@brainpilot/skills) is materialized into `<dataRoot>/bp_template/skills`,
  // which the SessionManager passes here as `params.skillPaths`.
  // Context files: for the SAME reproducibility reason we set `noContextFiles: true`.
  // Pi would otherwise walk cwd→root collecting every AGENTS.md / CLAUDE.md and
  // inject them as project context. Agents run with cwd under the host repo, so
  // they'd absorb whatever AGENTS.md/CLAUDE.md happen to sit in the ancestry —
  // e.g. the legacy "MAS Platform Phase 1" doc — and mis-identify themselves.
  // Agent identity must come ONLY from the per-role persona below.
  // Pi-native hooks: register the trace-reminder extension per AgentSession (its
  // closure state is naturally per-agent). Only the real factory loads it — the
  // mock factory has no Pi event loop, so behavioural hooks are verified in real
  // mode (design §7 / T2).
  const traceReminder = makeTraceReminderExt({
    role: params.role,
    name: params.agentName,
    onUnreplied: params.onUnreplied ?? (() => {}),
  });
  // #97: inject a fresh team-status block at the top of every turn, but only for
  // the agent the host supplied a renderer for (the principal). The `context`
  // hook recomputes per turn and the rewrite is ephemeral (never persisted).
  const extensionFactories: unknown[] = [traceReminder];
  if (params.renderAgentStatus) {
    extensionFactories.push(makeAgentStatusExt({ renderStatus: params.renderAgentStatus }));
  }
  const resourceLoader = new DefaultResourceLoader({
    cwd: params.cwd,
    agentDir,
    noSkills: true,
    noContextFiles: true,
    ...(params.skillPaths && params.skillPaths.length > 0
      ? { additionalSkillPaths: params.skillPaths }
      : {}),
    appendSystemPrompt: params.systemPrompt ? [params.systemPrompt] : [],
    extensionFactories,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: params.cwd,
    tools: params.allowedToolNames,
    customTools,
    resourceLoader,
    sessionManager: SessionManager.open(params.historyPath),
    ...(model ? { model } : {}),
    ...(modelRegistry ? { modelRegistry } : {}),
    ...(authStorage ? { authStorage } : {}),
  });

  return new RealAgentSession(session);
};

export function selectFactory(): AgentSessionFactory {
  return isMockMode() ? mockAgentFactory : realAgentFactory;
}

/** Adapt a BrainPilot SystemTool to a Pi `defineTool` definition. */
function adaptTool(defineTool: PiSdk["defineTool"], tool: SystemTool): unknown {
  return defineTool({
    name: tool.name,
    // `label` is a REQUIRED field on Pi's ToolDefinition (UI display name).
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      const res = await tool.execute(params ?? {});
      // Pi's AgentToolResult has NO `isError`; failures are signalled by
      // THROWING. Surface our SystemToolResult.isError as a thrown error so
      // the agent sees a failed tool call (→ tool_execution_end isError →
      // system_message warning in MasAgent).
      if (res.isError) {
        const text = res.content.map((c) => c.text).join("\n");
        throw new Error(text || `${tool.name} failed`);
      }
      return { content: res.content, details: {} };
    },
  });
}

/** Thin adapter implementing IAgentSession over the real Pi AgentSession. */
class RealAgentSession implements IAgentSession {
  constructor(private readonly s: PiSession) {}
  get sessionId(): string {
    return this.s.sessionId;
  }
  subscribe(listener: (e: PiAgentEvent) => void): () => void {
    return this.s.subscribe((e: unknown) => listener(e as PiAgentEvent));
  }
  prompt(text: string): Promise<void> {
    return this.s.prompt(text);
  }
  abort(): Promise<void> {
    return this.s.abort();
  }
  dispose(): void {
    this.s.dispose();
  }
}

/* ---- Minimal structural types for the Pi SDK (avoids hard type-coupling) ---- */
interface PiSession {
  readonly sessionId: string;
  subscribe(listener: (e: unknown) => void): () => void;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
}
interface PiSdk {
  createAgentSession(opts: {
    cwd?: string;
    tools?: string[];
    customTools?: unknown[];
    resourceLoader?: unknown;
    sessionManager?: unknown;
    model?: unknown;
    modelRegistry?: unknown;
    authStorage?: unknown;
  }): Promise<{ session: PiSession }>;
  defineTool(def: {
    name: string;
    label: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
  }): unknown;
  SessionManager: { open(path: string): unknown; inMemory(cwd?: string): unknown };
  DefaultResourceLoader: new (opts: {
    cwd: string;
    agentDir: string;
    appendSystemPrompt?: string[];
    systemPrompt?: string;
    /** Drop host-global skill auto-discovery (~/.pi/agent/skills, etc.). */
    noSkills?: boolean;
    /** Drop the AGENTS.md/CLAUDE.md cwd→root context-file walk (host-dependent identity). */
    noContextFiles?: boolean;
    /** Explicit skill dirs/files; loaded even when noSkills is true, and not trust-gated. */
    additionalSkillPaths?: string[];
    /** Inline Pi extensions: each is called with the per-session ExtensionAPI. */
    extensionFactories?: unknown[];
  }) => { reload(): Promise<void> };
  getAgentDir(): string;
  AuthStorage: {
    create(path: string): unknown;
    inMemory?(): { setRuntimeApiKey?(provider: string, key: string): void };
  };
  ModelRegistry: {
    create(authStorage: unknown, modelsJsonPath?: string): {
      refresh(): void;
      getError(): string | undefined;
      find(provider: string, modelId: string): unknown;
    };
  };
}
