import { describe, it, expect } from "vitest";
import { parseEvent, type AgUiEvent } from "@brainpilot/protocol";
import { EventBus } from "../event-bus.js";
import { MasAgent } from "../mas-agent.js";
import { MockAgentSession } from "../mock-agent.js";
import { ev } from "../events.js";

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

  describe("ev.userInputRequest", () => {
    it("builds a valid user_input_request event", () => {
      const e = ev.userInputRequest(
        { sessionId: "s1", runId: "run_1" },
        { request_id: "req_1", agent: "principal", question: "Pick one", options: ["a", "b"], allow_free_text: true },
      );
      const parsed = parseEvent(e); // throws if invalid against the protocol union
      expect(parsed.type).toBe("user_input_request");
      expect((parsed as any).request_id).toBe("req_1");
      expect((parsed as any).question).toBe("Pick one");
      expect((parsed as any).options).toEqual(["a", "b"]);
      expect((parsed as any).session_id).toBe("s1");
    });
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

  // Pi's compaction lifecycle used to be silently suppressed. It now surfaces on
  // the AG-UI CUSTOM channel (name:"compaction") + a friendly system_message so
  // clients see auto-compaction rather than a mid-run context reset.
  describe("compaction translation", () => {
    // Drive a MasAgent with a minimal fake Pi session that replays scripted events.
    async function driveCompaction(events: unknown[]): Promise<AgUiEvent[]> {
      const bus = new EventBus();
      const captured: AgUiEvent[] = [];
      bus.subscribe((e) => captured.push(e));
      let listener: ((e: unknown) => void) | undefined;
      const session = {
        subscribe(l: (e: unknown) => void) {
          listener = l;
          return () => {};
        },
        async prompt() {
          for (const e of events) listener?.(e);
        },
        async abort() {},
        dispose() {},
      };
      const agent = new MasAgent({
        sessionId: "s-compact",
        name: "principal",
        role: "principal",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        session: session as any,
        bus,
      });
      await agent.prompt("go");
      for (const e of captured) expect(() => parseEvent(e)).not.toThrow();
      return captured;
    }

    it("success path → 2 CUSTOM(name=compaction) + 2 info system_messages", async () => {
      const captured = await driveCompaction([
        { type: "compaction_start", reason: "threshold" },
        {
          type: "compaction_end",
          reason: "threshold",
          aborted: false,
          willRetry: false,
          result: { tokensBefore: 195000, estimatedTokensAfter: 24000, firstKeptEntryId: "u_42" },
        },
      ]);
      const customs = captured.filter(
        (e) => e.type === "CUSTOM" && (e as { name?: string }).name === "compaction",
      ) as Array<{ value: Record<string, unknown> }>;
      expect(customs).toHaveLength(2);
      expect(customs[0].value).toMatchObject({ op: "start", reason: "threshold" });
      expect(customs[1].value).toMatchObject({
        op: "end",
        reason: "threshold",
        aborted: false,
        willRetry: false,
        tokensBefore: 195000,
        estimatedTokensAfter: 24000,
        firstKeptEntryId: "u_42",
      });
      const sys = captured.filter((e) => e.type === "system_message") as Array<{
        level: string;
        message: string;
      }>;
      expect(sys.some((s) => s.level === "info" && /压缩上下文/.test(s.message))).toBe(true);
      expect(sys.some((s) => s.level === "info" && /压缩完成/.test(s.message))).toBe(true);
    });

    it("failure path → warning system_message with provider detail", async () => {
      const captured = await driveCompaction([
        { type: "compaction_start", reason: "overflow" },
        {
          type: "compaction_end",
          reason: "overflow",
          aborted: false,
          willRetry: false,
          errorMessage: "provider 429 during summarization",
        },
      ]);
      const warn = captured.find(
        (e) => e.type === "system_message" && (e as { level?: string }).level === "warning",
      ) as { message: string; details?: string } | undefined;
      expect(warn?.message).toMatch(/压缩失败/);
      expect(warn?.details).toContain("provider 429");
    });
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
