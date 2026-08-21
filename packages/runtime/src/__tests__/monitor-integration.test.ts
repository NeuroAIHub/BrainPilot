import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockAgentFactory } from "../agent-factory.js";
import { SessionManager } from "../session-manager.js";
import type { MonitorEventBatch, MonitorManager } from "../monitor-manager.js";
import type { AgentSessionFactory, IAgentSession, PiAgentEvent } from "../types.js";
import type { AgUiEvent } from "@brainpilot/protocol";

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for monitor delivery");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function failingFactory(rawError: string, prompts: string[]): AgentSessionFactory {
  return async ({ sessionId }) => {
    const listeners = new Set<(event: PiAgentEvent) => void>();
    let streaming = false;
    const emit = (event: PiAgentEvent) => {
      for (const listener of listeners) listener(event);
    };
    return {
      sessionId,
      get isStreaming() { return streaming; },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async prompt(text: string) {
        prompts.push(text);
        streaming = true;
        emit({ type: "agent_start" });
        emit({ type: "turn_start" });
        emit({ type: "message_start", message: { role: "assistant", content: [] } });
        emit({
          type: "message_end",
          message: { role: "assistant", content: [], stopReason: "error", errorMessage: rawError },
        });
        emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error" }] });
        streaming = false;
      },
      async abort() { streaming = false; },
      dispose() {},
    } satisfies IAgentSession;
  };
}

type MonitorTestEntry = {
  monitorManager: MonitorManager;
  monitorEvents: Map<string, MonitorEventBatch[]>;
};

async function queuePersistentMonitorEvent(
  manager: SessionManager,
  sessionId: string,
  description: string,
): Promise<MonitorTestEntry> {
  const internals = manager as unknown as {
    sessions: Map<string, MonitorTestEntry>;
    ensureAgent(sessionId: string, name: string): Promise<unknown>;
    wakeAgent(sessionId: string, name: string): void;
  };
  await internals.ensureAgent(sessionId, "principal");
  const entry = internals.sessions.get(sessionId)!;
  const monitor = entry.monitorManager.start({
    ownerAgent: "principal",
    description,
    command: "while :; do sleep 1; done",
    persistent: true,
  });
  entry.monitorEvents.set("principal", [{
    monitorId: monitor.id,
    ownerAgent: "principal",
    description,
    timestamp: new Date().toISOString(),
    lines: ["monitor-ready"],
  }]);
  internals.wakeAgent(sessionId, "principal");
  return entry;
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
    expect(toolNames[0]).not.toContain("run_in_background");
    await manager.setRuntimeCapabilities(["builtin.monitor"]);
    await (manager as unknown as { ensureAgent(sessionId: string, name: string): Promise<unknown> })
      .ensureAgent(session.id, "engineer");
    expect(toolNames[1]).toContain("start_monitor");
    expect(toolNames[1]).toContain("run_in_background");
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

  it("stops a Monitor after three retryable delivery failures instead of re-waking forever", async () => {
    const prompts: string[] = [];
    const manager = new SessionManager({
      persist: false,
      agentFactory: failingFactory("503 provider unavailable", prompts),
      runtimeCapabilities: ["builtin.monitor"],
    });
    const systemMessages: Array<{ level?: string; message?: string }> = [];
    try {
      const session = await manager.createSession();
      manager.subscribe(session.id, (event) => {
        if (event.type === "system_message") systemMessages.push(event);
      });
      const entry = await queuePersistentMonitorEvent(manager, session.id, "retry cap");

      await waitFor(() => systemMessages.some((event) =>
        event.level === "error" && event.message?.includes("连续 3 次投递失败"),
      ));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(prompts).toHaveLength(3);
      expect(systemMessages.filter((event) => event.level === "warning")).toHaveLength(2);
      expect(entry.monitorEvents.has("principal")).toBe(false);
      expect(entry.monitorManager.list("principal").every((monitor) => monitor.status !== "running")).toBe(true);
    } finally {
      await manager.shutdownAndSave();
    }
  });

  it("treats a fatal Monitor delivery failure as terminal on the first attempt", async () => {
    const prompts: string[] = [];
    const manager = new SessionManager({
      persist: false,
      agentFactory: failingFactory("401 invalid api key", prompts),
      runtimeCapabilities: ["builtin.monitor"],
    });
    const systemMessages: Array<{ level?: string; message?: string }> = [];
    try {
      const session = await manager.createSession();
      manager.subscribe(session.id, (event) => {
        if (event.type === "system_message") systemMessages.push(event);
      });
      const entry = await queuePersistentMonitorEvent(manager, session.id, "fatal delivery");

      await waitFor(() => systemMessages.some((event) =>
        event.level === "error" && event.message?.includes("无法自动恢复"),
      ));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(prompts).toHaveLength(1);
      expect(systemMessages.filter((event) => event.level === "warning")).toHaveLength(0);
      expect(entry.monitorEvents.has("principal")).toBe(false);
      expect(entry.monitorManager.list("principal").every((monitor) => monitor.status !== "running")).toBe(true);
    } finally {
      await manager.shutdownAndSave();
    }
  });
});
