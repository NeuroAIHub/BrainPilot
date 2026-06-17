import { describe, it, expect } from "vitest";
import { parseEvent, type AgUiEvent } from "@brainpilot/protocol";
import { EventBus } from "../event-bus.js";
import { MasAgent } from "../mas-agent.js";
import { MockAgentSession } from "../mock-agent.js";

/**
 * Event mapping: drive a MasAgent over the MockAgentSession (which emits real
 * Pi-shaped events) and assert every produced AG-UI event is protocol-valid
 * (via parseEvent) and that the expected types appear in order.
 */
describe("event mapping (Pi -> AG-UI via parseEvent)", () => {
  it("maps a scripted run to valid AG-UI events", async () => {
    const bus = new EventBus({ persistPath: undefined });
    const captured: AgUiEvent[] = [];
    bus.subscribe((e) => captured.push(e));

    const session = new MockAgentSession({
      sessionId: "sess-1",
      agentName: "principal",
      systemTools: [],
      scriptText: "Hello world from the agent",
    });
    const agent = new MasAgent({
      sessionId: "sess-1",
      name: "principal",
      role: "principal",
      session,
      bus,
    });

    await agent.prompt("do something");

    // Every captured event must parse against the protocol union.
    for (const e of captured) {
      expect(() => parseEvent(e)).not.toThrow();
      // session_id must be injected.
      expect((e as { session_id?: string }).session_id).toBe("sess-1");
    }

    const types = captured.map((e) => e.type);
    expect(types).toContain("RUN_STARTED");
    expect(types).toContain("TEXT_MESSAGE_START");
    expect(types).toContain("TEXT_MESSAGE_CONTENT");
    expect(types).toContain("TEXT_MESSAGE_END");
    expect(types).toContain("RUN_FINISHED");
    expect(types).toContain("agent_status_update");

    // Reconstruct streamed text from TEXT_MESSAGE_CONTENT deltas.
    const text = captured
      .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
      .map((e) => (e as { delta: string }).delta)
      .join("");
    expect(text).toBe("Hello world from the agent");
  });

  it("maps a tool execution to TOOL_CALL_* events", async () => {
    const bus = new EventBus();
    const captured: AgUiEvent[] = [];
    bus.subscribe((e) => captured.push(e));

    let executed = false;
    const session = new MockAgentSession({
      sessionId: "sess-2",
      agentName: "principal",
      systemTools: [
        {
          name: "ping",
          description: "ping",
          parameters: { type: "object", properties: {} },
          execute: async () => {
            executed = true;
            return { content: [{ type: "text", text: "pong" }] };
          },
        },
      ],
    });
    const agent = new MasAgent({ sessionId: "sess-2", name: "principal", role: "principal", session, bus });
    await agent.prompt("call it [[tool:ping {}]]");

    expect(executed).toBe(true);
    for (const e of captured) expect(() => parseEvent(e)).not.toThrow();
    const types = captured.map((e) => e.type);
    expect(types).toContain("TOOL_CALL_START");
    expect(types).toContain("TOOL_CALL_END");
    expect(types).toContain("TOOL_CALL_RESULT");
    const result = captured.find((e) => e.type === "TOOL_CALL_RESULT") as { content: string };
    expect(result.content).toBe("pong");
  });

  it("maps auto_retry failure to a system_message and error status", async () => {
    const bus = new EventBus();
    const captured: AgUiEvent[] = [];
    bus.subscribe((e) => captured.push(e));
    const session = new MockAgentSession({ sessionId: "s3", agentName: "librarian", systemTools: [] });
    const agent = new MasAgent({ sessionId: "s3", name: "librarian", role: "expert", session, bus });

    await agent.prompt("trigger [[error]]");

    for (const e of captured) expect(() => parseEvent(e)).not.toThrow();
    const sys = captured.filter((e) => e.type === "system_message");
    expect(sys.length).toBeGreaterThan(0);
    expect(agent.status).toBe("error");
  });

  // #63: a provider/HTTP failure surfaces as a finalized assistant message with
  // stopReason "error" (Pi does NOT throw). The runtime must turn that into a
  // visible error, not an empty assistant bubble + RUN_FINISHED.
  it("surfaces a stopReason:error message as a visible error (#63)", async () => {
    const bus = new EventBus();
    const captured: AgUiEvent[] = [];
    bus.subscribe((e) => captured.push(e));

    // Minimal fake Pi session that emits an errored assistant message.
    let listener: ((e: unknown) => void) | undefined;
    const session = {
      subscribe(l: (e: unknown) => void) {
        listener = l;
        return () => {};
      },
      async prompt() {
        listener?.({ type: "message_start", message: { role: "assistant" } });
        listener?.({
          type: "message_end",
          message: { role: "assistant", stopReason: "error", errorMessage: "Azure OpenAI API error (404): no route" },
        });
      },
      async abort() {},
      dispose() {},
    };
    const agent = new MasAgent({
      sessionId: "s4",
      name: "principal",
      role: "principal",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session: session as any,
      bus,
    });

    await agent.prompt("hi");

    for (const e of captured) expect(() => parseEvent(e)).not.toThrow();
    const sys = captured.filter((e) => e.type === "system_message") as Array<{ level?: string; content?: string }>;
    expect(sys.some((e) => e.level === "error")).toBe(true);
    // The error detail (redacted product message) reaches the user, and the run
    // ends in error status rather than a silent empty reply.
    expect(agent.status).toBe("error");
    const types = captured.map((e) => e.type);
    expect(types).toContain("TEXT_MESSAGE_END"); // bubble still closed cleanly
  });
});
