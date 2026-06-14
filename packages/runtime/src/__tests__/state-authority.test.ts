import { describe, it, expect } from "vitest";
import { SessionManager } from "../session-manager.js";
import { mockAgentFactory } from "../agent-factory.js";

describe("state authority (§10)", () => {
  it("tracks agent idle -> running -> idle and reflects it in /agents + /metrics", async () => {
    const m = new SessionManager({ persist: false, agentFactory: mockAgentFactory });
    const s = await m.createSession();

    // Capture status transitions via the SSE event stream.
    const statuses: string[] = [];
    m.subscribe(s.id, (e) => {
      if (e.type === "agent_status_update") statuses.push((e as { status: string }).status);
    });

    const before = m.metrics();
    expect(before.activeSessions).toBe(1);
    expect(before.runningAgents).toBe(0);

    await m.sendMessage(s.id, "hello");

    // Status reaches idle again AND the run is marked inactive.
    await waitFor(() => {
      const agents = m.listAgents(s.id);
      const state = m.getSessionState(s.id);
      return agents.length > 0 && agents[0]!.status === "idle" && state?.runState.active === false;
    });

    // We observed a running->idle transition.
    expect(statuses).toContain("running");
    expect(statuses).toContain("idle");

    const agents = m.listAgents(s.id);
    expect(agents[0]!.name).toBe("principal");
    expect(agents[0]!.status).toBe("idle");
    expect(agents[0]!.alive).toBe(true);

    const state = m.getSessionState(s.id);
    expect(state).toBeDefined();
    expect(state!.runState.active).toBe(false);

    const after = m.metrics();
    expect(after.runningAgents).toBe(0);
    expect(after.lastActivityAt).not.toBeNull();
    expect(after.memRss).toBeGreaterThan(0);
  });

  it("evict stops agents and drops the session from memory", async () => {
    const m = new SessionManager({ persist: false, agentFactory: mockAgentFactory });
    const s = await m.createSession();
    await m.sendMessage(s.id, "hi");
    await waitFor(() => m.listAgents(s.id).length > 0);

    const res = await m.evictSession(s.id);
    expect(res.evicted).toBe(true);
    expect(res.agentsKilled).toBeGreaterThanOrEqual(1);
    expect(m.getSession(s.id)).toBeUndefined();
    expect(m.metrics().activeSessions).toBe(0);
  });
});

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}
