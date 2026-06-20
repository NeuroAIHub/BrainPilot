import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("persists the user message as a role:user CHUNK with the client uuid (#42)", async () => {
    const s = await m.createSession();
    const events: AgUiEvent[] = [];
    m.subscribe(s.id, (e) => events.push(e));

    await m.sendMessage(s.id, "hello from user", "principal", { uuid: "u-123" });
    await waitFor(() => events.some((e) => e.type === "RUN_FINISHED"));

    const chunk = events.find((e) => e.type === "TEXT_MESSAGE_CHUNK") as
      | (AgUiEvent & { message_id: string; role: string; delta: string })
      | undefined;
    expect(chunk).toBeDefined();
    expect(chunk?.role).toBe("user");
    expect(chunk?.message_id).toBe("u-123");
    expect(chunk?.delta).toBe("hello from user");
    expect(() => parseEvent(chunk as AgUiEvent)).not.toThrow();
  });

  it("falls back to a generated id when the client omits uuid (#42)", async () => {
    const s = await m.createSession();
    const events: AgUiEvent[] = [];
    m.subscribe(s.id, (e) => events.push(e));

    await m.sendMessage(s.id, "no uuid here");
    await waitFor(() => events.some((e) => e.type === "TEXT_MESSAGE_CHUNK"));

    const chunk = events.find((e) => e.type === "TEXT_MESSAGE_CHUNK") as
      | (AgUiEvent & { message_id: string; role: string })
      | undefined;
    expect(chunk?.role).toBe("user");
    expect(chunk?.message_id).toBeTruthy();
  });

  it("merges built-in skills MCP tools for non-trace agents", async () => {
    const seenTools: string[][] = [];
    const spyFactory: typeof mockAgentFactory = async (params) => {
      seenTools.push(params.systemTools.map((t) => t.name));
      return mockAgentFactory(params);
    };
    const sm = new SessionManager({ persist: false, agentFactory: spyFactory });
    const s = await sm.createSession();
    await sm.sendMessage(s.id, "hi");
    await waitFor(() => seenTools.length > 0);

    // Principal is a non-trace agent — should have system tools.
    const principalTools = seenTools[0]!;
    expect(principalTools).toContain("send_message");
    expect(principalTools).toContain("ask_user");
  });

  it("injects the built-in persona (not the old placeholder) for the principal", async () => {
    const seen: string[] = [];
    const spyFactory: typeof mockAgentFactory = async (params) => {
      if (params.agentName === "principal") seen.push(params.systemPrompt);
      return mockAgentFactory(params);
    };
    const sm = new SessionManager({ persist: false, agentFactory: spyFactory });
    const s = await sm.createSession();
    await sm.sendMessage(s.id, "hi");
    await waitFor(() => seen.length > 0);

    expect(seen[0]).toContain("Principal Investigator");
    expect(seen[0]).not.toMatch(/^You are the principal agent/);
    expect(seen[0]).not.toContain("mcp__builtin__");
  });

  it("prefers an on-disk bp_template/agents/<name>/prompt.md override", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-persona-"));
    const promptDir = join(root, "bp_template", "agents", "principal");
    await mkdir(promptDir, { recursive: true });
    await writeFile(join(promptDir, "prompt.md"), "# Custom PI\nDo it my way.", "utf8");

    const seen: string[] = [];
    const spyFactory: typeof mockAgentFactory = async (params) => {
      if (params.agentName === "principal") seen.push(params.systemPrompt);
      return mockAgentFactory(params);
    };
    const sm = new SessionManager({ dataRoot: root, persist: false, agentFactory: spyFactory });
    const s = await sm.createSession();
    await sm.sendMessage(s.id, "hi");
    await waitFor(() => seen.length > 0);

    // The on-disk persona is used verbatim as the base, with the language
    // directive appended at load time (#97) so it reaches pre-existing scaffolds.
    expect(seen[0]).toContain("# Custom PI\nDo it my way.");
    expect(seen[0]).toContain("## Response language");
    await rm(root, { recursive: true, force: true });
  });
});

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("SessionManager memory watchdog (§R-4 / #20)", () => {
  it("is fully opt-out when no budget is set (identical to today)", async () => {
    const m = new SessionManager({ persist: false, agentFactory: mockAgentFactory });
    const s = await m.createSession({ title: "ok" });
    const res = await m.sendMessage(s.id, "hi");
    expect(res.accepted).toBe(true);
    const metrics = m.metrics();
    expect(metrics.memLimitBytes).toBeNull();
    expect(metrics.memRatio).toBeNull();
  });

  it("refuses new sessions when RSS is over the soft limit", async () => {
    // Budget 1000B, injected RSS 900B (>85%) => over the soft threshold.
    const m = new SessionManager({
      persist: false,
      agentFactory: mockAgentFactory,
      memLimitBytes: 1000,
      readRss: () => 900,
    });
    await expect(m.createSession({ title: "nope" })).rejects.toThrow(/memory budget/);
  });

  it("refuses messages over the soft limit and emits a warning system_message", async () => {
    let rss = 100; // start healthy so the session can be created
    const m = new SessionManager({
      persist: false,
      agentFactory: mockAgentFactory,
      memLimitBytes: 1000,
      readRss: () => rss,
    });
    const s = await m.createSession({ title: "tight" });
    const events: AgUiEvent[] = [];
    m.subscribe(s.id, (e) => events.push(e));

    rss = 900; // now over 85%
    const res = await m.sendMessage(s.id, "hello");
    expect(res.accepted).toBe(false);
    expect(events.some((e) => e.type === "system_message")).toBe(true);

    const metrics = m.metrics();
    expect(metrics.memLimitBytes).toBe(1000);
    expect(metrics.memRatio).toBeCloseTo(0.9);
  });
});

