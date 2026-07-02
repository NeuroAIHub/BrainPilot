import { ChatMessage } from "../contracts/backend";

/**
 * A unit of rendering in the chat stream. Either a single standalone message
 * (user prompt, assistant text, error, hook note), an "activity" group that
 * folds adjacent reasoning and tool calls/results into one collapsible block,
 * or (#219) an "expertGroup" that folds a run of non-PI (specialist) agent
 * render items behind one more level of disclosure so the PI narrative reads
 * cleanly by default. An expertGroup nests already-built single/activity items
 * so the reasoning/tool folds inside it are preserved when expanded.
 */
export type RenderItem =
  | { type: "single"; message: ChatMessage }
  | { type: "activity"; id: string; steps: ChatMessage[]; streaming: boolean }
  | { type: "expertGroup"; id: string; agents: string[]; items: RenderItem[]; streaming: boolean };

/**
 * #134 — tool visibility model. Internal tools are part of the agent's plumbing
 * (trace bookkeeping) rather than the user-facing conversation: the model still
 * sees their calls and results, but the chat UI hides both so an implementation
 * detail (`trace event dispatched`) never surfaces above the Principal's reply.
 * Trace changes are surfaced quietly via the Trace tab badge instead.
 *
 * Hard-coded for the current internal toolset; promote to a richer
 * `ToolVisibility = "user" | "debug" | "internal"` map if/when more land.
 */
const INTERNAL_TOOL_NAMES: ReadonlySet<string> = new Set([
  "record_trace",
  "create_trace_node",
  "update_trace_node",
  "add_trace_relation",
  "get_trace_graph",
]);

/** A tool name is internal if it matches bare or mcp-namespaced (server__tool). */
export function isInternalToolName(name: string | undefined): boolean {
  if (!name) return false;
  if (INTERNAL_TOOL_NAMES.has(name)) return true;
  const bare = name.includes("__") ? name.slice(name.lastIndexOf("__") + 2) : name;
  return INTERNAL_TOOL_NAMES.has(bare);
}

/**
 * Drop internal-tool calls AND their matching results from the chat stream.
 *
 * A TOOL_CALL_START carries the tool name; the later TOOL_CALL_RESULT carries
 * only a `toolCallId` linking back to it. So we first collect the call ids of
 * every internal tool, then filter out both the call message and any tool
 * message whose `toolCallId` (the result) points at one. Presentation-only:
 * the underlying message list and the model's view are untouched.
 */
export function stripInternalToolMessages(messages: ChatMessage[]): ChatMessage[] {
  const internalCallIds = new Set<string>();
  for (const m of messages) {
    if (m.kind === "tool" && isInternalToolName(m.toolName)) {
      internalCallIds.add(m.id);
      if (m.toolCallId) internalCallIds.add(m.toolCallId);
    }
  }
  if (internalCallIds.size === 0) return messages;
  return messages.filter((m) => {
    if (m.kind !== "tool") return true;
    // The call itself (internal tool name) → drop.
    if (isInternalToolName(m.toolName)) return false;
    // The result, linked by toolCallId to an internal call → drop.
    if (m.toolCallId && internalCallIds.has(m.toolCallId)) return false;
    return true;
  });
}

/**
 * Standalone kinds render as their own visible card. All assistant text
 * messages — whether they come from the Principal or an Expert agent, and
 * whether they are an intermediate utterance or the turn's final answer —
 * stay standalone so the formal conversation is never hidden behind the
 * "思考过程" fold. Only reasoning (`thinking`) and tool calls/results fold
 * into activity blocks.
 */
function isStandalone(message: ChatMessage): boolean {
  if (message.role === "user") return true;
  if (message.kind === "error" || message.kind === "status" || message.kind === "hook") return true;
  // 修正6 — new-UI kinds each render as their own standalone card.
  if (message.kind === "system_message" || message.kind === "ask_user" || message.kind === "auto_retry") return true;
  if (message.role === "assistant" && (message.kind === "text" || message.kind === undefined)) return true;
  if (message.role === "system" && (message.kind === "text" || message.kind === undefined)) return true;
  return false;
}

/**
 * Transform the flat message list into render items. Adjacent reasoning and
 * tool steps fold into a single activity group; everything else renders
 * standalone. The activity group id is its first step's id so the native
 * <details> DOM node is reused across re-renders, preserving the user's
 * expand/collapse toggle without explicit React state.
 *
 * `runningAgents` is the authoritative set of agent names whose run is still
 * active (RUN_STARTED..RUN_FINISHED, sourced from `session_state`). An activity
 * block is "in progress" if any of its steps is still streaming OR its owning
 * agent's run is still active. Without this, the per-message `streaming` flags
 * all go false between ReAct rounds (each message's END clears it), so the
 * block would flash "思考过程 · N 步" (done) in the gap before the next round —
 * AG-UI explicitly warns against treating a message/tool END as run completion.
 * Omitting `runningAgents` (e.g. demo replay, where messages are already
 * terminal) preserves the original streaming-flag-only behavior.
 */
export function buildRenderItems(
  messages: ChatMessage[],
  runningAgents?: ReadonlySet<string>,
  groupExpert = false,
): RenderItem[] {
  const items: RenderItem[] = [];
  // #134 — internal tools (trace bookkeeping) are hidden from the chat UI.
  messages = stripInternalToolMessages(messages);
  let buffer: ChatMessage[] = [];
  // A step keeps its block "in progress" while its owning agent's run is active.
  // Steps default to the principal agent when unattributed, matching how the
  // reducer/UI fall back elsewhere.
  const agentActive = (s: ChatMessage) => runningAgents?.has(s.agent ?? "principal") ?? false;
  const flush = () => {
    if (buffer.length === 0) return;
    items.push({
      type: "activity",
      id: buffer[0].id,
      steps: buffer,
      streaming: buffer.some((s) => s.streaming || agentActive(s)),
    });
    buffer = [];
  };
  for (const m of messages) {
    if (isStandalone(m)) {
      flush();
      items.push({ type: "single", message: m });
    } else {
      buffer.push(m);
    }
  }
  flush();
  // #219 — second pass: fold consecutive specialist (non-PI) items into
  // collapsible expert groups. Off by default (demo replay / legacy callers).
  return groupExpert ? groupExpertItems(items, runningAgents) : items;
}

/* -------------------------------------------------------------------------- *
 * #219 — expert-agent activity grouping.
 * -------------------------------------------------------------------------- */

/** The principal (PI) agent name; unattributed items default to it. */
const PRINCIPAL = "principal";

/**
 * Important events stay visible even when they come from a specialist agent —
 * they must never be buried inside a collapsed group (issue #219 UX goal:
 * "avoid hiding important failures, blockers, or user-action-required events").
 * Errors, approval/user-input requests, and warning+ system messages / hooks
 * escape grouping and render standalone.
 */
function isImportantEvent(message: ChatMessage): boolean {
  if (message.kind === "error" || message.kind === "ask_user") return true;
  if (message.kind === "system_message") {
    const level = message.systemMessage?.level;
    return level === "warning" || level === "error" || level === "fatal";
  }
  if (message.kind === "hook") {
    return message.hookLevel === "warning" || message.hookLevel === "error";
  }
  return false;
}

/** Owning agent of a render item: the message's agent, or the activity's first step. */
function itemAgent(item: RenderItem): string {
  if (item.type === "single") return item.message.agent ?? PRINCIPAL;
  if (item.type === "activity") return item.steps[0]?.agent ?? PRINCIPAL;
  return PRINCIPAL;
}

/**
 * A render item is a foldable specialist item when it belongs to a non-PI agent
 * AND (for singles) is not an important event that must stay surfaced. User
 * prompts and PI/unattributed items always break the run.
 */
function isFoldableExpertItem(item: RenderItem): boolean {
  if (itemAgent(item) === PRINCIPAL) return false;
  if (item.type === "single") {
    if (item.message.role === "user") return false;
    if (isImportantEvent(item.message)) return false;
  }
  return true;
}

function itemStreaming(item: RenderItem, runningAgents?: ReadonlySet<string>): boolean {
  if (item.type === "activity") return item.streaming;
  if (item.type === "single") {
    return !!item.message.streaming || (runningAgents?.has(itemAgent(item)) ?? false);
  }
  return false;
}

/** Fold consecutive foldable specialist items into one expertGroup each. */
function groupExpertItems(items: RenderItem[], runningAgents?: ReadonlySet<string>): RenderItem[] {
  const out: RenderItem[] = [];
  let run: RenderItem[] = [];
  const flushRun = () => {
    if (run.length === 0) return;
    // A lone expert `activity` item is already collapsed on its own — wrapping
    // it in a second disclosure level just makes the user click twice. Leave it.
    // A lone expert `single` (standalone text) still gets grouped so specialist
    // chatter is collapsed by default (issue #219 acceptance criteria).
    if (run.length === 1 && run[0].type === "activity") {
      out.push(run[0]);
      run = [];
      return;
    }
    const agents = Array.from(new Set(run.map(itemAgent)));
    out.push({
      type: "expertGroup",
      id: `expert-${idOf(run[0])}`,
      agents,
      items: run,
      streaming: run.some((it) => itemStreaming(it, runningAgents)),
    });
    run = [];
  };
  for (const item of items) {
    if (isFoldableExpertItem(item)) {
      run.push(item);
    } else {
      flushRun();
      out.push(item);
    }
  }
  flushRun();
  return out;
}

/** Stable id for a render item (drives <details> DOM reuse across re-renders). */
function idOf(item: RenderItem): string {
  if (item.type === "single") return item.message.id;
  return item.id;
}
