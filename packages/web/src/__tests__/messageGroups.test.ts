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
