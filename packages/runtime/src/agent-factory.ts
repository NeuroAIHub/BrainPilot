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
import type { AgentSessionFactory, IAgentSession, PiAgentEvent, PromptOptions, SystemTool, WorkflowStageCancellation } from "./types.js";
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
  const resolved = params.workflowModelBinding ?? (params.providerConfig
    ? await resolveSessionModel(sdk as unknown as PiProviderSdk, agentDir, params.providerConfig)
    : await resolveGatewayModel(sdk as unknown as PiProviderSdk, agentDir));
  const { model, modelRuntime } = resolved;

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
    thinkingLevel: params.workflowModelBinding?.thinkingLevel ?? params.thinkingLevel,
    ...(model ? { model } : {}),
    ...(modelRuntime ? { modelRuntime } : {}),
  });

  // #365: Pi's built-in classifier intentionally excludes most HTTP 400s.
  // Extend it for the narrow, trace-id-only transient shape seen in production.
  installBrainPilotRetryClassifier(session);
  if (params.workflowModelBinding) {
    installWorkflowStageCompletion(session);
    if (params.workflowStageCancellation) installWorkflowStageCancellation(session, params.workflowStageCancellation);
  }

  return new RealAgentSession(session, bashControllers);
};

interface StageTurnContext {
  toolResults: Array<{ toolName: string; isError: boolean }>;
}
type StageTurnStop<T extends StageTurnContext = StageTurnContext> = (context: T, signal?: AbortSignal) => boolean | Promise<boolean>;

/** Pi saves this turn's tool results before consulting this public loop hook. */
export function installWorkflowStageCompletion<T extends StageTurnContext>(session: { agent?: { shouldStopAfterTurn?: StageTurnStop<T> } }): void {
  if (!session.agent) throw new Error("Pi workflow stages require the public agent turn-completion hook");
  const previous = session.agent.shouldStopAfterTurn;
  session.agent.shouldStopAfterTurn = async (context, signal) =>
    Boolean(await previous?.(context, signal)) ||
    context.toolResults.some(result => result.toolName === "submit_result" && !result.isError);
}

/** Public Pi stream boundary: the loop hands its run signal to the stream function. */
type StageStreamOptions = { signal?: AbortSignal } & Record<string, unknown>;
export type StageStreamFn = (model: unknown, context: unknown, options?: StageStreamOptions) => unknown;

/**
 * Bind a workflow stage's own cancellation into the real provider request.
 *
 * Pi passes the active run's signal to `agent.streamFunction`, and the supported
 * providers forward that signal to `fetch`, so combining the stage signal here
 * is what makes a stage deadline or session Stop cancel the actual HTTP stream
 * instead of merely asking the agent loop to stop. Wrapping this public field is
 * limited to workflow-stage sessions; ordinary agent sessions keep Pi's own
 * stream function untouched. One documented consequence: because Pi identifies
 * its default stream function by identity when resolving summarization auth, a
 * wrapped stage resolves that auth through ModelRuntime — the same path any
 * custom stream function already takes.
 */
export function installWorkflowStageCancellation(
  session: { agent?: { streamFunction?: StageStreamFn } },
  cancellation: WorkflowStageCancellation,
): void {
  const agent = session.agent;
  const inner = agent?.streamFunction;
  if (!agent || typeof inner !== "function") throw new Error("Pi workflow stages require the public agent stream function");
  agent.streamFunction = async (model, context, options) => {
    const signal = options?.signal ? AbortSignal.any([options.signal, cancellation.signal]) : cancellation.signal;
    const settled = cancellation.requestStarted();
    let stream: unknown;
    try { stream = await inner(model, context, { ...options, signal }); }
    catch (error) { settled(); throw error; }
    return observeStreamSettlement(stream, settled);
  };
}

/**
 * Report when Pi's provider stream actually finished (or failed), so a fenced
 * stage can tell "the transport stopped" from "a race resolved".
 *
 * The producer is what has to be observed: Pi's stream pushes messages into a
 * queue that a consumer drains, and two supported consumers exist — the agent
 * loop iterates, while compaction/summarization awaits `result()` without ever
 * iterating. `result()` is the stream's public completion promise (it settles
 * when the producer emitted its final done/error message), so it is subscribed
 * to immediately and is the only settlement evidence used; the stream instance
 * itself is returned untouched, keeping its prototype, private fields and
 * `result()` identity exactly as the SDK created them. A consumer that stops
 * early (`iterator.return`) is deliberately *not* treated as the producer
 * ending: if the producer never settles after cancellation, the lifecycle
 * reports the request as possibly still open instead of inventing completion.
 * Only a stream without a public `result()` falls back to observing iteration,
 * and only its natural end or failure — never a consumer's early return.
 */
function observeStreamSettlement(stream: unknown, settled: () => void): unknown {
  let released = false;
  const release = () => { if (!released) { released = true; settled(); } };
  if (!stream || typeof stream !== "object") { release(); return stream; }
  const producer: unknown = (stream as { result?: unknown }).result;
  if (typeof producer === "function") {
    // A rejected producer is still a finished producer, and its rejection stays
    // owned by whoever awaits the stream itself.
    try {
      const completion: unknown = (producer as () => unknown).call(stream);
      if (completion && typeof (completion as PromiseLike<unknown>).then === "function") {
        (completion as PromiseLike<unknown>).then(release, release);
      } else release();
    } catch { release(); }
    return stream;
  }
  if (typeof (stream as AsyncIterable<unknown>)[Symbol.asyncIterator] !== "function") { release(); return stream; }
  return new Proxy(stream as object, {
    get(target, property) {
      if (property !== Symbol.asyncIterator) {
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (): AsyncIterator<unknown> => {
        const iterator = (target as AsyncIterable<unknown>)[Symbol.asyncIterator]();
        return {
          [Symbol.asyncIterator]() { return this; },
          next: async () => {
            try {
              const step = await iterator.next();
              if (step.done) release();
              return step;
            } catch (error) { release(); throw error; }
          },
          // The stage signal already reached the transport; a consumer walking
          // away is not proof the producer stopped, so nothing is released here.
          ...(iterator.return ? { return: async (value?: unknown) => iterator.return!(value) } : {}),
          ...(iterator.throw ? { throw: async (error?: unknown) => iterator.throw!(error) } : {}),
        } as AsyncIterator<unknown>;
      };
    },
  });
}

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
export class RealAgentSession implements IAgentSession {
  private promptCheckpoint: string | null | undefined;
  private retainCheckpointForAbort = false;

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
  getWorkflowModelBinding(): import("./types.js").WorkflowAgentModelBinding {
    const model = this.s.model;
    if (!model || !this.s.modelRuntime) throw new Error("Principal model binding is unavailable");
    return {
      model: Object.freeze({ ...model }),
      modelRuntime: this.s.modelRuntime,
      thinkingLevel: this.s.thinkingLevel,
    };
  }
  subscribe(listener: (e: PiAgentEvent) => void): () => void {
    return this.s.subscribe((e: unknown) => listener(e as PiAgentEvent));
  }
  prompt(text: string, opts?: PromptOptions): Promise<void> {
    // A top-level BrainPilot prompt begins a new user turn. Remember the last
    // completed Pi leaf so Stop can branch away from any partially persisted
    // user/assistant/tool entries. Follow-ups belong to the same turn and must
    // never replace this checkpoint.
    const topLevel = opts?.streamingBehavior === undefined && !this.s.isStreaming;
    if (topLevel) {
      this.promptCheckpoint = this.s.sessionManager.getLeafId();
      this.retainCheckpointForAbort = false;
    }
    return this.s.prompt(text, opts).finally(() => {
      if (topLevel && !this.retainCheckpointForAbort) {
        this.promptCheckpoint = undefined;
      }
    });
  }
  setThinkingLevel(level: import("@brainpilot/protocol").ThinkingLevel): void {
    this.s.setThinkingLevel(level);
  }
  abort(): Promise<void> {
    if (this.promptCheckpoint !== undefined) this.retainCheckpointForAbort = true;
    return this.s.abort();
  }
  clearQueue(): unknown {
    return this.s.clearQueue();
  }
  rollbackInterruptedTurn(): void {
    const checkpoint = this.promptCheckpoint;
    if (checkpoint === undefined) return;
    if (checkpoint === null) {
      this.s.sessionManager.resetLeaf();
    } else if (this.s.sessionManager.getLeafId() !== checkpoint) {
      this.s.sessionManager.branch(checkpoint);
    }
    // AgentSession.prompt() appends to the in-memory Agent state directly; it
    // does not rebuild that state from SessionManager on every prompt. Keep
    // both representations on the same clean branch or stale tool calls can
    // still execute even though the persisted leaf moved.
    this.s.state.messages = this.s.sessionManager.buildSessionContext().messages;
    this.promptCheckpoint = undefined;
    this.retainCheckpointForAbort = false;
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
  readonly agent?: { shouldStopAfterTurn?: StageTurnStop; streamFunction?: StageStreamFn };
  readonly model?: { id: string; provider: string; api?: string; [key: string]: unknown };
  readonly modelRuntime?: unknown;
  readonly thinkingLevel: import("@brainpilot/protocol").ThinkingLevel;
  readonly sessionId: string;
  readonly isStreaming: boolean;
  readonly state: { messages: unknown[] };
  readonly sessionManager: {
    getLeafId(): string | null;
    branch(entryId: string): void;
    resetLeaf(): void;
    buildSessionContext(): { messages: unknown[] };
  };
  subscribe(listener: (e: unknown) => void): () => void;
  prompt(text: string, opts?: PromptOptions): Promise<void>;
  setThinkingLevel(level: import("@brainpilot/protocol").ThinkingLevel): void;
  abort(): Promise<void>;
  clearQueue(): unknown;
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
    modelRuntime?: unknown;
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
  ModelRuntime: PiProviderSdk["ModelRuntime"];
}
