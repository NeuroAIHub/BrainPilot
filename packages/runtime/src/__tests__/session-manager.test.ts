import { describe, it, expect, beforeEach } from "vitest";
import { parseEvent, type AgUiEvent } from "@brainpilot/protocol";
import { SessionManager } from "../session-manager.js";
import { mockAgentFactory } from "../agent-factory.js";

function mgr(): SessionManager {
  // persist:false keeps tests hermetic; mock factory => no Pi SDK / API.
  return new SessionManager({ persist: false, agentFactory: mockAgentFactory });
}

describe("SessionManager (mock mode)", () => {
  let m: SessionManager;
  beforeEach(() => {
    m = mgr();
  });

  it("create -> send -> stream -> run_finished", async () => {
    const session = await m.createSession({ title: "Test" });
    expect(session.id).toBeTruthy();

    const events: AgUiEvent[] = [];
    const unsub = m.subscribe(session.id, (e) => events.push(e));
    expect(unsub).toBeTypeOf("function");

    const res = await m.sendMessage(session.id, "hello principal");
    expect(res.accepted).toBe(true);

    // Wait for the async run to finish.
    await waitFor(() => events.some((e) => e.type === "RUN_FINISHED"));

    for (const e of events) expect(() => parseEvent(e)).not.toThrow();
    const types = events.map((e) => e.type);
    expect(types).toContain("RUN_STARTED");
    expect(types).toContain("RUN_FINISHED");
    unsub?.();
  });

  it("lists and deletes sessions", async () => {
    const a = await m.createSession({ title: "A" });
    const b = await m.createSession({ title: "B" });
    expect(m.listSessions().map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
    expect(await m.deleteSession(a.id)).toBe(true);
    expect(m.getSession(a.id)).toBeUndefined();
    expect(m.listSessions()).toHaveLength(1);
  });

  it("auto-creates the principal on first message", async () => {
    const s = await m.createSession();
    await m.sendMessage(s.id, "hi");
    await waitFor(() => m.listAgents(s.id).length > 0);
    const agents = m.listAgents(s.id);
    expect(agents.map((a) => a.name)).toContain("principal");
  });
});

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}
