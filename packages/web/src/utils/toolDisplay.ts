/**
 * Presentation helpers for the tool-activity block (#84).
 *
 * The runtime namespaces MCP tools as `mcp__<server>__<tool>` (see
 * packages/runtime/src/mcp-bridge.ts) to avoid collisions, and tool
 * args/results arrive as already-encoded JSON strings. Surfacing those raw in
 * the chat UI reads like debug output:
 *   - `mcp__bp_skills__skills_tool` instead of a friendly name, and
 *   - payloads double-encoded into `\"key\": \"value\"` walls of backslashes.
 *
 * These helpers are display-only — the raw name/payload stays available for
 * copying and debugging; nothing here touches the wire protocol.
 */

/**
 * Friendly tool name. `mcp__<server>__<tool>` collapses to `<server> · <tool>`;
 * any other name (built-in tools, already-friendly names) is returned as-is.
 *
 * The MCP prefix split is intentionally lenient: a server or tool segment may
 * itself contain single underscores, so we split on the literal `mcp__` prefix
 * and the FIRST `__` separator after the server name.
 */
export function formatToolName(raw: string | undefined | null): string {
  if (!raw) return "tool";
  if (!raw.startsWith("mcp__")) return raw;
  const rest = raw.slice("mcp__".length);
  const sep = rest.indexOf("__");
  if (sep <= 0 || sep >= rest.length - 2) {
    // Malformed (no tool segment) — show the un-prefixed remainder rather than
    // the raw mcp__ identifier.
    return rest || raw;
  }
  const server = rest.slice(0, sep);
  const tool = rest.slice(sep + 2);
  return `${server} · ${tool}`;
}

/**
 * Pretty-print a tool payload without double-escaping. Tool args/results are
 * accumulated as JSON strings over TOOL_CALL_ARGS deltas; calling
 * JSON.stringify on an already-stringified value yields a `\"`-littered wall.
 *
 * Strategy:
 *   - string that parses as JSON  → parse, then pretty-print the value;
 *   - string that does NOT parse  → return verbatim (plain text / partial);
 *   - anything else (object/etc.) → pretty-print directly.
 *
 * Returns "" for null/undefined so callers can skip empty <pre> blocks.
 */
export function formatPayload(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return "";
    // Only attempt a parse when it looks like JSON — avoids turning a bare
    // number/quoted word into a reformatted value users didn't write.
    const looksJson =
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"));
    if (looksJson) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        return value;
      }
    }
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
