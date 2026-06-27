import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  systemToolNamesForRole,
  systemToolsForRole,
  builtinToolNamesForRole,
  type ToolDeps,
} from "../tools/system-tools.js";
import { Mailbox } from "../mailbox.js";
import { GraphOfTrace } from "../trace.js";

function deps(name: string): ToolDeps {
  return {
    sessionId: "s",
    fromAgent: name,
    mailbox: new Mailbox("s"),
    trace: new GraphOfTrace("s"),
    ensureAgent: async () => {},
    destroyAgent: async () => {},
    wakeAgent: () => {},
    requestUserInput: async () => "stub-answer",
    // Field is required by ToolDeps but the access-control tests never read
    // it. Use the OS tmpdir so the path is at least well-formed on Windows
    // (where `/tmp/...` is not a real directory) if a future change starts
    // exercising it. (#8 — cross-platform pass.)
    routerSkillsDir: join(tmpdir(), "bp-test-router"),
  };
}

describe("tool access control (§9)", () => {
  it("principal gets comms + record_trace, not graph mutation tools", () => {
    const names = systemToolNamesForRole("principal", "principal");
    expect(names).toEqual(expect.arrayContaining(["send_message", "create_agent", "destroy_agent", "record_trace"]));
    expect(names).not.toContain("create_trace_node");
    expect(names).not.toContain("get_trace_graph");
  });

  it("principal can ask_user; experts and trace cannot", () => {
    expect(systemToolNamesForRole("principal", "principal")).toContain("ask_user");
    expect(systemToolNamesForRole("expert", "librarian")).not.toContain("ask_user");
    expect(systemToolNamesForRole("trace", "trace")).not.toContain("ask_user");
  });

  it("trace agent gets ONLY graph tools", () => {
    const names = systemToolNamesForRole("trace", "trace");
    expect(names.sort()).toEqual(
      ["add_trace_relation", "create_trace_node", "get_trace_graph", "update_trace_node"].sort(),
    );
    expect(names).not.toContain("send_message");
    expect(names).not.toContain("create_agent");
  });

  it("expert gets send_message + record_trace + skill_search", () => {
    const names = systemToolNamesForRole("expert", "librarian");
    expect(names.sort()).toEqual(["record_trace", "send_message", "skill_search"].sort());
    expect(names).not.toContain("create_agent");
  });

  it("skill_search reaches every non-trace role (router-skill discovery)", () => {
    expect(systemToolNamesForRole("principal", "principal")).toContain("skill_search");
    expect(systemToolNamesForRole("expert", "librarian")).toContain("skill_search");
    expect(systemToolNamesForRole("expert", "writer")).toContain("skill_search");
    expect(systemToolNamesForRole("expert", "auditor")).toContain("skill_search");
    expect(systemToolNamesForRole("expert", "statistician")).toContain("skill_search");
    // Trace is graph-only — no skill discovery surface.
    expect(systemToolNamesForRole("trace", "trace")).not.toContain("skill_search");
  });

  it("resolves the actual SystemTool objects for a role (filtered)", () => {
    const tools = systemToolsForRole("trace", "trace", deps("trace"));
    const toolNames = tools.map((t) => t.name).sort();
    expect(toolNames).toEqual(
      ["add_trace_relation", "create_trace_node", "get_trace_graph", "update_trace_node"].sort(),
    );
  });

  it("builtin tool allowlist differs by role", () => {
    // PI gets the full builtin set so it can inspect/touch the workspace directly
    // (its persona promises file inspection + "just do X"); it is no longer `[]`.
    expect(builtinToolNamesForRole("principal")).toEqual(
      expect.arrayContaining(["read", "write", "edit", "bash", "grep", "find"]),
    );
    expect(builtinToolNamesForRole("expert")).toContain("read");
    expect(builtinToolNamesForRole("trace")).toEqual(["read"]);
  });

  it("authoring experts get write + bash builtins by name", () => {
    const eng = builtinToolNamesForRole("expert", "engineer");
    expect(eng).toEqual(expect.arrayContaining(["read", "write", "edit", "bash"]));
    const exp = builtinToolNamesForRole("expert", "experimentalist");
    expect(exp).toEqual(expect.arrayContaining(["write", "bash"]));
  });

  it("writer can write but not run a shell", () => {
    const w = builtinToolNamesForRole("expert", "writer");
    expect(w).toContain("write");
    expect(w).not.toContain("bash");
  });

  it("librarian stays read-only (no write/bash)", () => {
    const lib = builtinToolNamesForRole("expert", "librarian");
    expect(lib).toContain("read");
    expect(lib).not.toContain("write");
    expect(lib).not.toContain("bash");
  });

  it("unknown experts fall back to the lean role default", () => {
    expect(builtinToolNamesForRole("expert", "statistician").sort()).toEqual(
      ["find", "grep", "read"].sort(),
    );
  });

  it("auditor gets send_message + record_trace + skill_search, but NO trace-graph access", () => {
    const names = systemToolNamesForRole("expert", "auditor");
    expect(names.sort()).toEqual(["record_trace", "send_message", "skill_search"].sort());
    // Audit evidence is restricted to the workspace — no graph reads, no
    // create/destroy, no graph mutation.
    expect(names).not.toContain("get_trace_graph");
    expect(names).not.toContain("create_trace_node");
    expect(names).not.toContain("create_agent");
    expect(names).not.toContain("destroy_agent");
  });

  it("auditor builtins include read+grep+bash+write but NOT edit", () => {
    const a = builtinToolNamesForRole("expert", "auditor");
    // Read-only inspection + write for its own audit report.
    expect(a).toEqual(expect.arrayContaining(["read", "grep", "find", "glob", "bash", "write"]));
    // Must NOT be able to modify other agents' artefacts.
    expect(a).not.toContain("edit");
  });
});
