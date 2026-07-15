/**
 * Path-boundary helpers for #309: when `skill_search` is disabled, agents must
 * not reach the router skill library (`bp_template/skills-router`) via generic
 * file tools. These pure functions feed the Pi `tool_call` guard extension and
 * are unit-tested independently of the agent loop.
 */
import { isAbsolute, normalize, resolve, sep } from "node:path";

/** Stable deny message shown to the model when a path hits the router root. */
export function denyRouterSkillsReason(): string {
  return (
    "Router skill library is disabled (skill_search is off). " +
    "The long-tail skills under bp_template/skills-router are not accessible. " +
    "Always-on Meta-Skills under bp_template/skills remain available via <available_skills> and read."
  );
}

/**
 * Resolve a candidate path (relative or absolute) against cwd, then ask whether
 * it lies at or under `routerSkillsDir`. Traversal via `..` is handled by
 * `resolve`. Comparison is path-based (not substring), so a workspace folder
 * coincidentally named `skills-router` is only denied when it is the same
 * absolute tree as the configured router root.
 */
export function isUnderRouterSkillsDir(
  candidate: string,
  routerSkillsDir: string,
  cwd?: string,
): boolean {
  if (!candidate || !routerSkillsDir) return false;
  const base = normalize(resolve(routerSkillsDir));
  const target = normalize(
    cwd !== undefined && cwd !== "" && !isAbsolute(candidate)
      ? resolve(cwd, candidate)
      : resolve(candidate),
  );
  if (target === base) return true;
  // Ensure we only match a full path segment boundary (base + sep + ...).
  const prefix = base.endsWith(sep) ? base : base + sep;
  return target.startsWith(prefix);
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Collect path-like arguments from a Pi builtin (or compatible) tool call.
 * Field names match Pi v0.79 schemas: read/edit/write require `path`;
 * ls/find/grep take optional `path` (default cwd — not included when absent,
 * because cwd is the session workspace and never the router dir by construction).
 * Also accepts `file_path` for defensive compatibility with older call shapes.
 */
export function pathsFromToolCall(
  toolName: string,
  input: Record<string, unknown> | null | undefined,
  _cwd: string,
): string[] {
  if (!input || typeof input !== "object") return [];
  const name = toolName.toLowerCase();
  // Tools that never carry a filesystem path argument for this guard.
  if (name === "bash" || name === "skill_search") return [];

  const paths: string[] = [];
  const push = (v: unknown) => {
    const s = asString(v);
    if (s) paths.push(s);
  };

  // Primary field for all Pi path tools.
  push(input.path);
  // Defensive aliases seen in some agent call shapes / telemetry.
  push(input.file_path);
  push(input.filePath);

  return paths;
}

/**
 * Best-effort check that a bash command string appears to touch the router
 * skill directory. Not a full shell parser — `$var` expansion, soft links, and
 * encoding tricks can bypass this. The hard guarantee is on structured tools
 * (read/ls/find/grep/edit/write); bash is defense-in-depth only.
 */
export function bashTouchesRouterSkills(
  command: string,
  routerSkillsDir: string,
): boolean {
  if (!command || !routerSkillsDir) return false;
  const abs = normalize(resolve(routerSkillsDir));
  // Normalize both sides to POSIX separators so Windows paths in a bash-like
  // command string still match when the model uses forward slashes.
  const absPosix = abs.split(sep).join("/");
  const cmd = command.split("\\").join("/");
  if (cmd.includes(absPosix)) return true;
  // Also catch the stable relative tail when the model lists from data root.
  if (cmd.includes("bp_template/skills-router")) return true;
  return false;
}

/**
 * Decide whether a tool call must be blocked when the router guard is active.
 * Returns a reason string when blocked, or null when allowed.
 */
export function shouldBlockToolCall(opts: {
  toolName: string;
  input: Record<string, unknown> | null | undefined;
  routerSkillsDir: string;
  cwd: string;
}): string | null {
  const { toolName, input, routerSkillsDir, cwd } = opts;
  const name = toolName.toLowerCase();

  if (name === "bash") {
    const command = asString(input?.command) ?? "";
    if (bashTouchesRouterSkills(command, routerSkillsDir)) {
      return denyRouterSkillsReason();
    }
    return null;
  }

  for (const p of pathsFromToolCall(toolName, input, cwd)) {
    if (isUnderRouterSkillsDir(p, routerSkillsDir, cwd)) {
      return denyRouterSkillsReason();
    }
  }
  return null;
}
