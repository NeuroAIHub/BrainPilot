import { describe, expect, it } from "vitest";
import { mockAgentFactory } from "../agent-factory.js";
import { SessionManager } from "../session-manager.js";
import type { AgentSessionFactory } from "../types.js";
import type { AgUiEvent } from "@brainpilot/protocol";

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for background job delivery");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("Background Jobs runtime integration", () => {
  it("does not wake on stdout and wakes once at terminal completion", async () => {
    const prompts: Array<{ agent: string; text: string }> = [];
    const toolNames = new Map<string, string[]>();
    const factory: AgentSessionFactory = async (params) => {
      toolNames.set(params.agentName, params.systemTools.map((tool) => tool.name));
      const base = await mockAgentFactory(params);
      return {
        get sessionId() { return base.sessionId; },
        get isStreaming() { return base.isStreaming; },
        subscribe: (listener) => base.subscribe(listener),
        prompt: async (text, options) => {
          prompts.push({ agent: params.agentName, text });
          await base.prompt(text, options);
        },
        abort: () => base.abort(),
        interruptTool: (id) => base.interruptTool?.(id) ?? false,
        dispose: () => base.dispose(),
      };
    };
    const manager = new SessionManager({
      persist: false,
      agentFactory: factory,
      runtimeCapabilities: ["builtin.backgroundJobs"],
    });
    const session = await manager.createSession();
    await manager.sendMessage(
      session.id,
      `[[tool:run_in_background {"job_key":"training-b","description":"train B","command":"printf 'progress\\n'; sleep 0.3","timeout_ms":2000}]]`,
      "engineer",
    );
    expect(toolNames.get("engineer")).toEqual(expect.arrayContaining(["run_in_background", "background_job"]));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(prompts.filter((item) => item.text.includes("<background_job_events"))).toHaveLength(0);
    await waitFor(() => prompts.some((item) => item.text.includes("<background_job_events")));
    const completion = prompts.filter((item) => item.text.includes("<background_job_events"));
    expect(completion).toHaveLength(1);
    expect(completion[0]?.text).toContain("progress");
    expect(completion[0]?.text).toContain("untrusted=\"true\"");
    manager.shutdown();
  });

  it("does not expose the job tools to Principal or without the plugin capability", async () => {
    const tools = new Map<string, string[]>();
    const factory: AgentSessionFactory = async (params) => {
      tools.set(params.agentName, params.systemTools.map((tool) => tool.name));
      return mockAgentFactory(params);
    };
    const manager = new SessionManager({ persist: false, agentFactory: factory, runtimeCapabilities: [] });
    const session = await manager.createSession();
    await manager.sendMessage(session.id, "hello", "engineer");
    expect(tools.get("engineer")).not.toContain("run_in_background");
    await manager.setRuntimeCapabilities(["builtin.backgroundJobs"]);
    await manager.sendMessage(session.id, "hello", "principal");
    expect(tools.get("principal")).not.toContain("run_in_background");
    await (manager as unknown as { ensureAgent(sessionId: string, name: string): Promise<unknown> })
      .ensureAgent(session.id, "experimentalist");
    expect(tools.get("experimentalist")).toContain("run_in_background");
    manager.shutdown();
  });

  it("injects the shared execution contract into Bash-enabled agents", async () => {
    const prompts = new Map<string, string>();
    const factory: AgentSessionFactory = async (params) => {
      prompts.set(params.agentName, params.systemPrompt);
      return mockAgentFactory(params);
    };
    const manager = new SessionManager({ persist: false, agentFactory: factory });
    const session = await manager.createSession();

    await manager.sendMessage(session.id, "inspect", "engineer");
    expect(prompts.get("engineer")).toContain("Every `bash` call must explicitly set `timeout`");
    expect(prompts.get("engineer")).toContain("must use `run_in_background`");

    await manager.sendMessage(session.id, "research", "librarian");
    expect(prompts.get("librarian")).not.toContain("Every `bash` call must explicitly set `timeout`");
    manager.shutdown();
  });

  it("cancels live jobs immediately when the plugin capability is disabled", async () => {
    const manager = new SessionManager({
      persist: false,
      agentFactory: mockAgentFactory,
      runtimeCapabilities: ["builtin.backgroundJobs"],
    });
    const session = await manager.createSession();
    const events: AgUiEvent[] = [];
    manager.subscribe(session.id, (event) => events.push(event));
    await manager.sendMessage(
      session.id,
      `[[tool:run_in_background {"job_key":"long-job","description":"long job","command":"while :; do sleep 1; done","timeout_ms":60000}]]`,
      "engineer",
    );
    await waitFor(() => events.some((event) => event.type === "CUSTOM"
      && event.name === "background_job_state"
      && (event.value as { status?: string }).status === "running"));
    await manager.setRuntimeCapabilities([]);
    await waitFor(() => events.some((event) => event.type === "CUSTOM"
      && event.name === "background_job_state"
      && (event.value as { status?: string }).status === "cancelled"));
    manager.shutdown();
  });
});
