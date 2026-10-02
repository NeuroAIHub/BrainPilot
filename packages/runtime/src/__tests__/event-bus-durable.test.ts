import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgUiEvent } from "@brainpilot/protocol";
import { EventBus } from "../event-bus.js";

describe("EventBus durable writes", () => {
  it("bounds recent replay by bytes while still delivering oversized live events", () => {
    const bus = new EventBus({ maxBuffer: 100, maxBufferBytes: 600 });
    const received: AgUiEvent[] = [];
    bus.subscribe((event) => received.push(event));
    for (let index = 0; index < 20; index++) {
      bus.emitEphemeral({ type: "CUSTOM", name: "test", value: { index, text: "x".repeat(90) } } as AgUiEvent);
    }
    const oversized = { type: "CUSTOM", name: "test", value: { text: "y".repeat(1_000) } } as AgUiEvent;
    bus.emitEphemeral(oversized);
    expect(received).toHaveLength(21);
    expect(received.at(-1)).toBe(oversized);
    expect(bus.recent()).not.toContain(oversized);
    expect(Buffer.byteLength(JSON.stringify(bus.recent()))).toBeLessThan(650);
    const liveOnly = { type: "CUSTOM", name: "trace_node", value: { node: { id: "n" } } } as AgUiEvent;
    bus.emitLive(liveOnly);
    expect(received.at(-1)).toBe(liveOnly);
    expect(bus.recent()).not.toContain(liveOnly);
  });

  it("propagates durable IO failure without publishing, while ordinary emit stays best-effort", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-event-bus-"));
    const blocker = join(root, "not-a-directory");
    await writeFile(blocker, "x", "utf8");
    const bus = new EventBus({ persistPath: join(blocker, "events.jsonl") });
    const received: AgUiEvent[] = [];
    bus.subscribe((event) => received.push(event));
    const event = {
      type: "TEXT_MESSAGE_CHUNK",
      session_id: "s1",
      message_id: "m1",
      role: "assistant",
      delta: "hello",
    } as AgUiEvent;

    await expect(bus.emitDurable(event)).rejects.toThrow();
    expect(received).toEqual([]);

    expect(() => bus.emit(event)).not.toThrow();
    expect(received).toEqual([event]);
    await expect(bus.flush()).resolves.toBeUndefined();
  });
});
