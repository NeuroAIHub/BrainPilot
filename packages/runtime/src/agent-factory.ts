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
import type { AgentSessionFactory, IAgentSession, PiAgentEvent, PromptOptions, SystemTool } from "./types.js";
import { MockAgentSession } from "./mock-agent.js";
import {
  resolveCompactionSettings,
  resolveGatewayModel,
  resolveSessionModel,
  type PiProviderSdk,
} from "./pi-provider.js";
import { makeTraceReminderExt } from "./extensions/trace-reminder.js";
import { makeAgentStatusExt } from "./extensions/agent-status.js";
import { makeTaskContextExt } from "./extensions/task-context.js";
import { makeRouterSkillGuardExt } from "./extensions/router-skill-guard.js";
import { makeManagedPathGuardExt } from "./extensions/managed-path-guard.js";
import { makeOpenAiToolSchemaCompatExt } from "./extensions/openai-tool-schema-compat.js";
import { makePrincipalWorkflowGuardExt } from "./extensions/principal-workflow-guard.js";
import { makeCompatHooksExt } from "./compat-hooks.js";
import {
  installBrainPilotRetryClassifier,
  PROVIDER_MAX_RETRIES,
  PROVIDER_RETRY_BASE_DELAY_MS,
} from "./pi-retry.js";

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
  const {
    createAgentSession,
    createBashToolDefinition,
    defineTool,
    SessionManager,
    SettingsManager,
    DefaultResourceLoader,
    getAgentDir,
  } = sdk;

  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(params.cwd, agentDir, {
    projectTrusted: true,
  });
  // #365: Pi performs retries inside the same LLM turn, before any subsequent
  // tool call can run. Pi increases the fixed 2s base exponentially, yielding
  // bounded waits of 2s, 4s, 8s, 16s, and 32s.
  const compaction = resolveCompactionSettings(params.providerConfig?.contextWindow);
  settingsManager.applyOverrides({
    retry: {
      enabled: true,
      maxRetries: PROVIDER_MAX_RETRIES,
      baseDelayMs: PROVIDER_RETRY_BASE_DELAY_MS,
    },
    ...(compaction ? { compaction } : {}),
  });

  // Override Pi's built-in bash with the public factory so each invocation
  // gets a tool-local signal. Aborting this signal ends only that command;
  // Pi receives the error result and continues the current model turn.
  const bashControllers = new Map<string, AbortController>();
  const officialBash = createBashToolDefinition(params.cwd, {
    commandPrefix: settingsManager.getShellCommandPrefix(),
    shellPath: settingsManager.getShellPath(),
  });
  const cancellableBash = wrapCancellableBash(officialBash, bashControllers);
  const customTools = [
    ...params.systemTools.map((t) => adaptTool(defineTool, t)),
    ...(params.allowedToolNames.includes("bash") ? [cancellableBash] : []),
  ];

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
  // #97: inject a fresh team-status block at the top of every turn, but only for
  // the agent the host supplied a renderer for (the principal). The `context`
  // hook recomputes per turn and the rewrite is ephemeral (never persisted).
  const extensionFactories: unknown[] = [];
  if (params.compatPluginProjections?.length) {
    extensionFactories.push(makeCompatHooksExt(params.compatPluginProjections));
  }
  if (!params.suppressCoordinationHooks) {
    extensionFactories.push(makeTraceReminderExt({
      role: params.role,
      name: params.agentName,
      onUnreplied: params.onUnreplied ?? (() => {}),
      hasPendingTasks: params.hasPendingTasks,
      claimTaskReminder: params.claimTaskReminder,
    }));
  }
  if (params.renderAgentStatus) {
    extensionFactories.push(makeAgentStatusExt({ renderStatus: params.renderAgentStatus }));
  }
  if (params.renderTaskContext) {
    extensionFactories.push(makeTaskContextExt({ renderTasks: params.renderTaskContext }));
  }
  if (params.principalWorkflowGuard) {
    extensionFactories.push(makePrincipalWorkflowGuardExt(params.principalWorkflowGuard));
  }
  // #346: rewrite logical /workspace (and /data, …) onto durable volume roots
  // BEFORE other path guards run, so subsequent handlers see post-rewrite paths.
  if (params.managedPathRoots) {
    extensionFactories.push(
      makeManagedPathGuardExt({
        roots: {
          cwd: params.managedPathRoots.cwd,
          persistentDir: params.managedPathRoots.persistentDir,
          ...(params.managedPathRoots.sharedDir
            ? { sharedDir: params.managedPathRoots.sharedDir }
            : {}),
        },
      }),
    );
  }
  // #309: when skill_search is off, hard-deny file-tool access to skills-router.
  if (params.blockRouterSkills && params.routerSkillsDir) {
    extensionFactories.push(
      makeRouterSkillGuardExt({
        routerSkillsDir: params.routerSkillsDir,
        cwd: params.cwd,
        enforce: true,
      }),
    );
  }
  // #452: keep this LAST. Pi has already combined built-in, custom, MCP, and
  // extension tools when before_provider_request runs, so one final rewrite
  // fixes every active tool source without changing their canonical schemas.
  extensionFactories.push(makeOpenAiToolSchemaCompatExt());
  const additionalExtensionPaths = params.compatPluginProjections
    ?.flatMap((projection) => projection.extensionPaths ?? []);
  const resourceLoader = new DefaultResourceLoader({
    cwd: params.cwd,
    agentDir,
    settingsManager,
    noSkills: true,
    noExtensions: true,
    noContextFiles: true,
    ...(additionalExtensionPaths?.length ? { additionalExtensionPaths } : {}),
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
    settingsManager,
    sessionManager: SessionManager.open(params.historyPath),
    thinkingLevel: params.thinkingLevel,
    ...(model ? { model } : {}),
    ...(modelRegistry ? { modelRegistry } : {}),
    ...(authStorage ? { authStorage } : {}),
  });

  // #365: Pi's built-in classifier intentionally excludes most HTTP 400s.
  // Extend it for the narrow, trace-id-only transient shape seen in production.
  installBrainPilotRetryClassifier(session);

  return new RealAgentSession(session, bashControllers);
};

type BashDefinition = ReturnType<PiSdk["createBashToolDefinition"]>;
const MAX_FOREGROUND_BASH_TIMEOUT_SECONDS = 300;

/** Preserve Pi's official Bash behavior while requiring a bounded foreground command. */
export function wrapCancellableBash(
  officialBash: BashDefinition,
  controllers: Map<string, AbortController>,
): BashDefinition {
  const parameters = officialBash.parameters as Record<string, unknown> | undefined;
  const properties = parameters?.properties as Record<string, unknown> | undefined;
  const required = Array.isArray(parameters?.required)
    ? parameters.required.filter((name): name is string => typeof name === "string")
    : ["command"];
  return {
    ...officialBash,
    parameters: {
      ...(parameters ?? { type: "object" }),
      properties: {
        ...(properties ?? { command: { type: "string" } }),
        timeout: {
          type: "number",
          minimum: 1,
          maximum: MAX_FOREGROUND_BASH_TIMEOUT_SECONDS,
          description: "Required foreground command deadline in seconds (maximum 300).",
        },
      },
      required: [...new Set([...required, "timeout"])],
    },
    async execute(
      toolCallId: string,
      args: Record<string, unknown>,
      runSignal: AbortSignal | undefined,
      onUpdate?: (update: unknown) => void,
      context?: unknown,
    ): Promise<unknown> {
      if (args.timeout === undefined) {
        throw new Error("bash timeout is required; provide a deadline between 1 and 300 seconds");
      }
      if (
        typeof args.timeout !== "number"
        || !Number.isFinite(args.timeout)
        || args.timeout < 1
        || args.timeout > MAX_FOREGROUND_BASH_TIMEOUT_SECONDS
      ) {
        throw new Error("bash timeout must be between 1 and 300 seconds");
      }
      const controller = new AbortController();
      controllers.set(toolCallId, controller);
      try {
        const signal = runSignal
          ? AbortSignal.any([runSignal, controller.signal])
          : controller.signal;
        return await officialBash.execute(toolCallId, args, signal, onUpdate, context);
      } catch (error) {
        if (controller.signal.aborted && !runSignal?.aborted) {
          const partialOutput = error instanceof Error ? error.message.trim() : String(error).trim();
          throw new Error(
            partialOutput
              ? `${partialOutput}\nCommand interrupted by user`
              : "Command interrupted by user",
          );
        }
        throw error;
      } finally {
        controllers.delete(toolCallId);
      }
    },
  };
}

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
  constructor(
    private readonly s: PiSession,
    private readonly bashControllers: Map<string, AbortController>,
  ) {}
  get sessionId(): string {
    return this.s.sessionId;
  }
  get isStreaming(): boolean {
    return this.s.isStreaming;
  }
  subscribe(listener: (e: PiAgentEvent) => void): () => void {
    return this.s.subscribe((e: unknown) => listener(e as PiAgentEvent));
  }
  prompt(text: string, opts?: PromptOptions): Promise<void> {
    return this.s.prompt(text, opts);
  }
  setThinkingLevel(level: import("@brainpilot/protocol").ThinkingLevel): void {
    this.s.setThinkingLevel(level);
  }
  abort(): Promise<void> {
    return this.s.abort();
  }
  interruptTool(toolCallId: string): boolean {
    const controller = this.bashControllers.get(toolCallId);
    if (!controller || controller.signal.aborted) return false;
    controller.abort();
    return true;
  }
  dispose(): void {
    this.s.dispose();
  }
}

/* ---- Minimal structural types for the Pi SDK (avoids hard type-coupling) ---- */
interface PiSession {
  readonly sessionId: string;
  readonly isStreaming: boolean;
  subscribe(listener: (e: unknown) => void): () => void;
  prompt(text: string, opts?: { streamingBehavior?: "steer" | "followUp" }): Promise<void>;
  setThinkingLevel(level: import("@brainpilot/protocol").ThinkingLevel): void;
  abort(): Promise<void>;
  dispose(): void;
}
interface PiSdk {
  createBashToolDefinition(
    cwd: string,
    options: { commandPrefix?: string; shellPath?: string },
  ): {
    name: string;
    execute(
      toolCallId: string,
      args: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate?: (update: unknown) => void,
      context?: unknown,
    ): Promise<unknown>;
    [key: string]: unknown;
  };
  createAgentSession(opts: {
    cwd?: string;
    tools?: string[];
    customTools?: unknown[];
    resourceLoader?: unknown;
    settingsManager?: unknown;
    sessionManager?: unknown;
    model?: unknown;
    modelRegistry?: unknown;
    authStorage?: unknown;
    thinkingLevel?: import("@brainpilot/protocol").ThinkingLevel;
  }): Promise<{ session: PiSession }>;
  defineTool(def: {
    name: string;
    label: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
  }): unknown;
  SessionManager: { open(path: string): unknown; inMemory(cwd?: string): unknown };
  SettingsManager: {
    create(
      cwd: string,
      agentDir?: string,
      options?: { projectTrusted?: boolean },
    ): {
      applyOverrides(overrides: {
        retry: { enabled: boolean; maxRetries: number; baseDelayMs: number };
        compaction?: { enabled: boolean; reserveTokens: number; keepRecentTokens: number };
      }): void;
      getShellCommandPrefix(): string | undefined;
      getShellPath(): string | undefined;
    };
  };
  DefaultResourceLoader: new (opts: {
    cwd: string;
    agentDir: string;
    settingsManager?: unknown;
    appendSystemPrompt?: string[];
    systemPrompt?: string;
    /** Drop host-global skill auto-discovery (~/.pi/agent/skills, etc.). */
    noSkills?: boolean;
    /** Drop host-global extension discovery while retaining explicit plugin paths. */
    noExtensions?: boolean;
    /** Drop the AGENTS.md/CLAUDE.md cwd→root context-file walk (host-dependent identity). */
    noContextFiles?: boolean;
    /** Explicit skill dirs/files; loaded even when noSkills is true, and not trust-gated. */
    additionalSkillPaths?: string[];
    /** Explicit trusted Pi extension files; loaded even when noExtensions is true. */
    additionalExtensionPaths?: string[];
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
