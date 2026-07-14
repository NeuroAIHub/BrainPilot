/**
 * usage-stats.ts — per-agent × per-run counters (tokens + tool + skill + errors).
 *
 * Sibling to token-usage accounting in `mas-agent.ts`: same "fold a delta into a
 * running total" shape, but for the whole `AgentStats` bag (tools, skills,
 * errors, plus the reused `TokenUsage`). Kept in its own module because
 * `mas-agent.ts` shouldn't grow another 80 lines of arithmetic, and because the
 * `SessionManager` needs the same helpers for cross-agent aggregation.
 *
 * Skill classification lives here too — `recordSkillCall(args)` maps
 * `skill_search` invocation args (see packages/runtime/src/tools/skill-search.ts)
 * to the `queries`/`loads`/`browses` counters, with a resilient fallback: args
 * that don't parse are charged to `"__search__"` so we never silently drop a
 * count.
 *
 * Nothing here talks to Pi or the EventBus; all inputs are POJOs and all outputs
 * are POJOs. That's what makes the delta arithmetic testable in isolation.
 */
import type {
  AgentStats,
  SessionStats,
  SkillCounter,
  SkillCounts,
  ToolCallCounts,
} from "@brainpilot/protocol";
import { emptyTokenUsage, addUsage } from "./mas-agent.js";

/**
 * Special counter key on `AgentStats.skills` for `skill_search` invocations
 * whose args did NOT commit to a named skill: pure keyword searches (`mode =
 * "query"` with only `keywords`), and args that failed to parse. This is the
 * one place counters can "aggregate up" — every other counter carries the real
 * name it observed on the wire.
 */
export const SKILL_SEARCH_KEY = "__search__";

/** Fresh empty skill counter — identity element for accumulation. */
export function emptySkillCounter(): SkillCounter {
  return { queries: 0, loads: 0, browses: 0 };
}

/** Fresh empty stats bag — identity element for accumulation. */
export function emptyAgentStats(): AgentStats {
  return {
    tokens: emptyTokenUsage(),
    tools: {},
    skills: {},
    errors: {},
  };
}

/**
 * Deep-clone an `AgentStats`. Used to snapshot the pre-run baseline so a
 * post-run subtraction yields the run's contribution without aliasing the
 * cumulative record.
 */
export function cloneAgentStats(s: AgentStats): AgentStats {
  return {
    tokens: { ...s.tokens },
    tools: { ...s.tools },
    skills: Object.fromEntries(
      Object.entries(s.skills).map(([k, v]) => [k, { ...v }]),
    ),
    errors: { ...s.errors },
  };
}

/**
 * Fold `delta` into `acc` in place, then return `acc`. Union of keys — a key
 * present only in `delta` starts from zero. Undefined `delta` is a no-op so
 * callers don't need to guard.
 */
export function addStatsDelta(acc: AgentStats, delta: AgentStats | undefined): AgentStats {
  if (!delta) return acc;
  addUsage(acc.tokens, {
    input: delta.tokens.input,
    output: delta.tokens.output,
    cacheRead: delta.tokens.cacheRead,
    cacheWrite: delta.tokens.cacheWrite,
  });
  // `addUsage` recomputes total from components, matching the SSOT rule in
  // mas-agent.ts: total is always input+output+cacheRead+cacheWrite, never
  // trusted from a caller. So the manual assign below is redundant, but kept
  // as a belt-and-braces guard against a future change to `addUsage`.
  acc.tokens.total = acc.tokens.input + acc.tokens.output + acc.tokens.cacheRead + acc.tokens.cacheWrite;
  addCounts(acc.tools, delta.tools);
  addCounts(acc.errors, delta.errors);
  for (const [name, sc] of Object.entries(delta.skills)) {
    const cur = acc.skills[name] ?? emptySkillCounter();
    cur.queries += sc.queries;
    cur.loads += sc.loads;
    cur.browses += sc.browses;
    acc.skills[name] = cur;
  }
  return acc;
}

/**
 * Return `a - b` as a new stats bag. Used to compute a run's contribution
 * (`cumulative_after - cumulative_before`). Never produces negative counters:
 * if a key would go negative (shouldn't happen given callers, but a
 * belt-and-braces guard against clock skew or restore-then-decrement bugs) it
 * is clamped to 0.
 */
export function subtractAgentStats(a: AgentStats, b: AgentStats): AgentStats {
  const out = emptyAgentStats();
  out.tokens.input = clamp0(a.tokens.input - b.tokens.input);
  out.tokens.output = clamp0(a.tokens.output - b.tokens.output);
  out.tokens.cacheRead = clamp0(a.tokens.cacheRead - b.tokens.cacheRead);
  out.tokens.cacheWrite = clamp0(a.tokens.cacheWrite - b.tokens.cacheWrite);
  out.tokens.total = out.tokens.input + out.tokens.output + out.tokens.cacheRead + out.tokens.cacheWrite;
  subCounts(out.tools, a.tools, b.tools);
  subCounts(out.errors, a.errors, b.errors);
  const skillKeys = new Set([...Object.keys(a.skills), ...Object.keys(b.skills)]);
  for (const k of skillKeys) {
    const ac = a.skills[k] ?? emptySkillCounter();
    const bc = b.skills[k] ?? emptySkillCounter();
    const q = clamp0(ac.queries - bc.queries);
    const l = clamp0(ac.loads - bc.loads);
    const br = clamp0(ac.browses - bc.browses);
    if (q || l || br) out.skills[k] = { queries: q, loads: l, browses: br };
  }
  return out;
}

/**
 * Parse a `skill_search` tool invocation's args and update `skills` in place.
 *
 * Rules (see spec §2):
 *   - `mode === "query"` + `skill_name` → `skills[skill_name].loads += 1`.
 *   - `mode === "query"` + `keywords` (no skill_name) → `skills["__search__"].queries += 1`.
 *   - `mode === "browse"` + `relative_path` → derive skill name from the path
 *     (`.../<skill>/SKILL.md`, else the last path segment) → `.browses += 1`.
 *   - Anything unparseable or that doesn't match a known sub-mode → charge to
 *     `skills["__search__"].queries` so counters are never silently dropped.
 *
 * Accepts args as an object (Pi's typed `.args`) OR a JSON-encoded string
 * (mock/legacy paths), matching how `tool_execution_start` events arrive.
 */
export function recordSkillCall(skills: SkillCounts, argsIn: unknown): void {
  const rec = skills;
  let parsed: Record<string, unknown> | undefined;
  try {
    if (typeof argsIn === "string" && argsIn.length > 0) {
      const p = JSON.parse(argsIn);
      if (p && typeof p === "object") parsed = p as Record<string, unknown>;
    } else if (argsIn && typeof argsIn === "object") {
      parsed = argsIn as Record<string, unknown>;
    }
  } catch {
    parsed = undefined;
  }
  if (!parsed) {
    bumpSkill(rec, SKILL_SEARCH_KEY, "queries");
    return;
  }
  const mode = typeof parsed.mode === "string" ? parsed.mode : "";
  const skillName = typeof parsed.skill_name === "string" ? parsed.skill_name.trim() : "";
  const keywords = typeof parsed.keywords === "string" ? parsed.keywords.trim() : "";
  const relPath = typeof parsed.relative_path === "string" ? parsed.relative_path : "";

  if (mode === "query" && skillName) {
    bumpSkill(rec, skillName, "loads");
    return;
  }
  if (mode === "query" && keywords) {
    bumpSkill(rec, SKILL_SEARCH_KEY, "queries");
    return;
  }
  if (mode === "browse" && relPath) {
    const derived = deriveSkillNameFromPath(relPath);
    bumpSkill(rec, derived, "browses");
    return;
  }
  // Unknown / malformed sub-mode — bucket to __search__ so we never lose the
  // fact that a skill_search call happened.
  bumpSkill(rec, SKILL_SEARCH_KEY, "queries");
}

/**
 * Given a router-relative path like `research/brainstorming/SKILL.md` or
 * `some_cat/foo/reference.md`, derive the best guess at the skill name (the
 * directory that contains the SKILL.md, or the last segment if unclear).
 */
function deriveSkillNameFromPath(p: string): string {
  const parts = p.split("/").filter((s) => s.length > 0);
  if (parts.length === 0) return SKILL_SEARCH_KEY;
  // If path ends in .md, the containing directory is the skill.
  const last = parts[parts.length - 1];
  if (last && last.toLowerCase().endsWith(".md") && parts.length >= 2) {
    return parts[parts.length - 2] as string;
  }
  return last as string;
}

function bumpSkill(rec: Record<string, SkillCounter>, name: string, field: keyof SkillCounter): void {
  const cur = rec[name] ?? emptySkillCounter();
  cur[field] = cur[field] + 1;
  rec[name] = cur;
}

function addCounts(acc: ToolCallCounts, delta: ToolCallCounts | undefined): void {
  if (!delta) return;
  for (const [k, v] of Object.entries(delta)) acc[k] = (acc[k] ?? 0) + v;
}

function subCounts(out: ToolCallCounts, a: ToolCallCounts, b: ToolCallCounts): void {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const diff = clamp0((a[k] ?? 0) - (b[k] ?? 0));
    if (diff > 0) out[k] = diff;
  }
}

function clamp0(n: number): number {
  return n < 0 ? 0 : n;
}

/* ------------------------------------------------------------------ *
 * SessionStats aggregation (used by SessionManager)
 * ------------------------------------------------------------------ */

/** Fresh empty per-session stats — identity element. */
export function emptySessionStats(sessionId: string): SessionStats {
  return {
    sessionId,
    total: emptyAgentStats(),
    byAgent: {},
    byRun: [],
  };
}

/**
 * Rebuild the session's `total` by folding every agent's cumulative stats in.
 * Used both after `byRun` mutations and when producing a wire snapshot.
 */
export function recomputeSessionTotal(s: SessionStats): void {
  const total = emptyAgentStats();
  for (const stats of Object.values(s.byAgent)) {
    addStatsDelta(total, stats);
  }
  s.total = total;
}
