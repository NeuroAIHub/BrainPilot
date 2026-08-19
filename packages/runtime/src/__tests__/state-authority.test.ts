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
    expect(before.reclaimable).toBe(true);

    await m.sendMessage(s.id, "hello");

    // Status reaches idle again AND the run is marked inactive.
    await waitFor(() => {
      const agents = m.listAgents(s.id);
      const state = m.getSessionState(s.id);
      return agents.length > 0
        && agents[0]!.status === "idle"
        && state?.runState.active === false
        && state.workState.status === "idle";
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
    expect(state!.workState).toMatchObject({
      active: false,
      status: "idle",
      epoch: 1,
    });

    const after = m.metrics();
    expect(after.runningAgents).toBe(0);
    expect(after.reclaimable).toBe(true);
    expect(after.lastActivityAt).not.toBeNull();
    expect(after.memRss).toBeGreaterThan(0);
  });

  // #70: the runtime must push CUSTOM:session_state snapshots so the web Agents
  // panel updates live (without a reload/reselect). Previously the builder
  // existed but was never called, leaving the panel blank until a /state poll.
  it("emits CUSTOM:session_state snapshots on send + status transitions", async () => {
    const m = new SessionManager({ persist: false, agentFactory: mockAgentFactory });
    const s = await m.createSession();

    type Snap = {
      runState: { active: boolean; runId: string | null };
      workState: { active: boolean; status: string; epoch: number };
      agents: Array<{ name: string; status: string }>;
    };
    const snapshots: Snap[] = [];
    m.subscribe(s.id, (e) => {
      if (e.type === "CUSTOM" && (e as { name?: string }).name === "session_state") {
        snapshots.push((e as { value: Snap }).value);
      }
    });

    await m.sendMessage(s.id, "hello");
    await waitFor(() => {
      const agents = m.listAgents(s.id);
      return agents.length > 0
        && agents[0]!.status === "idle"
        && m.getSessionState(s.id)?.workState.status === "idle";
    });

    // At least: initial frame (active) + running + idle.
    expect(snapshots.length).toBeGreaterThanOrEqual(2);

    // The first frame is the explicit initial one from sendMessage: run active,
    // principal already present.
    const first = snapshots[0]!;
    expect(first.runState.active).toBe(true);
    expect(first.workState.active).toBe(true);
    expect(first.workState.status).toBe("active");
    expect(first.workState.epoch).toBe(1);
    expect(first.agents.some((a) => a.name === "principal")).toBe(true);

    // Somewhere we saw principal running, and the final snapshot is idle.
    expect(
      snapshots.some((sn) => sn.agents.some((a) => a.name === "principal" && a.status === "running")),
    ).toBe(true);
    const last = snapshots[snapshots.length - 1]!;
    expect(last.agents.find((a) => a.name === "principal")?.status).toBe("idle");
    expect(last.workState.active).toBe(false);
    expect(last.workState.status).toBe("idle");

    // Reconnect snapshot: the ring buffer replay ends on the latest
    // session_state, so a re-subscribing client recovers the idle state.
    const replay = m.recentEvents(s.id).filter(
      (e) => e.type === "CUSTOM" && (e as { name?: string }).name === "session_state",
    );
    const lastReplay = replay[replay.length - 1] as { value: Snap };
    expect(lastReplay.value.agents.find((a) => a.name === "principal")?.status).toBe("idle");
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
