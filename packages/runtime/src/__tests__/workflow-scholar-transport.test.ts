import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Route the imported promise timer through the same fake clock as Date/global
// timers. Preserve abort semantics; no real delay or network is used here.
vi.mock("node:timers/promises", () => ({
  setTimeout: (ms: number, value: unknown, options?: { signal?: AbortSignal }) => new Promise((resolve, reject) => {
    const signal = options?.signal;
    if (signal?.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(value); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T00:00:00Z"));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const signal = () => new AbortController().signal;
const success = () => Response.json({ data: [{ title: "Returned source" }] });

describe("Semantic Scholar transport scheduling", () => {
  it("does not issue the next request before a 429 Retry-After deadline", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ message: "Rate limited" }, { status: 429, headers: { "retry-after": "5" } }))
      .mockResolvedValueOnce(success());
    vi.stubGlobal("fetch", fetcher);
    const { scholarSearch } = await import("../workflows/paper-writing.js");
    await expect(scholarSearch("first", 100, signal())).rejects.toThrow("HTTP 429");
    const next = scholarSearch("next", 3, signal());
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await next).results).toEqual([{ title: "Returned source" }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns an aborted queue waiter promptly without letting later requests overtake its predecessor", async () => {
    let finishFirst!: (value: Response) => void;
    const firstResponse = new Promise<Response>(resolve => { finishFirst = resolve; });
    const fetcher = vi.fn().mockReturnValueOnce(firstResponse).mockResolvedValue(success());
    vi.stubGlobal("fetch", fetcher);
    const { scholarSearch } = await import("../workflows/paper-writing.js");
    const first = scholarSearch("first", 100, signal());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    const waiting = scholarSearch("cancelled waiter", 3, controller.signal);
    const stopped = expect(waiting).rejects.toThrow("Stop queued run");
    const later = scholarSearch("later", 3, signal());
    try {
      controller.abort(new Error("Stop queued run"));
      await stopped; // Must settle while the first fetch is still unresolved.
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetcher).toHaveBeenCalledTimes(1);
      finishFirst(success()); await first;
      await vi.advanceTimersByTimeAsync(0);
      await later;
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("query"))).toEqual(["first", "later"]);
      expect(vi.getTimerCount()).toBe(0);
    } finally { finishFirst(success()); }
  });

  it("expires queued admission after 30 seconds without letting successors overtake an active predecessor", async () => {
    let finishHolding!: (value: Response) => void;
    const holdingResponse = new Promise<Response>(resolve => { finishHolding = resolve; });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({}, { status: 429, headers: { "retry-after": "30" } }))
      .mockReturnValueOnce(holdingResponse)
      .mockResolvedValue(success());
    vi.stubGlobal("fetch", fetcher);
    const { scholarSearch } = await import("../workflows/paper-writing.js");
    await expect(scholarSearch("limited", 100, signal())).rejects.toThrow("HTTP 429");
    const holding = scholarSearch("holding predecessor", 100, signal());
    await vi.advanceTimersByTimeAsync(0); // It owns the queue while observing Retry-After.
    const expired = expect(scholarSearch("expired waiter", 3, signal())).rejects.toThrow("30-second wait budget");
    await vi.advanceTimersByTimeAsync(1000);
    const successor = scholarSearch("successor", 3, signal()); // Its deadline is one second later.
    try {
      await vi.advanceTimersByTimeAsync(28_999);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expired; // The predecessor's real HTTP phase has just begun and is still unresolved.
      expect(fetcher).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(500);
      expect(fetcher).toHaveBeenCalledTimes(2);
      finishHolding(success()); await holding;
      await vi.advanceTimersByTimeAsync(499);
      expect(fetcher).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect((await successor).results).toHaveLength(1);
      expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("query")))
        .toEqual(["limited", "holding predecessor", "successor"]);
      expect(vi.getTimerCount()).toBe(0);
    } finally { finishHolding(success()); }
  });

  it("charges queue time against cooldown admission without shortening an explicit Retry-After", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({}, { status: 429, headers: { "retry-after": "20" } }))
      .mockResolvedValueOnce(Response.json({}, { status: 429, headers: { "retry-after": "15" } }))
      .mockResolvedValueOnce(success());
    vi.stubGlobal("fetch", fetcher);
    const { scholarSearch } = await import("../workflows/paper-writing.js");
    await expect(scholarSearch("limited", 100, signal())).rejects.toThrow("HTTP 429");
    const predecessor = expect(scholarSearch("predecessor", 100, signal())).rejects.toThrow("HTTP 429");
    const expired = expect(scholarSearch("remaining budget too small", 3, signal())).rejects.toThrow("30-second wait budget");
    await vi.advanceTimersByTimeAsync(19_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await predecessor; await expired;
    expect(fetcher).toHaveBeenCalledTimes(2);
    const later = scholarSearch("fresh admission", 3, signal());
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect((await later).results).toHaveLength(1);
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("query")))
      .toEqual(["limited", "predecessor", "fresh admission"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the HTTP timeout independent after the admission budget is spent", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({}, { status: 429, headers: { "retry-after": "30" } }))
      .mockImplementationOnce((_url: URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        const requestSignal = init.signal!;
        requestSignal.addEventListener("abort", () => reject(requestSignal.reason), { once: true });
      }));
    vi.stubGlobal("fetch", fetcher);
    const { scholarSearch } = await import("../workflows/paper-writing.js");
    await expect(scholarSearch("limited", 100, signal())).rejects.toThrow("HTTP 429");
    let settled = false;
    const request = scholarSearch("slow HTTP", 3, signal()).finally(() => { settled = true; });
    const timedOut = expect(request).rejects.toThrow("Semantic Scholar request timed out");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await timedOut;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails a cooldown beyond the wait budget without sending early or blocking the queue after expiry", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({}, { status: 429, headers: { "retry-after": "120" } }))
      .mockResolvedValueOnce(success());
    vi.stubGlobal("fetch", fetcher);
    const { scholarSearch } = await import("../workflows/paper-writing.js");
    await expect(scholarSearch("rate limited", 100, signal())).rejects.toThrow("HTTP 429");
    await expect(scholarSearch("during long cooldown", 3, signal())).rejects.toThrow("30-second wait budget");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect((await scholarSearch("after cooldown", 3, signal())).results).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});


describe("Semantic Scholar recovery under repeated rate limits", () => {
  it("increases headerless cooldowns to a bounded delay and resets them after a successful response", async () => {
    const fetcher = vi.fn();
    for (let count = 0; count < 6; count++) fetcher.mockResolvedValueOnce(Response.json({}, { status: 429 }));
    fetcher.mockResolvedValueOnce(success())
      .mockResolvedValueOnce(Response.json({}, { status: 429 }))
      .mockResolvedValueOnce(success());
    vi.stubGlobal("fetch", fetcher);
    const { scholarSearch } = await import("../workflows/paper-writing.js");
    await expect(scholarSearch("initial", 100, signal())).rejects.toThrow("HTTP 429");

    const delays = [2000, 4000, 8000, 16000, 30000, 30000];
    for (const [index, waitMs] of delays.entries()) {
      const request = scholarSearch("retry-" + index, 100, signal()).then(() => "success", error => String(error));
      await vi.advanceTimersByTimeAsync(waitMs - 1);
      expect(fetcher).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await request).toContain(index === delays.length - 1 ? "success" : "HTTP 429");
      expect(fetcher).toHaveBeenCalledTimes(index + 2);
    }

    const afterSuccess = scholarSearch("after success", 100, signal());
    const limitedAgain = expect(afterSuccess).rejects.toThrow("HTTP 429");
    await vi.advanceTimersByTimeAsync(999);
    expect(fetcher).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(1);
    await limitedAgain;
    const recovered = scholarSearch("new streak", 3, signal());
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetcher).toHaveBeenCalledTimes(8);
    await vi.advanceTimersByTimeAsync(1);
    expect((await recovered).results).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(9);
  });

  it("cancels a cooldown waiter promptly while later callers still respect the shared deadline", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({}, { status: 429 }))
      .mockResolvedValueOnce(success());
    vi.stubGlobal("fetch", fetcher);
    const { scholarSearch } = await import("../workflows/paper-writing.js");
    await expect(scholarSearch("limited", 100, signal())).rejects.toThrow("HTTP 429");
    const controller = new AbortController();
    const cancelled = scholarSearch("cancel during cooldown", 100, controller.signal);
    const stopped = expect(cancelled).rejects.toThrow("Stop cooling run");
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort(new Error("Stop cooling run"));
    await stopped;
    const later = scholarSearch("later caller", 3, signal());
    await vi.advanceTimersByTimeAsync(999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await later).results).toHaveLength(1);
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("query"))).toEqual(["limited", "later caller"]);
  });
});

