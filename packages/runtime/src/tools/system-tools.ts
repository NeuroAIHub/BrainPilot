/**
 * BrainPilot system tools (§9 decision 1) — defined as plain `SystemTool`
 * objects (name + JSON-schema params + execute closure). The real agent
 * factory wraps these with Pi's `defineTool`; the mock invokes `execute`
 * directly. Closures capture session context (task ledger, trace, manager).
 *
 * Per-agent access control (§9, ported from legacy `agent_tool_config`) is
 * applied by `toolsForRole` — each role only receives its allowed tools.
 */
import type { SubagentStatus, TraceNodeRecord } from "@brainpilot/protocol";
import type { SubagentResult, SubagentTask } from "../subagent-manager.js";
import type {
  GraphOfTrace,
  TraceArtifactInput,
  TraceCausalParentCandidate,
} from "../trace.js";
import type { WorkspaceCheckpointStore } from "../workspace-checkpoints.js";
import { TaskQueueFullError, type TaskRecord } from "../task-ledger.js";
import type { AgentRole, SystemTool } from "../types.js";
import { createSkillSearchTool } from "./skill-search.js";
import {
  createGetDomainKnowledgeLocalTool,
  createSearchPapersLocalTool,
} from "./kb/tools.js";
import { isToolEnabled, type ToolToggles } from "../tool-toggles.js";

export interface ToolDeps {
  sessionId: string;
  fromAgent: string;
  trace: GraphOfTrace;
  checkpoints?: WorkspaceCheckpointStore;
  dispatchTask: (to: string, content: string) => Promise<TaskRecord>;
  completeTask: (taskId: string, reply: string) => Promise<TaskRecord>;
  dispatchTrace: (content: string) => Promise<void>;
  /** Ensure an agent exists (auto-create/resurrect). */
  ensureAgent: (name: string) => Promise<void>;
  /** Destroy an agent (memory only; history kept). */
  destroyAgent: (name: string) => Promise<void>;
  /**
   * Wake a target agent to consume task notifications. Fire-and-forget: kicks a
   * serial delivery loop on the target so a committed task actually starts
   * its run, instead of sitting unread in an idle agent's inbox.
   */
  wakeAgent: (name: string) => void;
  /** Ask the terminal user a question; resolves with their answer. Blocks the turn. */
  requestUserInput: (req: {
    question: string;
    options?: string[];
    allow_free_text?: boolean;
  }) => Promise<string>;
  /**
   * Absolute path to the router skill base directory
   * (`<dataRoot>/bp_template/skills-router`). Backs the `skill_search` tool —
   * a Pi-native custom tool that lazily loads skills NOT exposed via Pi's
   * native `<available_skills>` block. Distinct from the always-on
   * `bp_template/skills/` dir loaded through `additionalSkillPaths`.
   */
  routerSkillsDir: string;
  /** Present only for persistent experts that may create isolated leaf workers. */
  spawnSubagents?: (args: { context?: string; tasks: SubagentTask[] }) => Promise<SubagentResult[]>;
  startSubagents?: (args: { context?: string; tasks: SubagentTask[] }) => Promise<SubagentStatus[]>;
  waitSubagents?: (childIds: string[]) => Promise<SubagentResult[]>;
  getSubagents?: (childIds?: string[]) => SubagentStatus[];
  cancelSubagents?: (childIds: string[]) => Promise<SubagentStatus[]>;
  listSubagentProfiles?: () => Promise<Array<{ name: string; description: string; builtinTools: string[]; systemTools: string[]; mcp: boolean; modelId?: string; timeoutMs?: number }>>;
  /** Current host-owned record while the Trace Agent processes one trace event. */
  currentTraceRecord?: () => TraceNodeRecord | undefined;
  startMonitor?: (input: { description: string; command: string; timeoutMs?: number; persistent?: boolean; blocking?: boolean }) => unknown;
  listMonitors?: () => unknown;
  stopMonitor?: (monitorId: string) => Promise<boolean>;
  runInBackground?: (input: { jobKey: string; description: string; command: string; timeoutMs?: number; replaceExisting?: boolean }) => Promise<unknown>;
  listBackgroundJobs?: () => unknown;
  getBackgroundJob?: (jobId: string) => unknown;
  stopBackgroundJob?: (jobId: string) => Promise<boolean>;
}

function ok(text: string): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text }] };
}

/** Detail/read tools are deliberately bounded so one graph query cannot eat a turn. */
const TRACE_DETAIL_MAX_TOKENS = 1500;
/** File samples sent to the Trace model; complete evidence stays in the checkpoint store. */
const TRACE_PROMPT_PROVENANCE_FILES = 25;

function cappedJson(value: unknown, maxTokens = TRACE_DETAIL_MAX_TOKENS): string {
  const text = JSON.stringify(value, null, 2);
  const maxChars = maxTokens * 3.5;
  if (text.length <= maxChars) return text;
  const suffix = `\n… truncated at ${maxTokens} estimated tokens`;
  // Reserve the marker itself so the returned result, not merely its raw JSON
  // prefix, stays within the declared 1500-token detail cap.
  return `${text.slice(0, Math.max(0, Math.floor(maxChars - suffix.length)))}${suffix}`;
}

function artifactInputs(value: unknown): TraceArtifactInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): TraceArtifactInput[] => {
    if (typeof item === "string" && item) return [{ path: item }];
    if (!item || typeof item !== "object") return [];
    const input = item as Record<string, unknown>;
    if (typeof input.path !== "string" || !input.path) return [];
    return [{
      ...(typeof input.id === "string" ? { id: input.id } : {}),
      path: input.path,
      ...(typeof input.kind === "string" ? { kind: input.kind } : {}),
      ...(typeof input.type === "string" ? { type: input.type } : {}),
      ...(typeof input.producer_node_id === "string" ? { producerNodeId: input.producer_node_id } : {}),
      ...(typeof input.producerNodeId === "string" ? { producerNodeId: input.producerNodeId } : {}),
      ...(typeof input.blob_hash === "string" ? { blobHash: input.blob_hash } : {}),
      ...(typeof input.blobHash === "string" ? { blobHash: input.blobHash } : {}),
    }];
  });
}

function causalParentCandidates(value: unknown):
  | { ok: true; candidates: TraceCausalParentCandidate[] }
  | { ok: false; error: string } {
  if (value === undefined) return { ok: true, candidates: [] };
  if (!Array.isArray(value)) return { ok: false, error: "parent_candidates must be an array" };
  const candidates: TraceCausalParentCandidate[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "each parent candidate must be an object" };
    const candidate = raw as Record<string, unknown>;
    const nodeId = typeof candidate.node_id === "string" ? candidate.node_id.trim() : "";
    const reason = typeof candidate.reason === "string" ? candidate.reason.trim() : "";
    if (!nodeId) return { ok: false, error: "each parent candidate requires node_id" };
    if (!reason) return { ok: false, error: `parent ${nodeId} requires a non-empty reason` };
    candidates.push({ nodeId, reason });
  }
  return { ok: true, candidates };
}

async function attachCheckpointWithGitEvidence(deps: ToolDeps, nodeId: string, checkpointId: string): Promise<void> {
  if (!deps.checkpoints) return;
  const [[checkpoint], files] = await Promise.all([
    deps.checkpoints.refs([checkpointId]),
    deps.checkpoints.provenance(checkpointId),
  ]);
  if (checkpoint) deps.trace.attachCheckpoint(nodeId, checkpoint, files ?? []);
}

export function createDispatchTaskTool(deps: ToolDeps): SystemTool {
  return {
    name: "dispatch_task",
    description:
      "Create an independent task for another agent. Returns a stable task ID; include all context and relevant workspace file paths.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", minLength: 1, description: "Self-contained task and acceptance criteria" },
        to: { type: "string", description: "Target agent name" },
      },
      required: ["content", "to"],
    },
    execute: async (params: Record<string, unknown>) => {
      const to = String(params.to ?? "").trim();
      const content = String(params.content ?? "").trim();
      if (!to || !content) return { ...ok("to and content are required"), isError: true };
      if (to === deps.fromAgent) return { ...ok("cannot dispatch a task to yourself"), isError: true };
      if (to === "trace") return { ...ok("cannot dispatch user tasks to the trace agent"), isError: true };
      if (deps.fromAgent === "auditor" && to === "principal") {
        return { ...ok("Auditor reports are user-gated and cannot be sent directly to PI"), isError: true };
      }
      try {
        await deps.ensureAgent(to);
        const task = await deps.dispatchTask(to, content);
        deps.wakeAgent(to);
        return ok(`task ${task.id} dispatched to ${to}`);
      } catch (err) {
        if (err instanceof TaskQueueFullError) {
          return { ...ok(`cannot dispatch to ${to}: ${err.message}`), isError: true };
        }
        return { ...ok(`cannot dispatch task: ${(err as Error).message}`), isError: true };
      }
    },
  };
}

export function createCompleteTaskTool(deps: ToolDeps): SystemTool {
  return {
    name: "complete_task",
    description:
      "Complete one task assigned to you and return its result to the task creator. Include conclusions and relevant workspace file paths; if blocked, explain why.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", minLength: 1, description: "Exact ID from assigned_to_me" },
        reply: { type: "string", minLength: 1, description: "Result, limitations, and artifact paths" },
      },
      required: ["task_id", "reply"],
    },
    execute: async (params: Record<string, unknown>) => {
      const taskId = String(params.task_id ?? "").trim();
      const reply = String(params.reply ?? "").trim();
      if (!taskId || !reply) return { ...ok("task_id and reply are required"), isError: true };
      try {
        const task = await deps.completeTask(taskId, reply);
        deps.wakeAgent(task.created_by);
        return ok(`task ${task.id} replied to ${task.created_by}`);
      } catch (err) {
        return { ...ok(`cannot complete task: ${(err as Error).message}`), isError: true };
      }
    },
  };
}

export function createAskUserTool(deps: ToolDeps): SystemTool {
  return {
    name: "ask_user",
    description:
      "Ask the human user a question and wait for their answer. Use when you need a decision or information only the user can provide. Returns the user's answer as text.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          minLength: 1,
          maxLength: 4000,
          description: "The question to show the user",
        },
        options: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 500 },
          maxItems: 20,
          uniqueItems: true,
          description: "Optional choices to offer the user",
        },
        allow_free_text: {
          type: "boolean",
          description: "Whether the user may type a free-text answer (default true)",
        },
      },
      required: ["question"],
    },
    execute: async (params: Record<string, unknown>) => {
      const question = typeof params.question === "string" ? params.question.trim() : "";
      if (!question || question.length > 4000) {
        return { ...ok("question must contain 1–4000 characters"), isError: true };
      }
      if (params.options !== undefined && !Array.isArray(params.options)) {
        return { ...ok("options must be an array of strings"), isError: true };
      }
      const rawOptions = (params.options as unknown[] | undefined) ?? [];
      if (rawOptions.length > 20 || rawOptions.some((option) => typeof option !== "string")) {
        return { ...ok("options must contain at most 20 strings"), isError: true };
      }
      const options = rawOptions.map((option) => (option as string).trim());
      if (options.some((option) => !option || option.length > 500)) {
        return { ...ok("each option must contain 1–500 characters"), isError: true };
      }
      if (new Set(options).size !== options.length) {
        return { ...ok("options must not contain duplicates"), isError: true };
      }
      const allowFreeText =
        typeof params.allow_free_text === "boolean" ? params.allow_free_text : true;
      if (!allowFreeText && options.length === 0) {
        return { ...ok("ask_user needs options when free-text answers are disabled"), isError: true };
      }
      const answer = await deps.requestUserInput({
        question,
        options: options.length > 0 ? options : undefined,
        allow_free_text: allowFreeText,
      });
      return ok(answer);
    },
  };
}

export function createCreateAgentTool(deps: ToolDeps): SystemTool {
  return {
    name: "create_agent",
    description: "Create (or resurrect) an expert agent by type.",
    parameters: {
      type: "object",
      properties: { agent_type: { type: "string" } },
      required: ["agent_type"],
    },
    execute: async (params: Record<string, unknown>) => {
      const name = String(params.agent_type ?? "");
      await deps.ensureAgent(name);
      return ok(`agent ${name} ready`);
    },
  };
}

export function createDestroyAgentTool(deps: ToolDeps): SystemTool {
  return {
    name: "destroy_agent",
    description: "Destroy an expert agent (history preserved; can be revived).",
    parameters: {
      type: "object",
      properties: { agent_type: { type: "string" } },
      required: ["agent_type"],
    },
    execute: async (params: Record<string, unknown>) => {
      const name = String(params.agent_type ?? "");
      await deps.destroyAgent(name);
      return ok(`agent ${name} destroyed`);
    },
  };
}

export function createStartMonitorTool(deps: ToolDeps): SystemTool {
  return {
    name: "start_monitor",
    description:
      "Start a background shell command and receive its stdout as untrusted monitor events. " +
      "Use selective, line-buffered output; silence costs no model turn. " +
      "Do not run sleep commands or poll while waiting. If monitoring is your only remaining work, end the current turn; " +
      "the runtime will wake you automatically when stdout emits a complete line. " +
      "Persistent monitors run until explicitly stopped or the session ends.",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", minLength: 1, maxLength: 200 },
        command: { type: "string", minLength: 1, maxLength: 16_000 },
        timeout_ms: { type: "number", minimum: 1, maximum: 3_600_000 },
        persistent: { type: "boolean" },
        blocking: {
          type: "boolean",
          description: "Whether this process must finish before aggregate session work can settle. Defaults to true for finite monitors and false for persistent monitors.",
        },
      },
      required: ["description", "command"],
    },
    execute: async (params) => {
      if (!deps.startMonitor) return { ...ok("Monitor plugin is not enabled for this session"), isError: true };
      const description = typeof params.description === "string" ? params.description.trim() : "";
      const command = typeof params.command === "string" ? params.command.trim() : "";
      if (!description || !command) return { ...ok("description and command are required"), isError: true };
      try {
        return ok(JSON.stringify(deps.startMonitor({
          description,
          command,
          ...(typeof params.timeout_ms === "number" ? { timeoutMs: params.timeout_ms } : {}),
          ...(typeof params.persistent === "boolean" ? { persistent: params.persistent } : {}),
          ...(typeof params.blocking === "boolean" ? { blocking: params.blocking } : {}),
        }), null, 2));
      } catch (error) {
        return { ...ok((error as Error).message), isError: true };
      }
    },
  };
}

export function createListMonitorsTool(deps: ToolDeps): SystemTool {
  return {
    name: "list_monitors",
    description: "List background monitors owned by this agent, including terminal status and bounded stderr diagnostics.",
    parameters: { type: "object", properties: {} },
    execute: async () => deps.listMonitors
      ? ok(JSON.stringify({ monitors: deps.listMonitors() }, null, 2))
      : { ...ok("Monitor plugin is not enabled for this session"), isError: true },
  };
}

export function createStopMonitorTool(deps: ToolDeps): SystemTool {
  return {
    name: "stop_monitor",
    description: "Stop one running background monitor owned by this agent.",
    parameters: {
      type: "object",
      properties: { monitor_id: { type: "string", minLength: 1 } },
      required: ["monitor_id"],
    },
    execute: async (params) => {
      if (!deps.stopMonitor) return { ...ok("Monitor plugin is not enabled for this session"), isError: true };
      const monitorId = typeof params.monitor_id === "string" ? params.monitor_id.trim() : "";
      if (!monitorId) return { ...ok("monitor_id is required"), isError: true };
      return await deps.stopMonitor(monitorId)
        ? ok(`monitor ${monitorId} stopped`)
        : { ...ok(`monitor ${monitorId} is not running or is not owned by this agent`), isError: true };
    },
  };
}

export function createRunInBackgroundTool(deps: ToolDeps): SystemTool {
  return {
    name: "run_in_background",
    description:
      "Start a one-shot long-running shell command, such as training, a build, or a test suite, without blocking this turn. " +
      "Unlike start_monitor, stdout and stderr are written to a bounded log and do not wake you while the job is running; " +
      "the runtime wakes you exactly when the job completes, fails, or times out, including for silent commands. " +
      "Always choose a stable job_key for the logical workload. A second active job with the same key is rejected unless " +
      "replace_existing=true, which stops the old process group before starting the replacement. " +
      "After starting, do not sleep or poll. If this is your only remaining work, end the current turn and wait for the completion event.",
    parameters: {
      type: "object",
      properties: {
        job_key: { type: "string", minLength: 1, maxLength: 160, description: "Stable key for duplicate prevention, for example experiment-b-training" },
        description: { type: "string", minLength: 1, maxLength: 200 },
        command: { type: "string", minLength: 1, maxLength: 16_000 },
        timeout_ms: { type: "number", minimum: 1_000, maximum: 86_400_000, description: "Default 1 hour; maximum 24 hours" },
        replace_existing: { type: "boolean", description: "Stop the active job with the same job_key before starting this one" },
      },
      required: ["job_key", "description", "command"],
    },
    execute: async (params) => {
      if (!deps.runInBackground) return { ...ok("Background Jobs plugin is not enabled for this session"), isError: true };
      const jobKey = typeof params.job_key === "string" ? params.job_key.trim() : "";
      const description = typeof params.description === "string" ? params.description.trim() : "";
      const command = typeof params.command === "string" ? params.command.trim() : "";
      if (!jobKey || !description || !command) return { ...ok("job_key, description, and command are required"), isError: true };
      try {
        const job = await deps.runInBackground({
          jobKey,
          description,
          command,
          ...(typeof params.timeout_ms === "number" ? { timeoutMs: params.timeout_ms } : {}),
          ...(typeof params.replace_existing === "boolean" ? { replaceExisting: params.replace_existing } : {}),
        });
        return ok(JSON.stringify(job, null, 2));
      } catch (error) {
        return { ...ok((error as Error).message), isError: true };
      }
    },
  };
}

export function createBackgroundJobTool(deps: ToolDeps): SystemTool {
  return {
    name: "background_job",
    description:
      "Manage one-shot jobs created by run_in_background. Use action=list to inspect your jobs, get to read one job's status, " +
      "bounded stdout/stderr tail and log path, or stop to cancel its entire process group. " +
      "Do not repeatedly call list/get to wait for completion; the runtime sends a completion event automatically.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "get", "stop"] },
        job_id: { type: "string", minLength: 1, description: "Required for get and stop" },
      },
      required: ["action"],
    },
    execute: async (params) => {
      if (!deps.listBackgroundJobs || !deps.getBackgroundJob || !deps.stopBackgroundJob) {
        return { ...ok("Background Jobs plugin is not enabled for this session"), isError: true };
      }
      const action = params.action;
      if (action === "list") return ok(JSON.stringify({ jobs: deps.listBackgroundJobs() }, null, 2));
      const jobId = typeof params.job_id === "string" ? params.job_id.trim() : "";
      if (!jobId) return { ...ok("job_id is required for get and stop"), isError: true };
      if (action === "get") {
        const job = deps.getBackgroundJob(jobId);
        return job ? ok(JSON.stringify(job, null, 2)) : { ...ok(`background job ${jobId} was not found`), isError: true };
      }
      if (action === "stop") {
        return await deps.stopBackgroundJob(jobId)
          ? ok(`background job ${jobId} stopped`)
          : { ...ok(`background job ${jobId} is not running or is not owned by this agent`), isError: true };
      }
      return { ...ok("action must be list, get, or stop"), isError: true };
    },
  };
}

export function createSpawnSubagentTool(deps: ToolDeps): SystemTool {
  return {
    name: "spawn_subagent",
    description:
      "Run 1-4 context-isolated leaf subagents in parallel. By default this waits for structured results; " +
      "set wait=false to receive child ids immediately, continue other work, then use wait_subagent or get_subagent. " +
      "Pass all required background explicitly; children do not inherit your conversation.",
    parameters: {
      type: "object",
      properties: {
        context: { type: "string", description: "Optional shared background for every child." },
        wait: { type: "boolean", description: "Wait for all results. Defaults to true; false launches in the background." },
        tasks: {
          type: "array", minItems: 1, maxItems: 4,
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              profile: { type: "string", description: "Profile name from list_subagent_profiles." },
              task: { type: "string" },
              workspaceMode: {
                type: "string",
                enum: ["isolated", "shared"],
                description: "Run in isolated scratch space or directly in the shared session workspace. Defaults to isolated.",
              },
              inputs: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    scope: { type: "string", enum: ["workspace", "attachments", "data", "shared"] },
                    path: { type: "string" },
                    alias: { type: "string" },
                    mode: { type: "string", enum: ["copy", "reference"] },
                  },
                  required: ["scope", "path"],
                },
              },
            },
            required: ["profile", "task"],
          },
        },
      },
      required: ["tasks"],
    },
    execute: async (params) => {
      if (!deps.spawnSubagents) return { ...ok("subagent spawning is unavailable"), isError: true };
      const tasks = Array.isArray(params.tasks) ? params.tasks as SubagentTask[] : [];
      const args = { ...(typeof params.context === "string" ? { context: params.context } : {}), tasks };
      if (params.wait === false) {
        if (!deps.startSubagents) return { ...ok("background subagent spawning is unavailable"), isError: true };
        return ok(JSON.stringify({ waiting: false, subagents: await deps.startSubagents(args) }, null, 2));
      }
      return ok(JSON.stringify({ results: await deps.spawnSubagents(args) }, null, 2));
    },
  };
}

function childIdsFrom(params: Record<string, unknown>): string[] {
  return Array.isArray(params.child_ids) ? params.child_ids.map(String) : [];
}

export function createWaitSubagentTool(deps: ToolDeps): SystemTool {
  return {
    name: "wait_subagent",
    description: "Wait for previously launched subagents to reach terminal states and return their structured results in the requested order.",
    parameters: { type: "object", properties: { child_ids: { type: "array", minItems: 1, maxItems: 32, items: { type: "string" } } }, required: ["child_ids"] },
    execute: async (params) => deps.waitSubagents
      ? ok(JSON.stringify({ results: await deps.waitSubagents(childIdsFrom(params)) }, null, 2))
      : { ...ok("subagent waiting is unavailable"), isError: true },
  };
}

export function createGetSubagentTool(deps: ToolDeps): SystemTool {
  return {
    name: "get_subagent",
    description: "Get current status for your subagents without waiting. Omit child_ids to list all subagents you created.",
    parameters: { type: "object", properties: { child_ids: { type: "array", maxItems: 32, items: { type: "string" } } } },
    execute: async (params) => {
      if (!deps.getSubagents) return { ...ok("subagent status is unavailable"), isError: true };
      const ids = childIdsFrom(params);
      return ok(JSON.stringify({ subagents: deps.getSubagents(ids.length ? ids : undefined) }, null, 2));
    },
  };
}

export function createCancelSubagentTool(deps: ToolDeps): SystemTool {
  return {
    name: "cancel_subagent",
    description: "Cancel one or more queued or running subagents that you created. Terminal subagents are returned unchanged.",
    parameters: { type: "object", properties: { child_ids: { type: "array", minItems: 1, maxItems: 32, items: { type: "string" } } }, required: ["child_ids"] },
    execute: async (params) => deps.cancelSubagents
      ? ok(JSON.stringify({ subagents: await deps.cancelSubagents(childIdsFrom(params)) }, null, 2))
      : { ...ok("subagent cancellation is unavailable"), isError: true },
  };
}

export function createListSubagentProfilesTool(deps: ToolDeps): SystemTool {
  return {
    name: "list_subagent_profiles",
    description: "List the built-in and deployment-defined subagent profiles this agent is authorized to launch.",
    parameters: { type: "object", properties: {} },
    execute: async () => deps.listSubagentProfiles
      ? ok(JSON.stringify({ profiles: await deps.listSubagentProfiles() }, null, 2))
      : { ...ok("subagent profile discovery is unavailable"), isError: true },
  };
}

export function createRecordTraceTool(deps: ToolDeps): SystemTool {
  return {
    name: "record_trace",
    description:
      "Notify the Trace Agent of a reasoning/trace event. The Trace Agent is a " +
      "real agent that owns the Graph of Trace; it decides whether to create a " +
      "new node, update an existing one, or ignore process noise. Prefer one " +
      "independently meaningful research unit per call; report distinct settings, " +
      "results, analyses, findings, or conclusions separately when they can be inspected independently.",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string" },
        artifacts: { type: "array", items: { type: "string" } },
        artifact_inputs: {
          type: "array",
          items: { type: "object", properties: { path: { type: "string" }, type: { type: "string" }, producer_node_id: { type: "string" } }, required: ["path"] },
          description: "Artifacts consumed by this work; registry references are preferred.",
        },
        artifact_outputs: {
          type: "array",
          items: { type: "object", properties: { path: { type: "string" }, type: { type: "string" }, blob_hash: { type: "string" } }, required: ["path"] },
          description: "Artifacts produced by this work.",
        },
        context: { type: "string" },
      },
      required: ["description"],
    },
    execute: async (params: Record<string, unknown>) => {
      // §10 (legacy parity): record_trace does NOT mutate the graph directly.
      // Instead it dispatches a [Trace Event] envelope into the trace agent's
      // durable internal queue; the trace agent receives it and
      // calls create_trace_node / update_trace_node as the editor. The host
      // binds the source record to the durable
      // task notification
      // delivery; Trace only decides which logical research node receives it.
      // This keeps the trace agent's status authentically live in the
      // Agents panel (otherwise it would be a permanently-dormant placeholder)
      // and lets the trace agent merge/dedupe across multiple sources, which is
      // exactly the persona we already ship for it.
      const description = String(params.description ?? "").trim();
      if (!description) return { ...ok("description must be non-empty"), isError: true };
      const context = String(params.context ?? "");
      const artifacts = Array.isArray(params.artifacts)
        ? params.artifacts.filter((value): value is string => typeof value === "string")
        : [];
      const inputs = artifactInputs(params.artifact_inputs);
      const outputs = artifactInputs(params.artifact_outputs);
      const checkpoint = await deps.checkpoints?.capture(deps.fromAgent);
      const gitEvidence = checkpoint
        ? await deps.checkpoints?.provenance(
            checkpoint.id,
            TRACE_PROMPT_PROVENANCE_FILES,
          ).catch(() => undefined)
        : undefined;
      const record: TraceNodeRecord = {
        sourceAgent: deps.fromAgent,
        description,
        ...(context ? { context } : {}),
        ...(checkpoint ? { checkpointId: checkpoint.id } : {}),
        createdAt: new Date().toISOString(),
      };
      const lines = [`[Trace Event]`, `Description: ${description}`];
      if (context) lines.push(`Context: ${context}`);
      if (checkpoint) lines.push(`Checkpoint-ID: ${checkpoint.id}`);
      if (inputs.length) lines.push(`Artifact-Inputs: ${JSON.stringify(inputs)}`);
      if (outputs.length) lines.push(`Artifact-Outputs: ${JSON.stringify(outputs)}`);
      if (checkpoint) {
        const totalFiles = checkpoint.stats?.files ?? gitEvidence?.length ?? 0;
        lines.push(`Git-Evidence-Summary: ${cappedJson({
          checkpointId: checkpoint.id,
          stats: checkpoint.stats,
          skippedCount: checkpoint.skippedCount,
          sample: gitEvidence ?? [],
          truncated: totalFiles > (gitEvidence?.length ?? 0),
        }, 1_000)}`);
      }
      lines.push("", "Artifacts:");
      if (artifacts.length === 0) {
        lines.push("(none)");
      } else {
        for (const a of artifacts) lines.push(`- ${a}`);
      }
      lines.push(`Trace-Record: ${JSON.stringify(record)}`);
      const envelope = lines.join("\n");

      // Spawn-on-demand: the trace agent is a real Pi session. ensureAgent
      // creates one if it doesn't exist yet (idempotent) and resurrects a
      // stopped one. That spawn is what finally surfaces the trace agent as
      // "idle/running" in the Agents panel.
      await deps.ensureAgent("trace");
      try {
        await deps.dispatchTrace(envelope);
      } catch (err) {
        if (err instanceof TaskQueueFullError) return { ...ok(`cannot deliver to trace: ${err.message}`), isError: true };
        throw err;
      }
      // Fire-and-forget: kick the trace agent's delivery loop so the envelope
      // is consumed in its own run rather than sitting unread.
      deps.wakeAgent("trace");
      return ok("trace event dispatched");
    },
  };
}

export function createTraceNodeTool(deps: ToolDeps): SystemTool {
  return {
    name: "create_trace_node",
    description:
      "Create one new active Graph of Trace node only when the current host-bound record represents a distinct, durable scientific unit that is not already in the active graph. " +
      "Do not create nodes for coordination, delegation, progress, presentation, reformatting, or repetition. The Host attaches the current source record and checkpoint automatically. " +
      "The Host attaches the session root only when no parent is present. The session root ID is exposed by get_trace_graph and may be proposed when the unit directly depends on the session's initial context. " +
      "One Trace Event may call this tool more than once only when it explicitly contains multiple independently meaningful scientific units with enough content to describe each accurately.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Concise name of the scientific result, decision, analysis, artifact, or conclusion; not an activity-log title." },
        episode: { type: "string", description: "Human-facing research work-package name. Reuse the exact name of an existing Episode when the unit belongs there." },
        type: { type: "string", description: "Optional short presentation label; do not invent a complex ontology." },
        status: { type: "string", enum: ["completed", "failed"] },
        description: { type: "string", description: "What was scientifically decided, measured, produced, observed, or concluded." },
        confidence: { type: "string", enum: ["low", "medium", "high"], description: "Strength of support from accessible records and evidence, not task success or writing detail." },
        confidence_reason: { type: "string", description: "Name the concrete supporting records/evidence and their limitations; specificity alone does not justify high confidence." },
        parent_candidates: {
          type: "array",
          items: { type: "object", properties: { node_id: { type: "string" }, reason: { type: "string" } }, required: ["node_id", "reason"] },
          description: "Direct epistemic or computational prerequisites actually consumed by this node. Structurally valid Trace relations are recorded immediately; chronology, delegation, and topic similarity are insufficient.",
        },
        artifact_inputs: { type: "array", items: { type: "object", properties: { path: { type: "string" }, type: { type: "string" }, producer_node_id: { type: "string" } }, required: ["path"] } },
        artifact_outputs: { type: "array", items: { type: "object", properties: { path: { type: "string" }, type: { type: "string" }, blob_hash: { type: "string" } }, required: ["path"] } },
      },
      required: ["title", "episode", "description", "confidence", "confidence_reason"],
    },
    execute: async (params: Record<string, unknown>) => {
      const title = String(params.title ?? "").trim();
      const episode = String(params.episode ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");
      const description = String(params.description ?? "").trim();
      const confidenceReason = String(params.confidence_reason ?? "").trim();
      if (!title) return { ...ok("title must be non-empty"), isError: true };
      if (!episode) return { ...ok("episode must be non-empty"), isError: true };
      if (!description) return { ...ok("description must be non-empty"), isError: true };
      if ((params.confidence !== "low" && params.confidence !== "medium" && params.confidence !== "high") || !confidenceReason) {
        return { ...ok("confidence and a non-empty confidence_reason are required"), isError: true };
      }
      const parsedParents = causalParentCandidates(params.parent_candidates);
      if (!parsedParents.ok) return { ...ok(parsedParents.error), isError: true };
      const parentValidation = deps.trace.validateCausalParentCandidates(undefined, parsedParents.candidates);
      if (!parentValidation.ok) return { ...ok(`invalid parent candidates: ${parentValidation.reason}`), isError: true };
      const record = deps.currentTraceRecord?.();
      const node = deps.trace.createNode({
        title,
        episode,
        type: params.type ? String(params.type).trim() : undefined,
        status: params.status === "failed" ? "failed" : "completed",
        executionResult: params.status === "failed" ? "failed" : "completed",
        description,
        confidence: params.confidence === "high" || params.confidence === "medium" ? params.confidence : "low",
        confidenceReason,
        agent: record?.sourceAgent ?? deps.fromAgent,
        records: record ? [record] : [],
        causalParents: parsedParents.candidates.map((candidate) => ({
          nodeId: candidate.nodeId,
          conclusion: "confirmed",
          origin: "trace",
          reason: candidate.reason,
        })),
        changeActor: { type: "agent", name: deps.fromAgent },
        artifactInputs: artifactInputs(params.artifact_inputs),
        artifactOutputs: artifactInputs(params.artifact_outputs),
      });
      const checkpointId = record?.checkpointId;
      if (checkpointId) await attachCheckpointWithGitEvidence(deps, node.id, checkpointId);
      return ok(JSON.stringify({
        nodeId: node.id,
        episode,
        parentNodeIds: parsedParents.candidates.map((candidate) => candidate.nodeId),
      }));
    },
  };
}

export function createUpdateTraceNodeTool(deps: ToolDeps): SystemTool {
  return {
    name: "update_trace_node",
    description:
      "Update exactly one existing active Trace node only when the current host-bound record belongs to the same scientific unit and adds evidence, results, a correction, or a meaningful status change. " +
      "Read the target node first and preserve its valid existing content when supplying replacement text. Do not update merely to rephrase, translate, format, present, or repeat it. " +
      "The Host attaches the current record and checkpoint automatically; revoked nodes cannot be reused, and confidence must be re-evaluated on every substantive update.",
    parameters: {
      type: "object",
      properties: {
        node_id: { type: "string", description: "Active node representing the exact same scientific unit. Inspect it with get_trace_node before updating." },
        episode: { type: "string", description: "Optional human-facing Episode name. Supply only to move this node to another research work package." },
        title: { type: "string", description: "Supply only when the existing title is inaccurate or the same scientific unit now has a clearer stable name." },
        description: { type: "string", description: "Complete merged scientific description preserving valid prior content; this replaces the stored description." },
        status: { type: "string", enum: ["completed", "failed"] },
        summary: { type: "string" },
        content: { type: "string" },
        confidence: { type: "string", enum: ["low", "medium", "high"], description: "Re-evaluated strength of support after incorporating the current record." },
        confidence_reason: { type: "string", description: "Required concrete re-evaluation after every node update, even when the level is unchanged." },
        artifact_outputs: { type: "array", items: { type: "object", properties: { path: { type: "string" }, type: { type: "string" } }, required: ["path"] } },
        parent_candidates: {
          type: "array",
          items: { type: "object", properties: { node_id: { type: "string" }, reason: { type: "string" } }, required: ["node_id", "reason"] },
          description: "New direct epistemic or computational prerequisites revealed by this update; never infer them from chronology.",
        },
      },
      required: ["node_id", "confidence", "confidence_reason"],
    },
    execute: async (params: Record<string, unknown>) => {
      const id = String(params.node_id ?? "");
      const existing = deps.trace.getNodeV2(id);
      if (!existing) return { ...ok(`node ${id} not found`), isError: true };
      if (existing.revoked) return { ...ok(`node ${id} is revoked; create a new node instead`), isError: true };
      const confidenceReason = String(params.confidence_reason ?? "").trim();
      if ((params.confidence !== "low" && params.confidence !== "medium" && params.confidence !== "high") || !confidenceReason) {
        return { ...ok("confidence and a non-empty confidence_reason are required for every node update"), isError: true };
      }
      if (params.title !== undefined && !String(params.title).trim()) return { ...ok("title must be non-empty when supplied"), isError: true };
      if (params.description !== undefined && !String(params.description).trim()) return { ...ok("description must be non-empty when supplied"), isError: true };
      const episode = params.episode === undefined
        ? undefined
        : String(params.episode).normalize("NFKC").trim().replace(/\s+/gu, " ");
      if (params.episode !== undefined && !episode) return { ...ok("episode must be non-empty when supplied"), isError: true };
      const parsedParents = causalParentCandidates(params.parent_candidates);
      if (!parsedParents.ok) return { ...ok(parsedParents.error), isError: true };
      const parentValidation = deps.trace.validateCausalParentCandidates(id, parsedParents.candidates);
      if (!parentValidation.ok) return { ...ok(`invalid parent candidates: ${parentValidation.reason}`), isError: true };
      const record = deps.currentTraceRecord?.();
      const updates: Record<string, unknown> = {};
      for (const k of ["status", "summary", "content", "title", "description"]) {
        if (params[k] !== undefined) updates[k] = typeof params[k] === "string" ? params[k].trim() : params[k];
      }
      if (episode !== undefined) updates.episode = episode;
      if (params.status === "completed" || params.status === "failed") updates.executionResult = params.status;
      updates.confidence = params.confidence === "high" || params.confidence === "medium" ? params.confidence : "low";
      updates.confidenceReason = confidenceReason;
      const outputs = artifactInputs(params.artifact_outputs);
      if (outputs.length) updates.artifacts = outputs.map((artifact) => ({ path: artifact.path, type: artifact.type }));
      const node = deps.trace.updateNode(
        id,
        updates,
        { type: "agent", name: deps.fromAgent },
        parsedParents.candidates,
      );
      if (node && record) deps.trace.appendRecord(id, record, { type: "agent", name: deps.fromAgent });
      const checkpointId = record?.checkpointId;
      if (node && checkpointId) await attachCheckpointWithGitEvidence(deps, id, checkpointId);
      return node ? ok(JSON.stringify({
        nodeId: id,
        ...(episode ? { episode } : {}),
        parentNodeIds: parsedParents.candidates.map((candidate) => candidate.nodeId),
      })) : { ...ok(`node ${id} update failed`), isError: true };
    },
  };
}

export function createGetTraceGraphTool(deps: ToolDeps): SystemTool {
  return {
    name: "get_trace_graph",
    description:
      "Get the compact active Graph of Trace for curation. Returns concise node metadata and embedded causal parents only; use get_trace_node or get_trace_neighborhood for evidence details.",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      const graph = deps.trace.getGraphV2();
      const rootId = graph.meta.rootNodeId;
      const episodeTitles = new Map(graph.episodes.map((episode) => [episode.id, episode.title]));
      const activeIds = new Set(
        graph.nodes
          .filter((node) => !node.revoked && node.id !== rootId)
          .map((node) => node.id),
      );
      return ok(JSON.stringify({
        schemaVersion: graph.schemaVersion,
        revision: graph.revision,
        rootNodeId: rootId,
        episodes: graph.episodes.map((episode) => episode.title),
        nodes: graph.nodes
          .filter((node) => activeIds.has(node.id))
          .map((node) => ({
            id: node.id,
            title: node.title,
            ...(node.primaryEpisodeId && episodeTitles.has(node.primaryEpisodeId)
              ? { episode: episodeTitles.get(node.primaryEpisodeId) }
              : {}),
            type: node.type,
            status: node.status,
            ...(node.description
              ? { description: node.description.length > 400 ? `${node.description.slice(0, 399)}…` : node.description }
              : {}),
            confidence: node.confidence,
            reviewConclusion: node.reviewConclusion,
            updatedAt: node.updatedAt,
            parents: node.parents
              .filter((parent) =>
                parent.nodeId === rootId
                  ? parent.origin === "trace"
                  : activeIds.has(parent.nodeId)
              )
              .map((parent) => ({
                nodeId: parent.nodeId,
                conclusion: parent.conclusion,
                ...(parent.origin ? { origin: parent.origin } : {}),
                ...(parent.reason ? { reason: parent.reason } : {}),
              })),
          })),
      }));
    },
  };
}

/** Bounded trace readers shared by Principal, Trace, and Auditor as allowed below. */
export function createGetTraceNodeTool(deps: ToolDeps): SystemTool {
  return {
    name: "get_trace_node",
    description: "Read one Trace node with its official/candidate dependencies, semantic links, episode, and artifacts.",
    parameters: { type: "object", properties: { node_id: { type: "string" } }, required: ["node_id"] },
    execute: async (params) => {
      const detail = deps.trace.getNodeDetail(String(params.node_id ?? ""));
      return detail ? ok(cappedJson(detail)) : { ...ok("trace node not found"), isError: true };
    },
  };
}

export function createGetTraceNeighborhoodTool(deps: ToolDeps): SystemTool {
  return {
    name: "get_trace_neighborhood",
    description: "Read a bounded local Trace neighborhood around one node; use this instead of a full graph.",
    parameters: { type: "object", properties: { node_id: { type: "string" }, depth: { type: "number", minimum: 0, maximum: 4 } }, required: ["node_id"] },
    execute: async (params) => {
      const neighborhood = deps.trace.getNeighborhood(String(params.node_id ?? ""), typeof params.depth === "number" ? params.depth : 1);
      return neighborhood ? ok(cappedJson(neighborhood)) : { ...ok("trace node not found"), isError: true };
    },
  };
}

export function createGetTraceDiffTool(deps: ToolDeps): SystemTool {
  return {
    name: "get_trace_diff",
    description: "Read the latest checkpoint diff for one active Trace node, optionally limited to one path.",
    parameters: {
      type: "object",
      properties: { node_id: { type: "string" }, path: { type: "string" } },
      required: ["node_id"],
    },
    execute: async (params) => {
      if (!deps.checkpoints) return { ...ok("checkpoint store unavailable"), isError: true };
      const node = deps.trace.getNode(String(params.node_id ?? ""));
      if (!node || node.revoked) return { ...ok("trace node not found"), isError: true };
      const checkpoint = node.checkpoints?.at(-1);
      if (!checkpoint) return { ...ok("node has no checkpoint"), isError: true };
      if (typeof params.path === "string" && params.path) {
        return ok(await deps.checkpoints.diff(checkpoint.id, params.path) ?? "");
      }
      return ok(cappedJson(await deps.checkpoints.detail(checkpoint.id)));
    },
  };
}

export function createSearchTraceTool(deps: ToolDeps): SystemTool {
  return {
    name: "search_trace",
    description: "Search concise agent reports and node metadata in Trace; returns a bounded set of matching details.",
    parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number", minimum: 1, maximum: 100 } }, required: ["query"] },
    execute: async (params) => ok(cappedJson(deps.trace.search(String(params.query ?? ""), typeof params.limit === "number" ? params.limit : 12))),
  };
}

export function createSubmitAuditReportTool(deps: ToolDeps): SystemTool {
  return {
    name: "submit_audit_report",
    description: "Persist the completed audit for the user. This never notifies PI.",
    parameters: {
      type: "object",
      properties: {
        risk: { type: "string", enum: ["low", "medium", "high"] },
        summary: { type: "string" },
        report: { type: "string", description: "Complete Markdown audit report with concrete evidence." },
      },
      required: ["risk", "summary", "report"],
    },
    execute: async (params) => {
      if (params.risk !== "low" && params.risk !== "medium" && params.risk !== "high") {
        return { ...ok("invalid audit risk"), isError: true };
      }
      const summary = String(params.summary ?? "").trim();
      const reportBody = String(params.report ?? "").trim();
      if (!summary || !reportBody) return { ...ok("summary and report are required"), isError: true };
      const report = deps.trace.submitAuditReport({
        kind: "deliverable",
        risk: params.risk,
        summary,
        report: reportBody,
      });
      return ok(`audit report ${report.id} saved for the user`);
    },
  };
}

/**
 * All system tools, keyed by name.
 *
 * `toggles` is an OPTIONAL user-configured per-tool on/off table (loaded from
 * `<dataRoot>/bp_template/tool_toggles.json`). When a tool is disabled, we
 * omit it from the Map entirely so it never appears in any role's tool list —
 * the agent can't see it in its `tools` block and can't call it (Pi rejects
 * unknown tool names). When `toggles` is undefined or a given field is unset,
 * the tool is enabled (default-on for backwards compatibility). Only the three
 * user-facing Pi-native tools (skill_search, get_domain_knowledge_local,
 * search_papers_local) are toggleable — communication/orchestration/trace
 * primitives are unconditional (removing them would break §9 role contracts).
 */
export function allSystemTools(
  deps: ToolDeps,
  toggles?: ToolToggles | null,
): Map<string, SystemTool> {
  // Always-on tools (comms, orchestration, trace primitives).
  const tools: SystemTool[] = [
    createDispatchTaskTool(deps),
    createCompleteTaskTool(deps),
    createAskUserTool(deps),
    createCreateAgentTool(deps),
    createDestroyAgentTool(deps),
    createRecordTraceTool(deps),
    createTraceNodeTool(deps),
    createUpdateTraceNodeTool(deps),
    createGetTraceGraphTool(deps),
    createGetTraceNodeTool(deps),
    createGetTraceNeighborhoodTool(deps),
    createGetTraceDiffTool(deps),
    // Temporarily disabled: the current substring matcher is not reliable
    // enough to expose as an Agent tool. Keep the implementation above so it
    // can be re-enabled after tokenized/ranked search is implemented.
    // createSearchTraceTool(deps),
    createSubmitAuditReportTool(deps),
  ];
  if (deps.spawnSubagents) {
    tools.push(createSpawnSubagentTool(deps), createWaitSubagentTool(deps), createGetSubagentTool(deps), createCancelSubagentTool(deps), createListSubagentProfilesTool(deps));
  }
  if (deps.startMonitor && deps.listMonitors && deps.stopMonitor) {
    tools.push(createStartMonitorTool(deps), createListMonitorsTool(deps), createStopMonitorTool(deps));
  }
  if (deps.runInBackground && deps.listBackgroundJobs && deps.getBackgroundJob && deps.stopBackgroundJob) {
    tools.push(createRunInBackgroundTool(deps), createBackgroundJobTool(deps));
  }
  if (isToolEnabled(toggles, "skill_search")) {
    tools.push(createSkillSearchTool(deps));
  }
  // Local KB tools: powered by the KnowledgeBase/ directory (its scripts
  // build the store; here we just consume the on-disk artefacts plus an
  // auto-spawned bge sidecar). Both are no-op-safe when the KB hasn't
  // been built yet — they return a clear "build the KB first" error.
  if (isToolEnabled(toggles, "get_domain_knowledge_local")) {
    tools.push(createGetDomainKnowledgeLocalTool());
  }
  if (isToolEnabled(toggles, "search_papers_local")) {
    tools.push(createSearchPapersLocalTool());
  }
  return new Map(tools.map((t) => [t.name, t]));
}

/**
 * Per-agent system-tool access control (§9, ported from legacy
 * `agent_tool_config`). Returns the system tools a role may use. Built-in Pi
 * tools (read/bash/grep/...) are controlled separately via `builtinToolsForRole`.
 */
export const AGENT_TOOL_CONFIG: Record<string, string[]> = {
  // skill_search opens the router skill library (the long-tail domain catalog
  // not in <available_skills>). Trace is deliberately excluded: it is a
  // graph-only recorder, not a domain reasoner.
  principal: [
    "dispatch_task",
    "complete_task",
    "create_agent",
    "destroy_agent",
    "record_trace",
    "get_trace_graph",
    "get_trace_node",
    "get_trace_neighborhood",
    "get_trace_diff",
    "ask_user",
    "start_monitor",
    "list_monitors",
    "stop_monitor",
    "skill_search",
    "get_domain_knowledge_local",
    "search_papers_local",
  ],
  trace: [
    "create_trace_node",
    "update_trace_node",
    "get_trace_graph",
    "get_trace_node",
    "get_trace_neighborhood",
    // "search_trace", // temporarily disabled; see allSystemTools above
  ],
  expert: [
    "dispatch_task",
    "complete_task",
    "record_trace",
    "skill_search",
    "get_domain_knowledge_local",
    "search_papers_local",
  ],
  librarian: [
    "dispatch_task", "complete_task", "record_trace", "spawn_subagent", "wait_subagent", "get_subagent", "cancel_subagent", "list_subagent_profiles", "skill_search",
    "get_domain_knowledge_local", "search_papers_local",
  ],
  engineer: [
    "dispatch_task", "complete_task", "record_trace", "spawn_subagent", "wait_subagent", "get_subagent", "cancel_subagent", "list_subagent_profiles", "start_monitor", "list_monitors", "stop_monitor", "run_in_background", "background_job", "skill_search",
    "get_domain_knowledge_local", "search_papers_local",
  ],
  "autoresearch-worker": ["complete_task", "record_trace", "skill_search", "get_domain_knowledge_local", "search_papers_local"],
  experimentalist: [
    "dispatch_task", "complete_task", "record_trace", "spawn_subagent", "wait_subagent", "get_subagent", "cancel_subagent", "list_subagent_profiles", "start_monitor", "list_monitors", "stop_monitor", "run_in_background", "background_job", "skill_search",
    "get_domain_knowledge_local", "search_papers_local",
  ],
  // Auditor reviews scientific deliverables and has no GoT responsibilities.
  auditor: [
    "complete_task",
    "spawn_subagent",
    "wait_subagent",
    "get_subagent",
    "cancel_subagent",
    "list_subagent_profiles",
    "skill_search",
    "get_domain_knowledge_local",
    "search_papers_local",
  ],
  // Writer: needs ask_user to present format/style options before drafting.
  writer: [
    "dispatch_task",
    "complete_task",
    "record_trace",
    "spawn_subagent",
    "wait_subagent",
    "get_subagent",
    "cancel_subagent",
    "list_subagent_profiles",
    "ask_user",
    "skill_search",
    "get_domain_knowledge_local",
    "search_papers_local",
  ],
  // Default for any other expert-like agent.
  _default: [
    "dispatch_task",
    "complete_task",
    "record_trace",
    "skill_search",
    "get_domain_knowledge_local",
    "search_papers_local",
  ],
};

/**
 * Built-in Pi tool allowlist per role. Valid Pi builtin names:
 * `bash, edit, find, glob, grep, ls, read, write`.
 */
export const BUILTIN_TOOL_CONFIG: Record<string, string[]> = {
  // PI is the user-facing orchestrator: it must be able to inspect and touch the
  // workspace directly (read a file, run a quick check, make a small edit) for
  // the lightweight framing / synthesis its persona promises. Substantial domain
  // work is still delegated to experts — that's a persona discipline, not a tool
  // restriction. Previously `[]`, which made PI truthfully report it could not
  // read/write/bash, contradicting its own prompt.
  principal: ["read", "write", "edit", "bash", "grep", "find", "glob", "ls"],
  trace: ["read"],
  expert: ["read", "write", "grep", "find"],
  _default: ["read", "write", "grep", "find"],
};

/**
 * Per-agent-name builtin overrides, keyed by name (not role). Authoring agents
 * need write/edit + a shell; the research specialist keeps a lean no-shell set.
 * Falls through to BUILTIN_TOOL_CONFIG by role when a name has no entry.
 */
export const BUILTIN_TOOL_CONFIG_BY_NAME: Record<string, string[]> = {
  engineer: ["read", "write", "edit", "bash", "grep", "find", "glob", "ls"],
  "autoresearch-worker": ["read", "write", "edit", "bash", "grep", "find", "glob", "ls"],
  experimentalist: ["read", "write", "edit", "bash", "grep", "find", "glob", "ls"],
  writer: ["read", "write", "edit", "grep", "find", "glob", "ls"],
  librarian: ["read", "write", "grep", "find", "glob"],
  // Auditor evidence inspection remains read-only. `write` is limited by the
  // plugin contract to creating versioned reports under docs/audits/; there is
  // no general edit permission or separate report-submission tool.
  auditor: ["read", "write", "grep", "find", "glob", "bash"],
};

export function systemToolNamesForRole(role: AgentRole, agentName: string): string[] {
  // `trace` agent keyed by role; principal by role; experts share `_default`
  // unless a named override exists.
  if (role === "principal") return AGENT_TOOL_CONFIG.principal!;
  if (role === "trace") return AGENT_TOOL_CONFIG.trace!;
  return AGENT_TOOL_CONFIG[agentName] ?? AGENT_TOOL_CONFIG.expert ?? AGENT_TOOL_CONFIG._default!;
}

export function builtinToolNamesForRole(role: AgentRole, agentName?: string): string[] {
  // Principal and trace are role-scoped; experts may carry a per-name override
  // (e.g. engineer gets write+bash) before falling back to the role default.
  if (role === "expert" && agentName && BUILTIN_TOOL_CONFIG_BY_NAME[agentName]) {
    return BUILTIN_TOOL_CONFIG_BY_NAME[agentName]!;
  }
  return BUILTIN_TOOL_CONFIG[role] ?? BUILTIN_TOOL_CONFIG._default!;
}

export function systemToolsForRole(
  role: AgentRole,
  agentName: string,
  deps: ToolDeps,
  toggles?: ToolToggles | null,
): SystemTool[] {
  const allowed = new Set(systemToolNamesForRole(role, agentName));
  // Toggles filter INSIDE `allSystemTools`; if a role names a disabled tool,
  // the lookup misses and the filter drops it. Role config stays declarative
  // ("who is allowed") and orthogonal to physical availability ("does this
  // tool exist at all right now").
  const all = allSystemTools(deps, toggles);
  return [...allowed].map((n) => all.get(n)).filter((t): t is SystemTool => !!t);
}
