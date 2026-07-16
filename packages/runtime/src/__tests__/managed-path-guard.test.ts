/**
 * #346 — managed-path-guard extension rewrites / blocks tool_call events.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { makeManagedPathGuardExt } from "../extensions/managed-path-guard.js";
import { denyEphemeralWriteReason } from "../managed-path-rewrite.js";

const cwd = resolve("/root/.bp-root/workspaces/s1");
const persistentDir = resolve("/root/.bp-root/data");

type ToolCallHandler = (e: {
  toolName: string;
  input: Record<string, unknown>;
}) => { block?: boolean; reason?: string } | void;

function install(): ToolCallHandler {
  let handler: ToolCallHandler | null = null;
  const ext = makeManagedPathGuardExt({
    roots: { cwd, persistentDir },
  });
  ext({
    on(_event, h) {
      handler = h as ToolCallHandler;
    },
  });
  if (!handler) throw new Error("expected tool_call handler");
  return handler;
}

describe("makeManagedPathGuardExt", () => {
  it("rewrites write /workspace onto the session workspace", () => {
    const handler = install();
    const input: Record<string, unknown> = {
      path: "/workspace/foo.txt",
      content: "hello",
    };
    expect(handler({ toolName: "write", input })).toBeUndefined();
    expect(input.path).toBe("foo.txt");
  });

  it("blocks ephemeral write targets", () => {
    const handler = install();
    const input: Record<string, unknown> = { path: "/tmp/x", content: "x" };
    expect(handler({ toolName: "write", input })).toEqual({
      block: true,
      reason: denyEphemeralWriteReason("/tmp/x"),
    });
  });

  it("rewrites bash commands that use /workspace", () => {
    const handler = install();
    const input: Record<string, unknown> = {
      command: "mkdir -p /workspace/demo",
    };
    expect(handler({ toolName: "bash", input })).toBeUndefined();
    expect(String(input.command)).toBe(`mkdir -p ${cwd}/demo`);
  });
});
