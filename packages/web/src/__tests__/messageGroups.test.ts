import { describe, it, expect } from "vitest";
import { buildRenderItems } from "../contexts/messageGroups";
import type { ChatMessage } from "../contracts/backend";

// Folded "activity" blocks (reasoning + tool steps) must stay "in progress"
// while their owning agent's run is still active, even when no single step is
// momentarily streaming. Without run-active awareness the per-message streaming
// flags all clear between ReAct rounds and the block flashes "完成思考" in the
// gap before the next round. See messageGroups.ts buildRenderItems.

// A folded step (reasoning/tool) — these are the only kinds that group into an
// activity block; assistant text / user / errors render standalone.
function step(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: over.id ?? `s-${Math.random().toString(36).slice(2)}`,
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    agent: "principal",
    streaming: false,
    kind: "thinking",
    ...over,
  };
}

describe("buildRenderItems — activity block run-active awareness", () => {
  it("without runningAgents, block streaming derives only from step flags (legacy behavior)", () => {
    const streamingBlock = buildRenderItems([step({ streaming: true })]);
    expect(streamingBlock[0]).toMatchObject({ type: "activity", streaming: true });

    const doneBlock = buildRenderItems([step({ streaming: false })]);
    expect(doneBlock[0]).toMatchObject({ type: "activity", streaming: false });
  });

  it("keeps a block in progress when its agent's run is active but no step is streaming (the bug)", () => {
    // Between ReAct rounds: every step's END already cleared streaming, but the
    // principal run has NOT finished — the block must NOT show as done.
    const items = buildRenderItems(
      [step({ agent: "principal", streaming: false, kind: "tool" })],
      new Set(["principal"]),
    );
    expect(items[0]).toMatchObject({ type: "activity", streaming: true });
  });

  it("marks a block done when its agent is idle and no step is streaming", () => {
    const items = buildRenderItems(
      [step({ agent: "principal", streaming: false })],
      new Set<string>(), // principal not running anymore
    );
    expect(items[0]).toMatchObject({ type: "activity", streaming: false });
  });

  it("falls back to 'principal' for unattributed steps", () => {
    const items = buildRenderItems([step({ agent: undefined, streaming: false })], new Set(["principal"]));
    expect(items[0]).toMatchObject({ type: "activity", streaming: true });
  });

  it("multi-agent: an idle agent's block shows done even while another agent is still running", () => {
    // worker has finished (not in the running set); expert is still running.
    // Each block is scoped to its own agent's run state.
    const workerStep = step({ id: "w1", agent: "worker", streaming: false, kind: "tool" });
    const userBreak: ChatMessage = {
      id: "u1",
      role: "user",
      content: "next",
      createdAt: new Date().toISOString(),
      agent: "user",
      streaming: false,
      kind: "text",
    };
    const expertStep = step({ id: "e1", agent: "expert", streaming: false, kind: "thinking" });

    const items = buildRenderItems([workerStep, userBreak, expertStep], new Set(["expert"]));
    const activities = items.filter((i) => i.type === "activity");
    expect(activities).toHaveLength(2);
    // worker block (agent idle) → done; expert block (agent running) → in progress
    expect(activities[0]).toMatchObject({ streaming: false });
    expect(activities[1]).toMatchObject({ streaming: true });
  });
});

/* -------------------------------------------------------------------------- *
 * #219 — expert-agent activity grouping (groupExpert=true, 3rd arg).
 * -------------------------------------------------------------------------- */

// A standalone assistant text row for an agent.
function text(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: over.id ?? `t-${Math.random().toString(36).slice(2)}`,
    role: "assistant",
    content: over.content ?? "hello",
    createdAt: new Date().toISOString(),
    agent: over.agent ?? "principal",
    streaming: false,
    kind: "text",
    ...over,
  };
}

describe("buildRenderItems — #219 expert grouping", () => {
  it("legacy: default (groupExpert off) never emits an expertGroup", () => {
    const items = buildRenderItems(
      [text({ agent: "analyst" }), text({ agent: "analyst", id: "a2" })],
      undefined,
    );
    expect(items.some((i) => i.type === "expertGroup")).toBe(false);
  });

  it("folds a consecutive run of specialist text into one expertGroup", () => {
    const items = buildRenderItems(
      [
        text({ id: "p1", agent: "principal", content: "PI intro" }),
        text({ id: "a1", agent: "analyst" }),
        text({ id: "a2", agent: "analyst" }),
        text({ id: "p2", agent: "principal", content: "PI wrap" }),
      ],
      undefined,
      true,
    );
    // principal / group / principal
    expect(items.map((i) => i.type)).toEqual(["single", "expertGroup", "single"]);
    const group = items.find((i) => i.type === "expertGroup")!;
    expect(group).toMatchObject({ type: "expertGroup", agents: ["analyst"] });
    expect((group as { items: unknown[] }).items).toHaveLength(2);
  });

  it("PI item breaks the specialist run into separate groups", () => {
    const items = buildRenderItems(
      [
        text({ id: "a1", agent: "analyst" }),
        text({ id: "a2", agent: "analyst" }),
        text({ id: "p1", agent: "principal" }),
        text({ id: "w1", agent: "writer" }),
        text({ id: "w2", agent: "writer" }),
      ],
      undefined,
      true,
    );
    expect(items.filter((i) => i.type === "expertGroup")).toHaveLength(2);
  });

  it("important events from a specialist escape the group and stay standalone", () => {
    const err: ChatMessage = text({ id: "e1", agent: "analyst", kind: "error", content: "boom" });
    const ask: ChatMessage = {
      ...text({ id: "q1", agent: "analyst" }),
      kind: "ask_user",
      askUser: { requestId: "r1", agent: "analyst", question: "?" } as never,
    };
    const items = buildRenderItems(
      [text({ id: "a1", agent: "analyst" }), err, ask, text({ id: "a2", agent: "analyst" })],
      undefined,
      true,
    );
    // error + ask_user MUST render standalone (never buried in a collapsed group).
    const singleIds = items
      .filter((i) => i.type === "single")
      .map((i) => (i as { message: ChatMessage }).message.id);
    expect(singleIds).toContain("e1");
    expect(singleIds).toContain("q1");
    // the escapes are NOT swallowed into any group
    const groupedIds = items
      .filter((i) => i.type === "expertGroup")
      .flatMap((i) => (i as { items: { type: string; message?: ChatMessage; id: string }[] }).items)
      .map((it) => (it.type === "single" ? it.message!.id : it.id));
    expect(groupedIds).not.toContain("e1");
    expect(groupedIds).not.toContain("q1");
  });

  it("warning+ system_message from a specialist escapes; info-level folds in", () => {
    const warn: ChatMessage = {
      ...text({ id: "sw", agent: "analyst" }),
      kind: "system_message",
      systemMessage: { level: "warning", message: "heads up", recoverable: true } as never,
    };
    const info: ChatMessage = {
      ...text({ id: "si", agent: "analyst" }),
      kind: "system_message",
      systemMessage: { level: "info", message: "fyi", recoverable: true } as never,
    };
    const items = buildRenderItems(
      [info, text({ id: "a1", agent: "analyst" }), warn],
      undefined,
      true,
    );
    // info + a1 fold together; warning stays standalone.
    const group = items.find((i) => i.type === "expertGroup") as { items: RenderItemLike[] } | undefined;
    expect(group).toBeTruthy();
    expect(items.some((i) => i.type === "single" && (i as { message: ChatMessage }).message.id === "sw")).toBe(true);
  });

  it("principal items never fold into a group", () => {
    const items = buildRenderItems(
      [text({ id: "p1", agent: "principal" }), text({ id: "p2", agent: "principal" })],
      undefined,
      true,
    );
    expect(items.every((i) => i.type === "single")).toBe(true);
  });

  it("a lone specialist activity is left as-is (no double wrapper)", () => {
    const items = buildRenderItems(
      [step({ id: "a1", agent: "analyst", kind: "tool" })],
      undefined,
      true,
    );
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("activity");
  });

  it("multi-agent run dedups agent names and sets streaming from running set", () => {
    const items = buildRenderItems(
      [
        text({ id: "a1", agent: "analyst" }),
        text({ id: "w1", agent: "writer" }),
        text({ id: "a2", agent: "analyst" }),
      ],
      new Set(["writer"]),
      true,
    );
    const group = items.find((i) => i.type === "expertGroup") as
      | { agents: string[]; streaming: boolean }
      | undefined;
    expect(group).toBeTruthy();
    expect(group!.agents.sort()).toEqual(["analyst", "writer"]);
    expect(group!.streaming).toBe(true);
  });
});

// Minimal structural alias for readability in the escape test above.
type RenderItemLike = { type: string };
