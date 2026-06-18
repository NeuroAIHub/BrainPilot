import { describe, it, expect, beforeEach } from "vitest";
import { parseEvent, type AgUiEvent } from "@brainpilot/protocol";
import { SessionManager } from "../session-manager.js";
import { mockAgentFactory } from "../agent-factory.js";

function mgr(): SessionManager {
  return new SessionManager({ persist: false, agentFactory: mockAgentFactory });
}

describe("ask_user (SessionManager)", () => {
  let m: SessionManager;
  beforeEach(() => {
    m = mgr();
  });

  it("emits user_input_request and resolves the turn on answer", async () => {
    const session = await m.createSession({ title: "T" });
    const events: AgUiEvent[] = [];
    m.subscribe(session.id, (e) => events.push(e));

    // Drive the mock agent to call ask_user via the prompt control protocol.
    const res = await m.sendMessage(
      session.id,
      'please decide [[tool:ask_user {"question":"Pick A or B"}]]',
    );
    expect(res.accepted).toBe(true);

    // The request event should appear without us answering yet.
    await new Promise((r) => setTimeout(r, 20));
    const req = events.find((e) => e.type === "user_input_request") as any;
    expect(req).toBeTruthy();
    expect(req.question).toBe("Pick A or B");
    expect(typeof req.request_id).toBe("string");

    // Answer it; the blocked tool execute resolves and the turn finishes.
    const okResolved = m.resolveInput(session.id, req.request_id, "A");
    expect(okResolved).toBe(true);

    await new Promise((r) => setTimeout(r, 20));
    const toolEnd = events.find(
      (e) => e.type === "TOOL_CALL_RESULT" && (e as any).content?.includes("A"),
    );
    expect(toolEnd).toBeTruthy();
  });

  it("resolveInput returns false for unknown request_id", async () => {
    const session = await m.createSession({ title: "T" });
    expect(m.resolveInput(session.id, "nope", "x")).toBe(false);
    expect(m.resolveInput("no-session", "nope", "x")).toBe(false);
  });

  it("interrupt rejects pending inputs", async () => {
    const session = await m.createSession({ title: "T" });
    const events: AgUiEvent[] = [];
    m.subscribe(session.id, (e) => events.push(e));
    await m.sendMessage(session.id, 'decide [[tool:ask_user {"question":"Q"}]]');
    await new Promise((r) => setTimeout(r, 20));
    expect(events.find((e) => e.type === "user_input_request")).toBeTruthy();

    await m.interrupt(session.id);
    await new Promise((r) => setTimeout(r, 20));
    // After interrupt, answering the (now-cleared) request is stale.
    const req = events.find((e) => e.type === "user_input_request") as any;
    expect(m.resolveInput(session.id, req.request_id, "late")).toBe(false);
  });
});
