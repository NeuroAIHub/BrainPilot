import { describe, it, expect } from "vitest";
import {
  renderAgentStatusBlock,
  collectAgentStatusLines,
  makeAgentStatusExt,
  type AgentStatusLine,
  type StatusAgentLike,
} from "../extensions/agent-status.js";

/* ----------------------- pure renderer (#97 option B) ---------------------- */

describe("renderAgentStatusBlock", () => {
  it("returns empty string when there are no agents", () => {
    expect(renderAgentStatusBlock([])).toBe("");
  });

  it("returns empty string when only idle agents have no pending messages", () => {
    expect(renderAgentStatusBlock([{ name: "principal", status: "idle", unread: 0 }])).toBe("");
  });

  it("renders an internal-only line per active or pending agent", () => {
    const lines: AgentStatusLine[] = [
      { name: "principal", status: "running", unread: 1 },
      { name: "experimentalist", status: "idle", unread: 0 },
      { name: "librarian", status: "idle", unread: 1 },
      { name: "engineer", status: "error", unread: 2 },
    ];
    const out = renderAgentStatusBlock(lines);
    expect(out).toContain("<internal_agent_status>");
    expect(out).toContain("</internal_agent_status>");
    expect(out).toContain("Never mention");
    expect(out).toContain("- principal: status=running, 1 pending message");
    expect(out).not.toContain("experimentalist");
    expect(out).toContain("- librarian: 1 pending message");
    expect(out).toContain("- engineer: status=error, 2 pending messages");
  });

  it("uses the singular form for exactly one pending message", () => {
    const out = renderAgentStatusBlock([{ name: "x", status: "idle", unread: 1 }]);
    expect(out).toContain("1 pending message");
    expect(out).not.toContain("1 pending messages");
  });

  it("uses the plural form for many pending messages", () => {
    const out = renderAgentStatusBlock([
      { name: "b", status: "idle", unread: 3 },
    ]);
    expect(out).toContain("3 pending messages");
  });
});

/* --------------------------- line collection ------------------------------ */

describe("collectAgentStatusLines", () => {
  const unread = (counts: Record<string, number>) => (name: string) => counts[name] ?? 0;

  it("includes the principal itself when active or pending", () => {
    const agents: StatusAgentLike[] = [
      { name: "principal", role: "principal", status: "running" },
      { name: "engineer", role: "expert", status: "idle" },
    ];
    const lines = collectAgentStatusLines(agents, unread({ principal: 1, engineer: 0 }));
    expect(lines.map((l) => l.name)).toEqual(["principal"]);
    expect(lines.find((l) => l.name === "principal")?.unread).toBe(1);
  });

  it("excludes the trace agent", () => {
    const agents: StatusAgentLike[] = [
      { name: "principal", role: "principal", status: "running" },
      { name: "trace", role: "trace", status: "running" },
    ];
    const lines = collectAgentStatusLines(agents, unread({}));
    expect(lines.map((l) => l.name)).toEqual(["principal"]);
  });

  it("excludes stopped agents", () => {
    const agents: StatusAgentLike[] = [
      { name: "principal", role: "principal", status: "running" },
      { name: "engineer", role: "expert", status: "stopped" },
    ];
    const lines = collectAgentStatusLines(agents, unread({}));
    expect(lines.map((l) => l.name)).toEqual(["principal"]);
  });

  it("excludes idle agents with no pending messages", () => {
    const agents: StatusAgentLike[] = [
      { name: "principal", role: "principal", status: "idle" },
      { name: "writer", role: "expert", status: "idle" },
    ];
    const lines = collectAgentStatusLines(agents, unread({}));
    expect(lines).toEqual([]);
  });

  it("carries the unread count from the inbox", () => {
    const agents: StatusAgentLike[] = [
      { name: "engineer", role: "expert", status: "error" },
    ];
    const lines = collectAgentStatusLines(agents, unread({ engineer: 3 }));
    expect(lines[0]).toEqual({ name: "engineer", status: "error", unread: 3 });
  });
});

/* ------------------------- context-hook behaviour -------------------------- */

interface FakeMsg {
  role: string;
  content: Array<{ type: string; text?: string }>;
}

/** Minimal fake `pi` that captures the single `context` handler. */
function fakePi() {
  let handler:
    | ((e: { messages: FakeMsg[] }) => { messages: FakeMsg[] } | void)
    | undefined;
  const pi = {
    on(_event: "context", h: (e: { messages: FakeMsg[] }) => { messages: FakeMsg[] } | void) {
      handler = h;
    },
  };
  return {
    pi,
    fire(messages: FakeMsg[]) {
      if (!handler) throw new Error("no context handler registered");
      return handler({ messages });
    },
  };
}

const userMsg = (text: string): FakeMsg => ({ role: "user", content: [{ type: "text", text }] });

describe("makeAgentStatusExt — context hook", () => {
  it("appends a fresh status block before the LLM call", () => {
    const block = "<internal_agent_status>\nfresh\n</internal_agent_status>";
    const { pi, fire } = fakePi();
    makeAgentStatusExt({ renderStatus: () => block })(pi as never);

    const res = fire([userMsg("hello")]);
    expect(res).toBeDefined();
    const msgs = (res as { messages: FakeMsg[] }).messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual(userMsg("hello"));
    expect(msgs[1].content[0].text).toBe(block);
  });

  it("strips a stale block from a previous turn and injects only the latest", () => {
    const stale = "<agent_status>\nold\n</agent_status>";
    const fresh = "<internal_agent_status>\nnew\n</internal_agent_status>";
    const { pi, fire } = fakePi();
    makeAgentStatusExt({ renderStatus: () => fresh })(pi as never);

    const res = fire([userMsg("hello"), userMsg(stale)]);
    const msgs = (res as { messages: FakeMsg[] }).messages;
    // exactly one status block, and it is the fresh one
    const blocks = msgs.filter((m) =>
      (m.content[0].text ?? "").startsWith("<internal_agent_status>"),
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content[0].text).toBe(fresh);
    // the real user message survives
    expect(msgs.some((m) => m.content[0].text === "hello")).toBe(true);
  });

  it("strips a stale block and injects nothing when there is nothing to report", () => {
    const stale = "<agent_status>\nold\n</agent_status>";
    const { pi, fire } = fakePi();
    makeAgentStatusExt({ renderStatus: () => "" })(pi as never);

    const res = fire([userMsg("hello"), userMsg(stale)]);
    const msgs = (res as { messages: FakeMsg[] }).messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content[0].text).toBe("hello");
  });

  it("leaves messages untouched (no rewrite) when nothing to report and no stale block", () => {
    const { pi, fire } = fakePi();
    makeAgentStatusExt({ renderStatus: () => "" })(pi as never);

    const res = fire([userMsg("hello")]);
    expect(res).toBeUndefined();
  });
});
