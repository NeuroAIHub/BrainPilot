/**
 * managed-path-guard — Pi extension that rewrites logical managed prefixes
 * (`/workspace`, `/data`, …) onto durable volume roots before tool execution
 * (#346). Also confines write/edit to the session workspace and persistent
 * library so ephemeral container paths cannot silently swallow deliverables.
 *
 * Uses Pi's `tool_call` hook: `event.input` is mutated in place (official API).
 * Register BEFORE router-skill-guard so #309 sees post-rewrite paths.
 */
import {
  applyManagedPathToolCall,
  type ManagedPathRoots,
} from "../managed-path-rewrite.js";

/** Minimal structural surface of Pi's ExtensionAPI we depend on. */
export interface ManagedPathGuardApi {
  on(
    event: "tool_call",
    handler: (
      e: { toolName: string; toolCallId?: string; input: Record<string, unknown> },
    ) => { block?: boolean; reason?: string } | void | Promise<{ block?: boolean; reason?: string } | void>,
  ): void;
}

export interface ManagedPathGuardOpts {
  roots: ManagedPathRoots;
}

/**
 * Build a Pi extension factory that rewrites/confines managed paths on every
 * tool_call. Closure-captured roots are fixed at agent creation (same lifetime
 * as cwd / session workspace).
 */
export function makeManagedPathGuardExt(
  opts: ManagedPathGuardOpts,
): (pi: ManagedPathGuardApi) => void {
  return (pi) => {
    pi.on("tool_call", (event) => {
      return applyManagedPathToolCall({
        toolName: event.toolName,
        input: (event.input ?? {}) as Record<string, unknown>,
        roots: opts.roots,
      });
    });
  };
}
