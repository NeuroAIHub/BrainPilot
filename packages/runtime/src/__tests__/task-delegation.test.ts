import { describe, expect, it } from "vitest";
import { SessionManager } from "../session-manager.js";
import type { AgentSessionFactory, IAgentSession, PiAgentEvent, SystemTool } from "../types.js";

interface Call { tool: string; args: Record<string, unknown> }
interface Script {
  beforePrompt?: (text: string) => Promise<void>;
  onPrompt?: (text: string) => Call | undefined;
}

function scriptedFactory(scripts: Record<string, Script>, prompts: Array<{ agent: string; text: string }>): AgentSessionFactory {
  return async ({ sessionId, agentName, systemTools }) => {
    const tools = new Map<string, SystemTool>(systemTools.map((tool) => [tool.name, tool]));
    const listeners = new Set<(event: PiAgentEvent) => void>();
    const emit = (event: PiAgentEvent) => listeners.forEach((listener) => listener(event));
    const session: IAgentSession = {
      sessionId,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      async prompt(text) {
        prompts.push({ agent: agentName, text });
        emit({ type: "agent_start" });
        emit({ type: "turn_start" });
        await scripts[agentName]?.beforePrompt?.(text);
        const call = scripts[agentName]?.onPrompt?.(text);
        if (call) {
          const id = `tc_${prompts.length}`;
          emit({ type: "tool_execution_start", toolCallId: id, toolName: call.tool, args: call.args });
          const result = await tools.get(call.tool)!.execute(call.args);
          emit({ type: "tool_execution_end", toolCallId: id, toolName: call.tool, result: result.content[0]?.text, isError: result.isError ?? false });
        }
        emit({ type: "turn_end" });
        emit({ type: "agent_end", messages: [], willRetry: false });
      },
      async abort() {},
      dispose() {},
    };
    return session;
  };
}

async function waitFor(predicate: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("flat task delegation", () => {
  it("dispatches a durable task, auto-creates the target, and emits task_state", async () => {
    const prompts: Array<{ agent: string; text: string }> = [];
    const manager = new SessionManager({
      persist: false,
      agentFactory: scriptedFactory({
        principal: { onPrompt: (text) => text.includes("DELEGATE") ? { tool: "dispatch_task", args: { to: "librarian", content: "survey topic X" } } : undefined },
        librarian: {},
      }, prompts),
    });
    const session = await manager.createSession();
    const taskOps: string[] = [];
    manager.subscribe(session.id, (event) => {
      if (event.type === "CUSTOM" && event.name === "task_state") taskOps.push((event.value as { op: string }).op);
    });
    await manager.sendMessage(session.id, "please DELEGATE");
    await waitFor(() => prompts.some((prompt) => prompt.agent === "librarian"));
    const prompt = prompts.find((item) => item.agent === "librarian")!;
    expect(prompt.text).toContain('<task_event kind="assigned" task_id="task_000001" from="principal">');
    expect(prompt.text).toContain("survey topic X");
    expect(manager.listTasks(session.id)[0]).toMatchObject({ id: "task_000001", status: "pending" });
    expect(taskOps).toContain("created");
    expect(manager.recentEvents(session.id).at(-1)).toMatchObject({
      type: "CUSTOM",
      name: "task_state",
      value: { op: "snapshot", tasks: [expect.objectContaining({ id: "task_000001" })] },
    });
  });

  it("completes by task ID and injects the reply once into the creator", async () => {
    const prompts: Array<{ agent: string; text: string }> = [];
    const manager = new SessionManager({
      persist: false,
      agentFactory: scriptedFactory({
        principal: { onPrompt: (text) => text.includes("DELEGATE") ? { tool: "dispatch_task", args: { to: "librarian", content: "research" } } : undefined },
        librarian: { onPrompt: (text) => {
          const id = text.match(/task_id="(task_\d+)"/)?.[1];
          return id ? { tool: "complete_task", args: { task_id: id, reply: "findings at docs/reports/findings.md" } } : undefined;
        } },
      }, prompts),
    });
    const session = await manager.createSession();
    await manager.sendMessage(session.id, "DELEGATE");
    await waitFor(() => prompts.filter((prompt) => prompt.agent === "principal").length >= 2);
    const reply = prompts.filter((prompt) => prompt.agent === "principal")[1]!;
    expect(reply.text).toContain('<task_event kind="replied" task_id="task_000001" from="librarian">');
    expect(reply.text).toContain("docs/reports/findings.md");
    await waitFor(() => manager.getSessionState(session.id)?.runState.active === false);
    expect(manager.listTasks(session.id)[0]).toMatchObject({ status: "replied" });
    expect(prompts.filter((prompt) => prompt.agent === "principal")).toHaveLength(2);
  });

  it("returns a compact Auditor report pointer to PI for a correction cycle", async () => {
    const prompts: Array<{ agent: string; text: string }> = [];
    const manager = new SessionManager({
      persist: false,
      agentFactory: scriptedFactory({
        principal: { onPrompt: (text) => text === "AUDIT" ? {
          tool: "dispatch_task",
          args: {
            to: "auditor",
            content: "Target type: expert-result\nTarget: raw engineer result\nClaims: accuracy = 0.94",
          },
        } : undefined },
        auditor: { onPrompt: (text) => {
          const id = text.match(/task_id="(task_\d+)"/)?.[1];
          return id ? {
            tool: "complete_task",
            args: {
              task_id: id,
              reply: "Verdict: REVISE\nRisk: high\nReport: docs/audits/task_000001-r1.md\n" +
                "Open findings: A1\nOwners: engineer\nRequired actions: A1 cite the result file.\n" +
                "PI must not claim the task is complete or deliver the affected conclusions.",
            },
          } : undefined;
        } },
      }, prompts),
    });
    const session = await manager.createSession();
    await manager.sendMessage(session.id, "AUDIT");
    await waitFor(() => prompts.filter((prompt) => prompt.agent === "principal").length >= 2);

    const auditPrompt = prompts.find((prompt) => prompt.agent === "auditor")!;
    expect(auditPrompt.text).toContain("Target: raw engineer result");
    const piFeedback = prompts.filter((prompt) => prompt.agent === "principal")[1]!;
    expect(piFeedback.text).toContain('<task_event kind="replied" task_id="task_000001" from="auditor">');
    expect(piFeedback.text).toContain("Report: docs/audits/task_000001-r1.md");
    expect(piFeedback.text).toContain("Open findings: A1");
    expect(piFeedback.text).toContain("Owners: engineer");
    expect(manager.listTasks(session.id)[0]).toMatchObject({ status: "replied", assigned_to: "auditor" });
  });

  it("rejects Auditor dispatch when the system plugin is disabled", async () => {
    const prompts: Array<{ agent: string; text: string }> = [];
    const manager = new SessionManager({
      persist: false,
      systemPluginEnv: { BP_EXPERIMENT_DISABLE_PLUGINS: "org.brainpilot.auditor" },
      agentFactory: scriptedFactory({
        principal: { onPrompt: () => ({
          tool: "dispatch_task",
          args: { to: "auditor", content: "review this" },
        }) },
      }, prompts),
    });
    const session = await manager.createSession();
    await manager.sendMessage(session.id, "AUDIT");
    await waitFor(() => manager.getSessionState(session.id)?.runState.active === false);
    expect(prompts.some((prompt) => prompt.agent === "auditor")).toBe(false);
    expect(manager.listTasks(session.id)).toEqual([]);
  });

  it("keeps direct user-to-agent prompts outside the task event path", async () => {
    const prompts: Array<{ agent: string; text: string }> = [];
    const manager = new SessionManager({ persist: false, agentFactory: scriptedFactory({ librarian: {} }, prompts) });
    const session = await manager.createSession();
    await manager.sendMessage(session.id, "hello", "librarian");
    await waitFor(() => prompts.length === 1);
    expect(prompts[0]?.text).toBe("hello");
  });

  it("keeps Auditor visible without holding the Principal-only foreground active", async () => {
    const prompts: Array<{ agent: string; text: string }> = [];
    let releaseAuditor!: () => void;
    const auditorGate = new Promise<void>((resolve) => { releaseAuditor = resolve; });
    const manager = new SessionManager({
      persist: false,
      agentFactory: scriptedFactory({
        principal: {
          onPrompt: (text) => text.includes("AUDIT")
            ? { tool: "dispatch_task", args: { to: "auditor", content: "optional review" } }
            : undefined,
        },
        auditor: { beforePrompt: async () => auditorGate },
      }, prompts),
    });
    const session = await manager.createSession();
    await manager.sendMessage(session.id, "AUDIT");
    await waitFor(() => manager.listAgents(session.id).some(
      (agent) => agent.name === "auditor" && agent.status === "running",
    ));
    await waitFor(() => manager.getSessionState(session.id)?.runState.active === false);

    expect(manager.getSessionState(session.id)).toMatchObject({
      runState: { active: false },
      workState: { active: true },
      agents: expect.arrayContaining([expect.objectContaining({ name: "auditor", status: "running" })]),
    });
    releaseAuditor();
    await waitFor(() => manager.getSessionState(session.id)?.workState.active === false);
  });
});
