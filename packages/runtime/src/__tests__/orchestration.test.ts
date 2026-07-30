import { describe, it, expect } from "vitest";
import { parseEvent, type AgUiEvent } from "@brainpilot/protocol";
import { SessionManager } from "../session-manager.js";
import { mockAgentFactory } from "../agent-factory.js";

/**
 * End-to-end orchestration in mock mode: a principal's dispatch_task tool must
 * create a task and wake the target expert, which must be
 * auto-created. The mock agent invokes the real (access-filtered) system tool.
 */
describe("orchestration: dispatch_task creates and delivers a task", () => {
  it("principal dispatch_task -> task event + auto-create", async () => {
    const m = new SessionManager({ persist: false, agentFactory: mockAgentFactory });
    const s = await m.createSession();

    const events: AgUiEvent[] = [];
    m.subscribe(s.id, (e) => events.push(e));

    // Drive the principal to call dispatch_task(to=librarian).
    await m.sendMessage(
      s.id,
      'delegate [[tool:dispatch_task {"content":"please research X","to":"librarian"}]]',
    );

    await waitFor(() => events.some((e) => e.type === "TOOL_CALL_RESULT"));
    for (const e of events) expect(() => parseEvent(e)).not.toThrow();

    // The librarian agent was auto-created by the tool's ensureAgent.
    const agents = m.listAgents(s.id).map((a) => a.name);
    expect(agents).toContain("principal");
    expect(agents).toContain("librarian");

    const result = events.find((e) => e.type === "TOOL_CALL_RESULT") as { content: string };
    expect(result.content).toContain("dispatched to librarian");
  });
});

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}
