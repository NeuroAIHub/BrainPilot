import { describe, it, expect } from "vitest";
import { mergeRehydratedMessages } from "../contexts/SessionContext";
import type { ChatMessage } from "../contracts/backend";

function msg(id: string, content = id): ChatMessage {
  return { id, role: "assistant", content, createdAt: "2026-01-01T00:00:00.000Z" };
}

describe("mergeRehydratedMessages (#194-B1)", () => {
  it("seeds the full history when nothing is live yet", () => {
    const history = [msg("a"), msg("b"), msg("c")];
    expect(mergeRehydratedMessages([], history).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("does NOT drop history when SSE has already seeded a recent tail", () => {
    // The regression: refresh → SSE ring buffer delivers only the last 2 msgs
    // before history (the full log) lands. Old guard kept just these two.
    const sseTail = [msg("y"), msg("z")];
    const fullHistory = [msg("v"), msg("w"), msg("x"), msg("y"), msg("z")];
    const merged = mergeRehydratedMessages(sseTail, fullHistory);
    // Full history is restored, in order, with no duplicates.
    expect(merged.map((m) => m.id)).toEqual(["v", "w", "x", "y", "z"]);
  });

  it("preserves live-only messages history does not contain (optimistic/newer)", () => {
    const live = [msg("x"), msg("optimistic-1"), msg("newer-2")];
    const history = [msg("w"), msg("x")];
    const merged = mergeRehydratedMessages(live, history);
    // History base first, then the live-only tail in its original order.
    expect(merged.map((m) => m.id)).toEqual(["w", "x", "optimistic-1", "newer-2"]);
  });

  it("dedupes by id (history wins the shared ids)", () => {
    const live = [msg("a", "stale"), msg("b", "live-only")];
    const history = [msg("a", "canonical")];
    const merged = mergeRehydratedMessages(live, history);
    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
    expect(merged.find((m) => m.id === "a")!.content).toBe("canonical");
  });
});
