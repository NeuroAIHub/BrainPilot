import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockAgentFactory } from "../agent-factory.js";
import { SessionManager } from "../session-manager.js";
import type { AgentSessionFactory } from "../types.js";
import type { AgUiEvent } from "@brainpilot/protocol";

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for monitor delivery");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("Monitor runtime integration", () => {
  it("exposes the official plugin tools and wakes the owner only when stdout arrives", async () => {
    const prompts: string[] = [];
    const toolNames: string[][] = [];
    const factory: AgentSessionFactory = async (params) => {
      toolNames.push(params.systemTools.map((tool) => tool.name));
      const base = await mockAgentFactory(params);
      return {
        get sessionId() { return base.sessionId; },
        get isStreaming() { return base.isStreaming; },
        subscribe: (listener) => base.subscribe(listener),
        prompt: async (text, options) => { prompts.push(text); await base.prompt(text, options); },
        abort: () => base.abort(),
        interruptTool: (id) => base.interruptTool?.(id) ?? false,
        dispose: () => base.dispose(),
      };
    };
    const manager = new SessionManager({
      persist: false,
      agentFactory: factory,
      runtimeCapabilities: ["builtin.monitor"],
    });
    const session = await manager.createSession();
    await manager.sendMessage(
      session.id,
      `[[tool:start_monitor {"description":"wake test","command":"printf 'monitor-ready\\n'","timeout_ms":2000}]]`,
    );
    await waitFor(() => prompts.some((prompt) => prompt.includes("<monitor_events")));
    expect(toolNames[0]).toEqual(expect.arrayContaining(["start_monitor", "list_monitors", "stop_monitor"]));
    expect(prompts.find((prompt) => prompt.includes("<monitor_events"))).toContain("monitor-ready");
    expect(prompts.find((prompt) => prompt.includes("<monitor_events"))).toContain("untrusted=\"true\"");
    manager.shutdown();
  });

  it("omits Monitor tools when the marketplace capability is disabled", async () => {
    const toolNames: string[][] = [];
    const factory: AgentSessionFactory = async (params) => {
      toolNames.push(params.systemTools.map((tool) => tool.name));
      return mockAgentFactory(params);
    };
    const manager = new SessionManager({ persist: false, agentFactory: factory });
    const session = await manager.createSession();
    await manager.sendMessage(session.id, "hello");
    await waitFor(() => toolNames.length > 0);
    expect(toolNames[0]).not.toContain("start_monitor");
    await manager.setRuntimeCapabilities(["builtin.monitor"]);
    await (manager as unknown as { ensureAgent(sessionId: string, name: string): Promise<unknown> })
      .ensureAgent(session.id, "engineer");
    expect(toolNames[1]).toContain("start_monitor");
    manager.shutdown();
  });

  it("stops live monitors immediately when the plugin capability is disabled", async () => {
    const manager = new SessionManager({
      persist: false,
      agentFactory: mockAgentFactory,
      runtimeCapabilities: ["builtin.monitor"],
    });
    const session = await manager.createSession();
    const events: AgUiEvent[] = [];
    manager.subscribe(session.id, (event) => events.push(event));
    await manager.sendMessage(
      session.id,
      `[[tool:start_monitor {"description":"persistent","command":"while :; do sleep 1; done","persistent":true}]]`,
    );
    await waitFor(() => events.some((event) => event.type === "CUSTOM"
      && event.name === "monitor_state"
      && (event.value as { status?: string }).status === "running"));
    await manager.setRuntimeCapabilities([]);
    expect(events.some((event) => event.type === "CUSTOM"
      && event.name === "monitor_state"
      && ["stopping", "completed", "failed"].includes((event.value as { status?: string }).status ?? ""))).toBe(true);
    manager.shutdown();
  });

  it("restores Monitor tools for an existing session when capabilities sync after restart", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "bp-monitor-restart-"));
    let restarted: SessionManager | undefined;
    try {
      const original = new SessionManager({
        dataRoot,
        persist: true,
        agentFactory: mockAgentFactory,
        runtimeCapabilities: ["builtin.monitor"],
      });
      await original.createSession({ id: "existing-monitor-session" });
      await original.shutdownAndSave();

      const toolNames: string[][] = [];
      const factory: AgentSessionFactory = async (params) => {
        toolNames.push(params.systemTools.map((tool) => tool.name));
        return mockAgentFactory(params);
      };
      restarted = new SessionManager({ dataRoot, persist: true, agentFactory: factory });

      // startServer restores persisted entries before it accepts Backend HTTP;
      // the first Backend handshake must still upgrade those restored entries
      // before an agent is recreated from the existing session.
      await restarted.restoreFromDisk();
      await restarted.setRuntimeCapabilities(["builtin.monitor"]);
      await restarted.sendMessage("existing-monitor-session", "resume after restart");
      await waitFor(() => toolNames.length > 0);

      expect(toolNames[0]).toEqual(expect.arrayContaining([
        "start_monitor",
        "list_monitors",
        "stop_monitor",
      ]));
    } finally {
      if (restarted) await restarted.shutdownAndSave();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
