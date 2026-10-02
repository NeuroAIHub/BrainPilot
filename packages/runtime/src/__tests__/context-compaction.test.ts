import { describe, expect, it, vi } from "vitest";
import { estimateRequestTokens, installContextCompactionGuard } from "../context-compaction.js";

const estimate = (message: { tokens?: number }) => message.tokens ?? 0;

function fakeSession(compaction: "success" | "error" | "abort" = "success") {
  const listeners = new Set<(event: unknown) => void>();
  const emit = (event: unknown) => listeners.forEach((listener) => listener(event));
  let releaseAbort: (() => void) | undefined;
  const assistant = { role: "assistant", timestamp: 1, usage: { totalTokens: 240_000 } };
  const toolResult = { role: "toolResult", tokens: 10_000 };
  const session = {
    model: { contextWindow: 262_144, maxTokens: 32_768 },
    settingsManager: { getCompactionSettings: () => ({ enabled: true, reserveTokens: 16_384 }) },
    sessionManager: { getBranch: () => [] },
    agent: {
      state: { messages: [assistant, toolResult] as unknown[] },
      transformContext: vi.fn(async (messages: unknown[], _signal?: AbortSignal) => messages),
      prepareNextTurnWithContext: vi.fn(async (turn: { context: { messages: unknown[] } }) => ({ context: turn.context })),
    },
    _runAutoCompaction: vi.fn(async () => {
      if (compaction === "success") {
        session.agent.state.messages = [
          { role: "compactionSummary", tokens: 8_000 },
          { role: "assistant", tokens: 100 },
          toolResult,
        ];
        emit({ type: "compaction_end", reason: "threshold", result: { summary: "short" } });
      } else {
        if (compaction === "abort") await new Promise<void>((resolve) => { releaseAbort = resolve; });
        emit({
          type: "compaction_end", reason: "threshold",
          ...(compaction === "error"
            ? { errorMessage: 'Auto-compaction failed: 400 {"error":"data_inspection_failed"}' }
            : { aborted: true }),
        });
      }
      return false;
    }),
    _checkCompaction: vi.fn(async () => true),
    _getSummarizationRequestAuth: vi.fn(async () => ({})),
    abortCompaction: vi.fn(() => { releaseAbort?.(); }),
    subscribe: (listener: (event: unknown) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return session;
}

describe("model-request context compaction", () => {
  it("counts trailing tool results against the last reported usage", () => {
    expect(estimateRequestTokens([
      { role: "assistant", timestamp: 1, usage: { totalTokens: 220_000 } },
      { role: "toolResult", tokens: 10_000 },
    ] as never[], estimate as never)).toBe(230_000);
  });

  it("compacts before another tool-loop model request and keeps the rebuilt context on later turns", async () => {
    const session = fakeSession();
    installContextCompactionGuard(session, estimate as never);
    const sent = await session.agent.transformContext(session.agent.state.messages);
    expect(session._runAutoCompaction).toHaveBeenCalledOnce();
    expect(sent).toEqual(session.agent.state.messages);
    expect(sent[0]).toMatchObject({ role: "compactionSummary" });
    const next = await session.agent.prepareNextTurnWithContext({
      context: { messages: [{ role: "assistant", tokens: 250_000 }] },
    });
    expect(next.context.messages).toEqual(session.agent.state.messages);
    await session.agent.transformContext(next.context.messages);
    expect(session._runAutoCompaction).toHaveBeenCalledOnce();
    const later = await session.agent.prepareNextTurnWithContext({
      context: { messages: [{ role: "custom", tokens: 5 }] },
    });
    expect(later.context.messages).toEqual([{ role: "custom", tokens: 5 }]);
  });

  it("raises a failed summary cause instead of sending the overfull prompt", async () => {
    const session = fakeSession("error");
    const providerContext = session.agent.transformContext;
    installContextCompactionGuard(session, estimate as never);
    await expect(session.agent.transformContext(session.agent.state.messages))
      .rejects.toThrow(/400.*data_inspection_failed/);
    expect(providerContext).not.toHaveBeenCalled();
    expect(await session._checkCompaction({ errorMessage: "Context compaction failed: 400 data_inspection_failed" }))
      .toBe(false);
    expect(session._runAutoCompaction).toHaveBeenCalledOnce();
  });

  it("links Stop to Pi's in-flight summary abort", async () => {
    const session = fakeSession("abort");
    installContextCompactionGuard(session, estimate as never);
    const controller = new AbortController();
    const pending = session.agent.transformContext(session.agent.state.messages, controller.signal);
    await vi.waitFor(() => expect(session._runAutoCompaction).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toThrow(/Aborted/);
    expect(session.abortCompaction).toHaveBeenCalledOnce();
  });
});
