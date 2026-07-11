/**
 * Per-tool on/off switches for the three Pi-native SystemTools whose exposure
 * to agents is user-controllable from Settings → 工具:
 *
 *   - skill_search
 *   - get_domain_knowledge_local
 *   - search_papers_local
 *
 * Persisted at `<dataRoot>/bp_template/tool_toggles.json` in the same
 * layout family as `mcp_servers.json` / `providers.json`. The backend-core
 * routes write to this file; the runtime reads it here.
 *
 * Contract:
 *   - Missing file / missing field / unparseable JSON → treat as `true`
 *     (all tools enabled). Zero-overhead default: users who never open the
 *     panel see no behavior change.
 *   - Unknown keys in the JSON are silently ignored — the shape is a strict
 *     union over the three tool names, not an arbitrary map, so a
 *     hand-edited typo can't accidentally disable a random built-in.
 *   - Boolean-valued only. Anything else (string, number, null) is treated
 *     as "no signal" and falls back to the default `true` — matches the
 *     wider "malformed config never breaks the runtime" philosophy.
 *
 * Read model: cold read once per SessionManager lifetime (like
 * `loadMcpServersConfig`). Restart the runtime to make a toggle change take
 * effect on all sessions; a new session created after the change also picks
 * up the new value on its first `ensureAgent`.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The exhaustive list of user-controllable Pi-native tool names. */
export const TOGGLEABLE_TOOL_NAMES = [
  "skill_search",
  "get_domain_knowledge_local",
  "search_papers_local",
] as const;

export type ToggleableToolName = (typeof TOGGLEABLE_TOOL_NAMES)[number];

/**
 * Toggle state. Every field is optional so a partial file / patch is legal;
 * missing fields fall back to `true` at the read site (see `isToolEnabled`).
 */
export type ToolToggles = Partial<Record<ToggleableToolName, boolean>>;

/**
 * `undefined` → enabled (default-on). Only an explicit `false` disables.
 * Any non-boolean value (a hand-edited `"off"` string, `null`, etc.) is
 * likewise treated as "no signal" and enables the tool, so a malformed
 * config can't silently disable a built-in.
 */
export function isToolEnabled(
  toggles: ToolToggles | null | undefined,
  name: ToggleableToolName,
): boolean {
  const v = toggles?.[name];
  if (v === false) return false;
  return true;
}

/**
 * Load `tool_toggles.json` from the data root. Looks under `bp_template/`
 * only (this file has no legacy `.bp/` fallback — it's a new feature so we
 * don't need to keep two search paths in sync). Returns `null` when absent
 * or unparseable, which the caller treats as "all enabled".
 */
export async function loadToolToggles(dataRoot: string): Promise<ToolToggles | null> {
  const path = join(dataRoot, "bp_template", "tool_toggles.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const src = parsed as Record<string, unknown>;
  const out: ToolToggles = {};
  for (const name of TOGGLEABLE_TOOL_NAMES) {
    const v = src[name];
    if (typeof v === "boolean") out[name] = v;
    // any non-boolean → leave undefined, isToolEnabled will default to true
  }
  return out;
}
