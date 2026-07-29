import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  systemToolNamesForRole,
  systemToolsForRole,
  builtinToolNamesForRole,
  createAskUserTool,
  createSendMessageTool,
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
  it("send_message derives result/task direction from the live delegator", async () => {
    const d = deps("engineer");
    d.getDelegator = () => "experimentalist";
    const tool = createSendMessageTool(d);

    expect((tool.parameters.required as string[])).toEqual(["content", "to"]);
    await tool.execute({ to: "experimentalist", content: "completed" });
    await tool.execute({ to: "writer", content: "please polish" });
    await tool.execute({ to: "principal", content: "authorization needed" });

    expect(d.mailbox.peek("experimentalist")[0]!.msgType).toBe("result_deliver");
    expect(d.mailbox.peek("writer")[0]!.msgType).toBe("task_delegate");
    expect(d.mailbox.peek("principal")[0]!.msgType).toBe("result_deliver");
  });

  it("ask_user validates choices and defaults free text to enabled", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const d = deps("principal");
    d.requestUserInput = async (request) => {
      seen.push(request);
      return "A";
    };
    const tool = createAskUserTool(d);

    const valid = await tool.execute({ question: " Pick ", options: [" A ", "B"] });
    expect(valid.isError).toBeUndefined();
    expect(seen).toEqual([{
      question: "Pick",
      options: ["A", "B"],
      allow_free_text: true,
    }]);
    await expect(tool.execute({ question: "Pick", options: ["A", "A"] })).resolves.toMatchObject({
      isError: true,
    });
    await expect(tool.execute({ question: "Pick", allow_free_text: false })).resolves.toMatchObject({
      isError: true,
    });
    await expect(tool.execute({ question: "   " })).resolves.toMatchObject({ isError: true });
  });

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

  it("expert gets send_message + record_trace + skill_search + local KB tools", () => {
    const names = systemToolNamesForRole("expert", "librarian");
    expect(names.sort()).toEqual(
      [
        "record_trace",
        "send_message",
        "skill_search",
        "get_domain_knowledge_local",
        "search_papers_local",
      ].sort(),
    );
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

  it("librarian can save handoffs but cannot run a shell", () => {
    const lib = builtinToolNamesForRole("expert", "librarian");
    expect(lib).toContain("read");
    expect(lib).toContain("write");
    expect(lib).not.toContain("bash");
  });

  it("unknown experts can save handoffs with the lean role default", () => {
    expect(builtinToolNamesForRole("expert", "statistician").sort()).toEqual(
      ["find", "grep", "read", "write"].sort(),
    );
  });

  it("auditor gets send_message + record_trace + skill_search + local KB tools, but NO trace-graph access", () => {
    const names = systemToolNamesForRole("expert", "auditor");
    expect(names.sort()).toEqual(
      [
        "record_trace",
        "send_message",
        "skill_search",
        "get_domain_knowledge_local",
        "search_papers_local",
      ].sort(),
    );
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

describe("tool toggles", () => {
  // Sanity: with toggles absent (default-on) the returned SystemTool list
  // matches the role config exactly. Regression: an off-by-default bug
  // would surface here.
  it("without toggles, principal sees skill_search + both local KB tools", () => {
    const tools = systemToolsForRole("principal", "principal", deps("principal"));
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(expect.arrayContaining([
      "skill_search",
      "get_domain_knowledge_local",
      "search_papers_local",
    ]));
  });

  it("disabling skill_search removes it from principal & experts (KB tools stay)", () => {
    const off = { skill_search: false };
    const principal = systemToolsForRole("principal", "principal", deps("principal"), off).map((t) => t.name);
    const librarian = systemToolsForRole("expert", "librarian", deps("librarian"), off).map((t) => t.name);
    expect(principal).not.toContain("skill_search");
    expect(librarian).not.toContain("skill_search");
    // The other two toggleable tools stay wired.
    expect(principal).toContain("get_domain_knowledge_local");
    expect(principal).toContain("search_papers_local");
    // Always-on tools stay wired (regression: filter must not affect them).
    expect(principal).toEqual(expect.arrayContaining([
      "send_message", "ask_user", "create_agent", "record_trace",
    ]));
  });

  it("disabling get_domain_knowledge_local hides it without touching search_papers_local", () => {
    const off = { get_domain_knowledge_local: false };
    const names = systemToolsForRole("principal", "principal", deps("principal"), off).map((t) => t.name);
    expect(names).not.toContain("get_domain_knowledge_local");
    expect(names).toContain("search_papers_local");
    expect(names).toContain("skill_search");
  });

  it("disabling all three leaves only always-on tools", () => {
    const off = {
      skill_search: false,
      get_domain_knowledge_local: false,
      search_papers_local: false,
    };
    const names = systemToolsForRole("principal", "principal", deps("principal"), off).map((t) => t.name).sort();
    expect(names).toEqual([
      "ask_user",
      "create_agent",
      "destroy_agent",
      "record_trace",
      "send_message",
    ].sort());
  });

  it("trace agent tool set is unaffected by toggles (graph tools are always-on)", () => {
    const off = {
      skill_search: false,
      get_domain_knowledge_local: false,
      search_papers_local: false,
    };
    const names = systemToolsForRole("trace", "trace", deps("trace"), off).map((t) => t.name).sort();
    expect(names).toEqual([
      "add_trace_relation",
      "create_trace_node",
      "get_trace_graph",
      "update_trace_node",
    ].sort());
  });

  it("undefined field falls back to enabled (partial patch semantics)", () => {
    // A user could persist `{ "skill_search": false }` and leave the other
    // two keys absent. Missing keys must default-on, else a first-time write
    // that touches only one tool would surprise-disable the rest.
    const names = systemToolsForRole(
      "principal",
      "principal",
      deps("principal"),
      { skill_search: false },
    ).map((t) => t.name);
    expect(names).toContain("get_domain_knowledge_local");
    expect(names).toContain("search_papers_local");
    expect(names).not.toContain("skill_search");
  });

  it("null toggles behaves the same as no toggles (all enabled)", () => {
    const names = systemToolsForRole("principal", "principal", deps("principal"), null).map((t) => t.name);
    expect(names).toContain("skill_search");
    expect(names).toContain("get_domain_knowledge_local");
    expect(names).toContain("search_papers_local");
  });
});
