/**
 * router-skill-guard — Pi extension that hard-denies access to the router skill
 * library when `skill_search` is disabled (#309).
 *
 * Uses Pi's `tool_call` hook (fires before tool execution) and returns
 * `{ block: true, reason }` so structured file tools (read/ls/find/grep/edit/
 * write) and best-effort bash cannot load `bp_template/skills-router`.
 *
 * Registered only when enforcement is on; when `enforce` is false the factory
 * still returns a no-op extension so the call site stays uniform.
 */
import {
  shouldBlockToolCall,
} from "../router-skill-access.js";

/** Minimal structural surface of Pi's ExtensionAPI we depend on. */
export interface RouterSkillGuardApi {
  on(
    event: "tool_call",
    handler: (
      e: { toolName: string; toolCallId?: string; input: Record<string, unknown> },
    ) => { block?: boolean; reason?: string } | void | Promise<{ block?: boolean; reason?: string } | void>,
  ): void;
}

export interface RouterSkillGuardOpts {
  /** Absolute path to `<dataRoot>/bp_template/skills-router`. */
  routerSkillsDir: string;
  /** Agent cwd (session workspace) for resolving relative paths. */
  cwd: string;
  /**
   * When false the extension registers nothing (skill_search is enabled).
   * When true every file-tool path under `routerSkillsDir` is blocked.
   */
  enforce: boolean;
}

/**
 * Build a Pi extension factory that blocks router-skill paths when enforce is
 * true. Closure-captured opts are fixed at agent creation (same lifetime as the
 * tool list — flip takes effect on the next new session / expert spawn).
 */
export function makeRouterSkillGuardExt(
  opts: RouterSkillGuardOpts,
): (pi: RouterSkillGuardApi) => void {
  return (pi) => {
    if (!opts.enforce) return;
    pi.on("tool_call", (event) => {
      const reason = shouldBlockToolCall({
        toolName: event.toolName,
        input: (event.input ?? {}) as Record<string, unknown>,
        routerSkillsDir: opts.routerSkillsDir,
        cwd: opts.cwd,
      });
      if (reason) {
        return { block: true, reason };
      }
    });
  };
}
