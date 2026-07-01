import type { ChatMessage } from "../../contracts/backend";

/**
 * "Running script" panel data model (pure, no React).
 *
 * The composer's toast tells the user *which agent* is thinking, and the
 * message stream's activity block shows the *history* of every reasoning /
 * tool step. Neither surfaces the piece users most often ask for: "what
 * shell command is running right now, and can I stop it?"
 *
 * A "script" here is a tool call whose kind is `tool`, whose name resolves
 * to `bash` (bare or mcp-namespaced), and whose `streaming` flag is still
 * true — i.e. TOOL_CALL_START has arrived but TOOL_CALL_END has not. Once
 * the end event lands, the reducer clears `streaming`, the row falls off
 * this list, and the panel collapses when the last one leaves.
 *
 * Restricting to bash on purpose: filesystem reads/greps/edits are cheap
 * and finish fast, so listing them would just add noise. Long-running
 * work — pytest, wget, training loops — flows through bash.
 */

/**
 * Match a tool name against the bash tool, whether it arrived bare
 * (Pi's built-in) or namespaced (`mcp__<server>__bash` from a bridged MCP
 * server). Mirrors the bare-name extraction used by `isInternalToolName`
 * in messageGroups.ts so the two visibility filters stay consistent.
 */
export function isBashTool(name: string | undefined): boolean {
  if (!name) return false;
  if (name === "bash") return true;
  const bare = name.includes("__") ? name.slice(name.lastIndexOf("__") + 2) : name;
  return bare === "bash";
}

/**
 * Best-effort extraction of the shell command from the tool call args.
 *
 * The reducer feeds `TOOL_CALL_ARGS` deltas verbatim into `toolInput` as a
 * string, so once enough of the JSON has arrived we get `{"command": "..."}`
 * (or `cmd`, depending on the runtime). While the JSON is still partial we
 * just show the raw fragment — better than nothing, and it stops flickering
 * once the delta stream completes.
 */
export function extractCommand(toolInput: unknown): string {
  if (typeof toolInput !== "string" || toolInput.length === 0) return "";
  const trimmed = toolInput.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      for (const key of ["command", "cmd", "script", "shell"]) {
        const value = obj[key];
        if (typeof value === "string" && value.length > 0) return value;
      }
    }
  } catch {
    // Partial JSON while args are still streaming — fall through.
  }
  return trimmed;
}

/** A bash tool call that is still executing. */
export interface ActiveScript {
  id: string;
  agent: string;
  toolName: string;
  command: string;
  /** Raw arg string as seen so far — useful for a debug/details view. */
  rawInput: string;
}

/**
 * Distil the flat message log down to the bash calls still in flight, in
 * arrival order. Everything else — text, thinking, non-bash tools, completed
 * bash calls — is filtered out. Callers can trigger the panel purely off
 * `result.length > 0`.
 */
export function selectActiveScripts(messages: ChatMessage[]): ActiveScript[] {
  const out: ActiveScript[] = [];
  for (const m of messages) {
    if (m.kind !== "tool") continue;
    if (!m.streaming) continue;
    if (!isBashTool(m.toolName)) continue;
    out.push({
      id: m.id,
      agent: m.agent ?? "principal",
      toolName: m.toolName ?? "bash",
      command: extractCommand(m.toolInput),
      rawInput: typeof m.toolInput === "string" ? m.toolInput : "",
    });
  }
  return out;
}
