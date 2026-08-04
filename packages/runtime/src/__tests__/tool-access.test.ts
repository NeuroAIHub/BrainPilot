import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  allSystemTools,
  systemToolNamesForRole,
  systemToolsForRole,
  builtinToolNamesForRole,
  createAskUserTool,
  createDispatchTaskTool,
  createCompleteTaskTool,
  type ToolDeps,
} from "../tools/system-tools.js";
import { GraphOfTrace } from "../trace.js";

const TRACE_V2_TOOLS = [
  "create_trace_node",
  "get_trace_graph",
  "get_trace_neighborhood",
  "get_trace_node",
  "update_trace_node",
].sort();

function deps(name: string): ToolDeps {
  return {
    sessionId: "s",
    fromAgent: name,
    trace: new GraphOfTrace("s"),
    dispatchTask: async (to, content) => ({
      id: "task_000001", seq: 1, created_by: name, assigned_to: to, content,
      status: "pending", created_at: 1,
    }),
    completeTask: async (taskId, reply) => ({
      id: taskId, seq: 1, created_by: "principal", assigned_to: name, content: "work",
      status: "completed", reply, created_at: 1, completed_at: 2,
    }),
    dispatchTrace: async () => {},
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
  it("dispatch_task and complete_task expose stable task-oriented contracts", async () => {
    const d = deps("engineer");
    const dispatched: Array<[string, string]> = [];
    d.dispatchTask = async (to, content) => {
      dispatched.push([to, content]);
      return { id: "task_000007", seq: 7, created_by: "engineer", assigned_to: to, content, status: "pending", created_at: 1 };
    };
    const dispatch = createDispatchTaskTool(d);
    expect((dispatch.parameters.required as string[])).toEqual(["content", "to"]);
    expect((await dispatch.execute({ to: "writer", content: "polish docs/report.md" })).isError).toBeUndefined();
    expect(dispatched).toEqual([["writer", "polish docs/report.md"]]);
    await expect(dispatch.execute({ to: "engineer", content: "self" })).resolves.toMatchObject({ isError: true });
    await expect(dispatch.execute({ to: "trace", content: "wrong" })).resolves.toMatchObject({ isError: true });

    const complete = createCompleteTaskTool(d);
    expect((complete.parameters.required as string[])).toEqual(["task_id", "reply"]);
    expect((await complete.execute({ task_id: "task_000001", reply: "done" })).isError).toBeUndefined();
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

  it("principal gets comms, record_trace, and read-only GoT tools", () => {
    const names = systemToolNamesForRole("principal", "principal");
    expect(names).toEqual(expect.arrayContaining([
      "dispatch_task",
      "complete_task",
      "create_agent",
      "destroy_agent",
      "record_trace",
      "get_trace_graph",
      "get_trace_node",
      "get_trace_neighborhood",
      "get_trace_diff",
    ]));
    expect(names).not.toContain("create_trace_node");
    expect(names).not.toContain("update_trace_node");
  });

  it("principal can ask_user; experts and trace cannot", () => {
    expect(systemToolNamesForRole("principal", "principal")).toContain("ask_user");
    expect(systemToolNamesForRole("expert", "librarian")).not.toContain("ask_user");
    expect(systemToolNamesForRole("trace", "trace")).not.toContain("ask_user");
  });

  it("trace agent gets ONLY graph tools", () => {
    const names = systemToolNamesForRole("trace", "trace");
    expect(names.sort()).toEqual(TRACE_V2_TOOLS);
    expect(names).not.toContain("dispatch_task");
    expect(names).not.toContain("create_agent");
  });

  it("does not register legacy relation or episode mutation tools", () => {
    const names = new Set(allSystemTools(deps("trace")).keys());
    for (const name of [
      "add_trace_relation",
      "propose_trace_dependency",
      "create_trace_episode",
      "rename_trace_episode",
      "merge_trace_episodes",
      "split_trace_episode",
      "assign_trace_episode",
    ]) {
      expect(names.has(name), name).toBe(false);
    }
  });

  it("expert gets task tools + record_trace + skill_search + local KB tools", () => {
    const names = systemToolNamesForRole("expert", "librarian");
    expect(names.sort()).toEqual(
      [
        "record_trace",
        "dispatch_task",
        "complete_task",
        "skill_search",
        "get_domain_knowledge_local",
        "search_papers_local",
        "spawn_subagent",
        "wait_subagent",
        "get_subagent",
        "cancel_subagent",
        "list_subagent_profiles",
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
    expect(toolNames).toEqual(TRACE_V2_TOOLS);
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

  it("auditor gets bounded Trace readers and review-only mutation access", () => {
    const names = systemToolNamesForRole("expert", "auditor");
    expect(names.sort()).toEqual(
      [
        "complete_task",
        "list_pending_trace_reviews",
        "get_trace_node",
        "get_trace_neighborhood",
        "get_trace_diff",
        "edit_trace_review",
        "skill_search",
        "get_domain_knowledge_local",
        "search_papers_local",
        "spawn_subagent",
        "wait_subagent",
        "get_subagent",
        "cancel_subagent",
        "list_subagent_profiles",
      ].sort(),
    );
    expect(names).not.toContain("record_trace");
    expect(names).not.toContain("get_trace_graph");
    expect(names).not.toContain("create_trace_node");
    expect(names).not.toContain("create_agent");
    expect(names).not.toContain("destroy_agent");
  });

  it("auditor builtins are read-only and separate report submission is disabled", () => {
    const a = builtinToolNamesForRole("expert", "auditor");
    expect(a).toEqual(expect.arrayContaining(["read", "grep", "find", "glob", "bash"]));
    expect(a).not.toContain("write");
    expect(a).not.toContain("edit");
    expect(systemToolNamesForRole("expert", "auditor")).not.toContain("submit_audit_report");
  });

  it("lets Auditor list pending node and parent reviews without rebinding", async () => {
    const d = deps("auditor");
    const parent = d.trace.createNode({ title: "Evidence" });
    const child = d.trace.createNode({ title: "Conclusion" });
    d.trace.review(parent.id, "approve", "supported", { type: "agent", name: "auditor" });
    d.trace.proposeCausalParent(child.id, parent.id, "Conclusion consumes the evidence.", { type: "agent", name: "trace" });

    const tool = systemToolsForRole("expert", "auditor", d)
      .find((item) => item.name === "list_pending_trace_reviews")!;
    const text = (await tool.execute({})).content.map((item) => item.text).join("");
    expect(text).toContain('"title": "Conclusion"');
    expect(text).toContain('"parentTitle": "Evidence"');
    expect(text).toContain('"conclusion": "candidate"');
    expect(d.currentTraceAuditTarget).toBeUndefined();
  });

  it("binds Auditor targets in the Host without exposing report submission", async () => {
    const d = deps("auditor");
    const node = d.trace.createNode({ title: "Conclusion", confidence: "medium", confidenceReason: "One result file." });
    const target = d.trace.listPendingAuditTargets()[0]!;
    d.currentTraceAuditTarget = () => target;
    const tools = new Map(systemToolsForRole("expert", "auditor", d).map((tool) => [tool.name, tool]));

    expect((await tools.get("edit_trace_review")!.execute({ conclusion: "approve", reason: "The bound evidence supports this node." })).isError)
      .not.toBe(true);
    expect(d.trace.getNodeV2(node.id)?.reviewConclusion).toBe("approved");
    expect(tools.has("submit_audit_report")).toBe(false);
    expect(d.trace.getAuditReports()).toEqual([]);
    expect(tools.has("dispatch_task")).toBe(false);
  });

  it("requires confidence and returns only a compact active graph to Trace", async () => {
    const d = deps("trace");
    const tools = new Map(systemToolsForRole("trace", "trace", d).map((tool) => [tool.name, tool]));
    expect((await tools.get("create_trace_node")!.execute({ title: "Missing confidence" })).isError).toBe(true);
    expect((await tools.get("create_trace_node")!.execute({
      title: "Ablation",
      confidence: "medium",
      confidence_reason: "One complete seed.",
    })).isError).not.toBe(true);
    const node = d.trace.getGraphV2().nodes.find((item) => item.type !== "session_start")!;
    const agentGraph = JSON.parse((await tools.get("get_trace_graph")!.execute({})).content[0]!.text) as {
      revision: number;
      rootNodeId?: string;
      nodes: Array<{ id: string; parents: unknown[] }>;
      dependencies?: unknown;
      artifacts?: unknown;
    };
    expect(agentGraph.nodes).toEqual([expect.objectContaining({ id: node.id, parents: [] })]);
    expect(agentGraph.rootNodeId).toBe(d.trace.getGraphV2().meta.rootNodeId);
    expect(agentGraph).not.toHaveProperty("dependencies");
    expect(agentGraph).not.toHaveProperty("artifacts");
    expect(agentGraph.nodes[0]).not.toHaveProperty("records");
    expect((await tools.get("update_trace_node")!.execute({ node_id: node.id, summary: "updated" })).isError).toBe(true);

    const rootId = d.trace.getGraphV2().meta.rootNodeId!;
    d.trace.proposeCausalParent(node.id, rootId, "Depends only on initial context.", { type: "agent", name: "trace" });
    const withExplicitRoot = JSON.parse((await tools.get("get_trace_graph")!.execute({})).content[0]!.text) as {
      nodes: Array<{ id: string; parents: Array<{ nodeId: string; origin?: string }> }>;
    };
    expect(withExplicitRoot.nodes.find((item) => item.id === node.id)?.parents).toContainEqual(
      expect.objectContaining({ nodeId: rootId, origin: "trace" }),
    );
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
      "dispatch_task", "complete_task", "ask_user", "create_agent", "record_trace",
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
      "complete_task",
      "create_agent",
      "destroy_agent",
      "dispatch_task",
      "get_trace_diff",
      "get_trace_graph",
      "get_trace_neighborhood",
      "get_trace_node",
      "record_trace",
    ].sort());
  });

  it("trace agent tool set is unaffected by toggles (graph tools are always-on)", () => {
    const off = {
      skill_search: false,
      get_domain_knowledge_local: false,
      search_papers_local: false,
    };
    const names = systemToolsForRole("trace", "trace", deps("trace"), off).map((t) => t.name).sort();
    expect(names).toEqual(TRACE_V2_TOOLS);
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
