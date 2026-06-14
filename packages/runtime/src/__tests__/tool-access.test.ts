import { describe, it, expect } from "vitest";
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
  };
}

describe("tool access control (§9)", () => {
  it("principal gets comms + record_trace, not graph mutation tools", () => {
    const names = systemToolNamesForRole("principal", "principal");
    expect(names).toEqual(expect.arrayContaining(["send_message", "create_agent", "destroy_agent", "record_trace"]));
    expect(names).not.toContain("create_trace_node");
    expect(names).not.toContain("get_trace_graph");
  });

  it("trace agent gets ONLY graph tools", () => {
    const names = systemToolNamesForRole("trace", "trace");
    expect(names.sort()).toEqual(
      ["add_trace_relation", "create_trace_node", "get_trace_graph", "update_trace_node"].sort(),
    );
    expect(names).not.toContain("send_message");
    expect(names).not.toContain("create_agent");
  });

  it("expert gets send_message + record_trace only", () => {
    const names = systemToolNamesForRole("expert", "librarian");
    expect(names.sort()).toEqual(["record_trace", "send_message"].sort());
    expect(names).not.toContain("create_agent");
  });

  it("resolves the actual SystemTool objects for a role (filtered)", () => {
    const tools = systemToolsForRole("trace", "trace", deps("trace"));
    const toolNames = tools.map((t) => t.name).sort();
    expect(toolNames).toEqual(
      ["add_trace_relation", "create_trace_node", "get_trace_graph", "update_trace_node"].sort(),
    );
  });

  it("builtin tool allowlist differs by role", () => {
    expect(builtinToolNamesForRole("principal")).toEqual([]);
    expect(builtinToolNamesForRole("expert")).toContain("read");
    expect(builtinToolNamesForRole("trace")).toEqual(["read"]);
  });
});
