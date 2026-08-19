import { describe, it, expect, beforeEach } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEvent, type AgUiEvent } from "@brainpilot/protocol";
import { SessionManager } from "../session-manager.js";
import { mockAgentFactory } from "../agent-factory.js";

function mgr(): SessionManager {
  return new SessionManager({ persist: false, agentFactory: mockAgentFactory });
}

function enqueueQuestion(
  manager: SessionManager,
  sessionId: string,
  agent: string,
  question: string,
): Promise<string> {
  const internal = manager as any;
  return internal.requestUserInput(
    internal.sessions.get(sessionId),
    agent,
    `run-${agent}`,
    { question, allow_free_text: true },
  ) as Promise<string>;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
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
    expect(req.timeout_sec).toBe(300);

    // Answer it; the blocked tool execute resolves and the turn finishes.
    const result = await m.answerInput(session.id, req.request_id, "A");
    expect(result).toBe("ok");

    // issue #132: the answer is emitted as a user_input_response so export/replay
    // preserves the Q&A. It carries the matching request_id and the answer.
    const resp = events.find((e) => e.type === "user_input_response") as any;
    expect(resp).toBeTruthy();
    expect(resp.request_id).toBe(req.request_id);
    expect(resp.answer).toBe("A");
    expect(parseEvent(resp)).toBeTruthy();

    await new Promise((r) => setTimeout(r, 20));
    const toolEnd = events.find(
      (e) => e.type === "TOOL_CALL_RESULT" && (e as any).content?.includes("A"),
    );
    expect(toolEnd).toBeTruthy();
  });

  it("routes an ordinary message as the answer while an ask_user is pending (#272)", async () => {
    const session = await m.createSession({ title: "T" });
    const events: AgUiEvent[] = [];
    m.subscribe(session.id, (e) => events.push(e));

    // Drive the agent to block on ask_user.
    await m.sendMessage(session.id, 'decide [[tool:ask_user {"question":"Pick A or B"}]]');
    await new Promise((r) => setTimeout(r, 20));
    const req = events.find((e) => e.type === "user_input_request") as any;
    expect(req).toBeTruthy();

    // Instead of using the explicit answer endpoint, the user sends plain text.
    // It must be consumed as the answer (not "already processing"), unblocking
    // the tool — a user_input_response echo carries the message content.
    const res = await m.sendMessage(session.id, "A");
    expect(res.accepted).toBe(true);

    const resp = events.find((e) => e.type === "user_input_response") as any;
    expect(resp).toBeTruthy();
    expect(resp.request_id).toBe(req.request_id);
    expect(resp.answer).toBe("A");

    // The blocked tool resolves with the routed answer.
    await new Promise((r) => setTimeout(r, 20));
    const toolEnd = events.find(
      (e) => e.type === "TOOL_CALL_RESULT" && (e as any).content?.includes("A"),
    );
    expect(toolEnd).toBeTruthy();
  });

  it("answerInput reports stale for an unknown request_id", async () => {
    const session = await m.createSession({ title: "T" });
    const events: AgUiEvent[] = [];
    m.subscribe(session.id, (e) => events.push(e));
    await expect(m.answerInput(session.id, "nope", "x")).resolves.toBe("stale");
    await expect(m.answerInput("no-session", "nope", "x")).resolves.toBe("stale");
    // issue #132: a stale/unknown answer is not recorded.
    expect(events.find((e) => e.type === "user_input_response")).toBeUndefined();
  });

  it("rejects a non-option answer when free text is disabled", async () => {
    const session = await m.createSession({ title: "T" });
    const internal = m as any;
    const pending = internal.requestUserInput(
      internal.sessions.get(session.id),
      "principal",
      "run-principal",
      { question: "Pick", options: ["A", "B"], allow_free_text: false },
    ) as Promise<string>;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const active = internal.sessions.get(session.id).userInputs.active;

    await expect(m.answerInput(session.id, active.requestId, "custom")).resolves.toBe("invalid");
    await expect(m.answerInput(session.id, active.requestId, "A")).resolves.toBe("ok");
    await expect(pending).resolves.toBe("A");
  });

  it("interrupt rejects pending inputs", async () => {
    const session = await m.createSession({ title: "T" });
    const events: AgUiEvent[] = [];
    m.subscribe(session.id, (e) => events.push(e));
    await m.sendMessage(session.id, 'decide [[tool:ask_user {"question":"Q"}]]');
    await new Promise((r) => setTimeout(r, 20));
    expect(events.find((e) => e.type === "user_input_request")).toBeTruthy();
    expect(m.getSessionState(session.id)?.workState).toMatchObject({
      active: true,
      status: "active",
    });

    await m.interrupt(session.id);
    await new Promise((r) => setTimeout(r, 20));
    // After interrupt, answering the (now-cleared) request is stale.
    const req = events.find((e) => e.type === "user_input_request") as any;
    await expect(m.answerInput(session.id, req.request_id, "late")).resolves.toBe("stale");
    const cancelled = events.find((e) => e.type === "user_input_cancelled") as any;
    expect(cancelled).toMatchObject({
      request_id: req.request_id,
      reason: "interrupted",
    });
    expect(parseEvent(cancelled)).toBeTruthy();
  });

  it("answer and interrupt produce exactly one terminal event", async () => {
    const session = await m.createSession({ title: "T" });
    const events: AgUiEvent[] = [];
    m.subscribe(session.id, (e) => events.push(e));
    await m.sendMessage(session.id, 'decide [[tool:ask_user {"question":"Q"}]]');
    await new Promise((r) => setTimeout(r, 20));
    const req = events.find((e) => e.type === "user_input_request") as any;

    await expect(m.answerInput(session.id, req.request_id, "A")).resolves.toBe("ok");
    await m.interrupt(session.id);

    const terminals = events.filter(
      (e) => e.type === "user_input_response" || e.type === "user_input_cancelled",
    );
    expect(terminals).toHaveLength(1);
    expect(terminals[0]?.type).toBe("user_input_response");
  });

  it("persists cancellation before evicting a pending request", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "bp-ask-user-evict-"));
    const manager = new SessionManager({ persist: true, dataRoot, agentFactory: mockAgentFactory });
    const session = await manager.createSession({ title: "T" });
    await manager.sendMessage(session.id, 'decide [[tool:ask_user {"question":"Q"}]]');
    await new Promise((r) => setTimeout(r, 20));

    await manager.evictSession(session.id);
    const history = await manager.readEventHistory(session.id, { limit: 0 });
    const request = history?.events.find((event) => event.type === "user_input_request") as any;
    expect(request).toBeTruthy();
    expect(history?.events.find((event) => event.type === "user_input_cancelled")).toMatchObject({
      request_id: request.request_id,
      reason: "evicted",
    });
  });

  it("shows concurrent questions one at a time in FIFO order", async () => {
    const session = await m.createSession({ title: "T" });
    const events: AgUiEvent[] = [];
    m.subscribe(session.id, (event) => events.push(event));

    const first = enqueueQuestion(m, session.id, "principal", "Q1");
    const second = enqueueQuestion(m, session.id, "writer", "Q2");
    await new Promise((resolve) => setTimeout(resolve, 20));

    let requests = events.filter((event) => event.type === "user_input_request") as any[];
    expect(requests.map((event) => event.question)).toEqual(["Q1"]);
    await expect(m.answerInput(session.id, requests[0].request_id, "A1")).resolves.toBe("ok");

    requests = events.filter((event) => event.type === "user_input_request") as any[];
    expect(requests.map((event) => event.question)).toEqual(["Q1", "Q2"]);
    await expect(m.answerInput(session.id, requests[1].request_id, "A2")).resolves.toBe("ok");
    await expect(first).resolves.toBe("A1");
    await expect(second).resolves.toBe("A2");
  });

  it("expires only the active question, notifies its agent, then promotes the queue", async () => {
    const manager = new SessionManager({
      persist: false,
      agentFactory: mockAgentFactory,
      userInputTimeoutMs: 40,
    });
    const session = await manager.createSession({ title: "T" });
    const events: AgUiEvent[] = [];
    manager.subscribe(session.id, (event) => events.push(event));

    const first = enqueueQuestion(manager, session.id, "principal", "Q1")
      .then((answer) => answer, (error) => String(error.message));
    const second = enqueueQuestion(manager, session.id, "writer", "Q2");
    await new Promise((resolve) => setTimeout(resolve, 50));

    const requests = events.filter((event) => event.type === "user_input_request") as any[];
    expect(requests.map((event) => event.question)).toEqual(["Q1", "Q2"]);
    const cancelled = events.filter((event) => event.type === "user_input_cancelled") as any[];
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).toMatchObject({ request_id: requests[0].request_id, reason: "expired" });
    await expect(first).resolves.toContain("did not answer within 5 minutes");

    await expect(manager.answerInput(session.id, requests[1].request_id, "A2")).resolves.toBe("ok");
    await expect(second).resolves.toBe("A2");
  });

  it("surfaces timeout as an ask_user tool error to the calling agent", async () => {
    const manager = new SessionManager({
      persist: false,
      agentFactory: mockAgentFactory,
      userInputTimeoutMs: 25,
    });
    const session = await manager.createSession({ title: "T" });
    const events: AgUiEvent[] = [];
    manager.subscribe(session.id, (event) => events.push(event));
    await manager.sendMessage(session.id, 'decide [[tool:ask_user {"question":"Q"}]]');
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(events.find(
      (event) => event.type === "TOOL_CALL_RESULT"
        && (event as any).is_error === true
        && (event as any).content.includes("did not answer within 5 minutes"),
    )).toBeTruthy();
    expect(events.some((event) => event.type === "RUN_FINISHED")).toBe(true);
  });

  it("targeted interrupt removes only that agent's queued question", async () => {
    const session = await m.createSession({ title: "T" });
    const events: AgUiEvent[] = [];
    m.subscribe(session.id, (event) => events.push(event));
    const principal = enqueueQuestion(m, session.id, "principal", "principal-Q");
    const writer = enqueueQuestion(m, session.id, "writer", "writer-Q")
      .then((answer) => answer, (error) => String(error.message));
    await new Promise((resolve) => setTimeout(resolve, 20));

    await m.interrupt(session.id, "writer");
    const requests = events.filter((event) => event.type === "user_input_request") as any[];
    expect(requests.map((event) => event.question)).toEqual(["principal-Q"]);
    expect(events.some((event) => event.type === "user_input_cancelled")).toBe(false);
    await expect(m.answerInput(session.id, requests[0].request_id, "continue")).resolves.toBe("ok");
    await expect(principal).resolves.toBe("continue");
    await expect(writer).resolves.toContain("interrupted");
  });

  it("destroying the active agent cancels its question and promotes the next", async () => {
    const session = await m.createSession({ title: "T" });
    const events: AgUiEvent[] = [];
    m.subscribe(session.id, (event) => events.push(event));
    await m.ensureAgent(session.id, "writer");
    const writer = enqueueQuestion(m, session.id, "writer", "writer-Q")
      .then((answer) => answer, (error) => String(error.message));
    const principal = enqueueQuestion(m, session.id, "principal", "principal-Q");
    await new Promise((resolve) => setTimeout(resolve, 20));

    await m.destroyAgent(session.id, "writer");
    const requests = events.filter((event) => event.type === "user_input_request") as any[];
    expect(requests.map((event) => event.question)).toEqual(["writer-Q", "principal-Q"]);
    expect(events.find((event) => event.type === "user_input_cancelled")).toMatchObject({
      request_id: requests[0].request_id,
      reason: "agent_destroyed",
    });
    await expect(m.answerInput(session.id, requests[1].request_id, "continue")).resolves.toBe("ok");
    await expect(writer).resolves.toContain("agent_destroyed");
    await expect(principal).resolves.toBe("continue");
  });

  it("keeps an answer active when its durable terminal write fails", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "bp-ask-user-persist-"));
    const manager = new SessionManager({ persist: true, dataRoot, agentFactory: mockAgentFactory });
    const session = await manager.createSession({ title: "T" });
    const events: AgUiEvent[] = [];
    manager.subscribe(session.id, (event) => events.push(event));
    await manager.sendMessage(session.id, 'decide [[tool:ask_user {"question":"Q"}]]');
    await waitFor(() => events.some((event) => event.type === "user_input_request"));
    const request = events.find((event) => event.type === "user_input_request") as any;
    const eventPath = join(dataRoot, ".bp", session.id, "events.jsonl");
    await rm(eventPath, { force: true });
    await mkdir(eventPath);

    await expect(manager.answerInput(session.id, request.request_id, "A")).resolves.toBe("persist_failed");
    expect(events.some((event) => event.type === "user_input_response")).toBe(false);

    await rm(eventPath, { recursive: true, force: true });
    await expect(manager.answerInput(session.id, request.request_id, "A")).resolves.toBe("ok");
  });

  it("caps active plus queued questions at eight", async () => {
    const session = await m.createSession({ title: "T" });
    const internal = m as any;
    const entry = internal.sessions.get(session.id);
    const outcomes: Array<Promise<string>> = [];
    for (let index = 0; index < 9; index++) {
      const pending = internal.requestUserInput(
        entry,
        "principal",
        undefined,
        { question: `Q${index}`, allow_free_text: true },
      ) as Promise<string>;
      outcomes.push(pending.then((answer) => answer, (error) => String(error.message)));
    }

    await expect(outcomes[8]).resolves.toContain("queue is full");
    expect(entry.userInputs.queue.length + (entry.userInputs.active ? 1 : 0)).toBe(8);
    await m.interrupt(session.id);
    await Promise.all(outcomes);
  });

  it("deleting a session settles both active and queued waiters", async () => {
    const session = await m.createSession({ title: "T" });
    const first = enqueueQuestion(m, session.id, "principal", "Q1")
      .then((answer) => answer, (error) => String(error.message));
    const second = enqueueQuestion(m, session.id, "writer", "Q2")
      .then((answer) => answer, (error) => String(error.message));

    await expect(m.deleteSession(session.id)).resolves.toBe(true);
    await expect(first).resolves.toContain("session_deleted");
    await expect(second).resolves.toContain("session_deleted");
  });
});
