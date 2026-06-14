import { describe, it, expect } from "vitest";
import { parseEvent, type AgUiEvent } from "@brainpilot/protocol";
import { SessionManager } from "../session-manager.js";
import { mockAgentFactory } from "../agent-factory.js";

/**
 * End-to-end orchestration in mock mode: a principal's send_message tool must
 * deliver into the target expert's mailbox, and the expert must be
 * auto-created. The mock agent invokes the real (access-filtered) system tool.
 */
describe("orchestration: send_message delivers via mailbox", () => {
  it("principal send_message -> expert mailbox + auto-create", async () => {
    const m = new SessionManager({ persist: false, agentFactory: mockAgentFactory });
    const s = await m.createSession();

    const events: AgUiEvent[] = [];
    m.subscribe(s.id, (e) => events.push(e));

    // Drive the principal to call send_message(to=librarian).
    await m.sendMessage(
      s.id,
      'delegate [[tool:send_message {"content":"please research X","to":"librarian"}]]',
    );

    await waitFor(() => events.some((e) => e.type === "TOOL_CALL_RESULT"));
    for (const e of events) expect(() => parseEvent(e)).not.toThrow();

    // The librarian agent was auto-created by the tool's ensureAgent.
    const agents = m.listAgents(s.id).map((a) => a.name);
    expect(agents).toContain("principal");
    expect(agents).toContain("librarian");

    const result = events.find((e) => e.type === "TOOL_CALL_RESULT") as { content: string };
    expect(result.content).toContain("delivered to librarian");
  });
});

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}
