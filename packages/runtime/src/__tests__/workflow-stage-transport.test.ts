/**
 * Unit coverage for the stage-transport wrapper installed on Pi's public
 * `agent.streamFunction` (`installWorkflowStageCancellation`).
 *
 * SCOPE: these tests drive a hand-written stand-in for Pi's provider stream — a
 * `result()` producer promise plus an *independent* consumer iterator — so they
 * pin down the wrapper's signal plumbing, its request bookkeeping and the fact
 * that it hands the SDK's own stream instance back untouched. They prove nothing
 * about a real HTTP request: no socket, no provider and no Pi agent loop is
 * involved here. Real-transport evidence (a stage deadline or Stop actually
 * closing the provider response) comes only from
 * `scripts/workflow-stage-lifecycle-probe.mjs`, which runs the real factory,
 * host and Pi SDK against a loopback SSE fixture.
 */
import { afterEach, describe, expect, it } from "vitest";
import { installWorkflowStageCancellation, type StageStreamFn } from "../agent-factory.js";
import { WorkflowStageLifecycle } from "../workflows/stage-lifecycle.js";
import type { WorkflowStageCancellation } from "../types.js";

/**
 * Stand-in for a Pi provider stream: private state behind `#` fields, a manual
 * iterator that counts early consumer `return()`s, and no coupling between the
 * producer's completion and whether anyone iterates.
 */
class FakeStream {
  readonly #queue: unknown[] = [];
  readonly #label = "fake-provider-stream";
  #wake: (() => void) | undefined;
  #closed = false;
  #error: unknown;
  iterators = 0;
  returns = 0;

  /** Reads a private field, so a lost receiver throws instead of quietly working. */
  describe(): string { return this.#label; }

  push(message: unknown): void { this.#queue.push(message); this.#wakeUp(); }
  end(): void { this.#closed = true; this.#wakeUp(); }
  fail(error: unknown): void { this.#closed = true; this.#error = error; this.#wakeUp(); }

  #wakeUp(): void { const wake = this.#wake; this.#wake = undefined; wake?.(); }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    this.iterators++;
    return {
      next: async (): Promise<IteratorResult<unknown>> => {
        while (!this.#queue.length && !this.#closed) await new Promise<void>((resolve) => { this.#wake = resolve; });
        if (this.#queue.length) return { done: false, value: this.#queue.shift() };
        if (this.#error) throw this.#error;
        return { done: true, value: undefined };
      },
      return: async (value?: unknown): Promise<IteratorResult<unknown>> => { this.returns++; return { done: true, value }; },
    };
  }
}

/** The supported SDK shape: the producer also exposes its own completion promise. */
class FakeProviderStream extends FakeStream {
  #settled = false;
  #resolve!: () => void;
  #reject!: (error: unknown) => void;
  readonly #completion = new Promise<void>((resolve, reject) => { this.#resolve = resolve; this.#reject = reject; });

  /** Pi's public completion promise; reading `#completion` needs the real receiver. */
  result(): Promise<void> { return this.#completion; }

  override end(): void { super.end(); if (!this.#settled) { this.#settled = true; this.#resolve(); } }
  override fail(error: unknown): void { super.fail(error); if (!this.#settled) { this.#settled = true; this.#reject(error); } }
}

/** Minimal `WorkflowStageCancellation` that only records what the wrapper did. */
class RecordingCancellation implements WorkflowStageCancellation {
  private readonly controller = new AbortController();
  starts = 0;
  releases = 0;
  get signal(): AbortSignal { return this.controller.signal; }
  cancel(reason: string): void { this.controller.abort(new Error(reason)); }
  requestStarted(): () => void {
    this.starts++;
    let reported = false;
    return () => { if (!reported) { reported = true; this.releases++; } };
  }
}

/** Install the wrapper on a fake Pi session and return the wrapped stream function. */
function installOn(cancellation: WorkflowStageCancellation, inner: StageStreamFn): StageStreamFn {
  const session = { agent: { streamFunction: inner } };
  installWorkflowStageCancellation(session, cancellation);
  return session.agent.streamFunction;
}

const lifecycles: WorkflowStageLifecycle[] = [];
function stageLifecycle(parentSignal: AbortSignal, timeoutMs = 60_000): WorkflowStageLifecycle {
  const lifecycle = new WorkflowStageLifecycle({ parentSignal, timeoutMs, cleanupGraceMs: 20 });
  lifecycles.push(lifecycle);
  return lifecycle;
}
/** Let the wrapper's own settlement handler run before the count is read. */
const flush = async (): Promise<void> => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
// Deadlines are unref'd, but a finished test should not keep one armed either.
afterEach(async () => { await Promise.all(lifecycles.splice(0).map((lifecycle) => lifecycle.close())); });

describe("installWorkflowStageCancellation", () => {
  it("requires Pi's public stream function", () => {
    const recorder = new RecordingCancellation();
    expect(() => installWorkflowStageCancellation({}, recorder)).toThrow(/public agent stream function/);
    expect(() => installWorkflowStageCancellation({ agent: {} }, recorder)).toThrow(/public agent stream function/);
    expect(recorder.starts).toBe(0);
  });

  it("returns the SDK's own stream instance, with its prototype and private state intact", async () => {
    const lifecycle = stageLifecycle(new AbortController().signal);
    const stream = new FakeProviderStream();
    const wrapped = await installOn(lifecycle, () => stream)({}, {}, {}) as FakeProviderStream;
    expect(wrapped).toBe(stream);
    expect(Object.getPrototypeOf(wrapped)).toBe(FakeProviderStream.prototype);
    expect(wrapped.describe()).toBe("fake-provider-stream");
    expect(wrapped.result()).toBe(stream.result());
    stream.end();
    await flush();
  });

  it("releases the request when only `result()` is consumed (no iteration at all)", async () => {
    const lifecycle = stageLifecycle(new AbortController().signal);
    const stream = new FakeProviderStream();
    const wrapped = await installOn(lifecycle, () => stream)({}, {}, {}) as FakeProviderStream;
    expect(lifecycle.transportBound).toBe(true);
    expect(lifecycle.openProviderRequests).toBe(1);
    // Compaction/summarization awaits the producer without ever iterating.
    stream.push({ type: "text" });
    stream.end();
    await wrapped.result();
    await flush();
    expect(lifecycle.openProviderRequests).toBe(0);
    expect(stream.iterators).toBe(0);
    expect(lifecycle.cleanupFailures).toEqual([]);
  });

  it("keeps the request open when a consumer stops early, and releases it when the producer finishes", async () => {
    const lifecycle = stageLifecycle(new AbortController().signal);
    const stream = new FakeProviderStream();
    const wrapped = await installOn(lifecycle, () => stream)({}, {}, {}) as FakeProviderStream;
    stream.push({ type: "first" });
    const iterator = wrapped[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ done: false, value: { type: "first" } });
    await iterator.return?.(undefined);
    await flush();
    // The consumer walked away; the producer never settled, so nothing is claimed.
    expect(stream.returns).toBe(1);
    expect(lifecycle.openProviderRequests).toBe(1);
    stream.end();
    await wrapped.result();
    await flush();
    expect(lifecycle.openProviderRequests).toBe(0);
  });

  it("releases on a producer rejection and leaves that rejection observable", async () => {
    const lifecycle = stageLifecycle(new AbortController().signal);
    const stream = new FakeProviderStream();
    const wrapped = await installOn(lifecycle, () => stream)({}, {}, {}) as FakeProviderStream;
    stream.fail(new Error("provider stream failed"));
    await flush();
    expect(lifecycle.openProviderRequests).toBe(0);
    // The wrapper handled the rejection for its own bookkeeping without
    // consuming it: whoever awaits the stream still sees the failure.
    await expect(wrapped.result()).rejects.toThrow("provider stream failed");
  });

  it("releases the request when the provider stream function itself throws", async () => {
    const recorder = new RecordingCancellation();
    const stageStream = installOn(recorder, () => { throw new Error("provider refused the request"); });
    await expect(stageStream({}, {}, {})).rejects.toThrow("provider refused the request");
    expect(recorder.starts).toBe(1);
    expect(recorder.releases).toBe(1);
  });

  it("forwards a signal that the stage's own cancellation aborts", async () => {
    const parent = new AbortController();
    const lifecycle = stageLifecycle(parent.signal);
    const run = new AbortController();
    const seen: Array<AbortSignal | undefined> = [];
    const stream = new FakeProviderStream();
    const stageStream = installOn(lifecycle, (_model, _context, options) => { seen.push(options?.signal); return stream; });
    await stageStream({}, {}, { signal: run.signal, extra: "preserved" });
    const signal = seen[0]!;
    expect(signal).toBeDefined();
    expect(signal).not.toBe(run.signal);
    expect(signal.aborted).toBe(false);
    parent.abort(new Error("session Stop"));
    expect(lifecycle.terminationReason).toBe("stopped");
    expect(lifecycle.signal.aborted).toBe(true);
    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error).message).toBe("session Stop");
    stream.end();
    await flush();
  });

  it("forwards the run's own abort too, and passes the stage signal through when Pi supplies none", async () => {
    const lifecycle = stageLifecycle(new AbortController().signal);
    const run = new AbortController();
    const seen: Array<AbortSignal | undefined> = [];
    const options: Array<Record<string, unknown> | undefined> = [];
    const stream = new FakeProviderStream();
    const stageStream = installOn(lifecycle, (_model, _context, given) => {
      seen.push(given?.signal); options.push(given as Record<string, unknown> | undefined); return stream;
    });
    await stageStream({}, {}, { signal: run.signal, thinkingLevel: "low" });
    expect(options[0]?.thinkingLevel).toBe("low");
    run.abort(new Error("agent loop aborted"));
    expect(seen[0]!.aborted).toBe(true);
    expect(lifecycle.signal.aborted).toBe(false);
    await stageStream({}, {}, undefined);
    expect(seen[1]).toBe(lifecycle.signal);
    stream.end();
    await flush();
  });

  it("never reaches the provider when the stage is already fenced", async () => {
    const parent = new AbortController();
    parent.abort(new Error("run stopped before the stage started"));
    const lifecycle = stageLifecycle(parent.signal);
    let innerCalls = 0;
    const stageStream = installOn(lifecycle, () => { innerCalls++; return new FakeProviderStream(); });
    let prompts = 0;
    await expect(lifecycle.run({
      // The lifecycle refuses a fenced stage before Pi can prompt, so the
      // wrapped stream function is never entered.
      prompt: async () => { prompts++; await stageStream({}, {}, {}); },
      complete: () => "unreachable",
    })).rejects.toThrow("run stopped before the stage started");
    expect(prompts).toBe(0);
    expect(innerCalls).toBe(0);
    expect(lifecycle.transportBound).toBe(false);
    expect(lifecycle.openProviderRequests).toBe(0);
  });

  it("falls back to iteration only for a stream without `result()`, keeping the receiver", async () => {
    const lifecycle = stageLifecycle(new AbortController().signal);
    const stream = new FakeStream();
    const wrapped = await installOn(lifecycle, () => stream)({}, {}, {}) as FakeStream;
    expect(wrapped).not.toBe(stream);
    // A method reached through the proxy still runs against the real instance.
    expect(wrapped.describe()).toBe("fake-provider-stream");
    stream.push({ type: "first" });
    const abandoned = wrapped[Symbol.asyncIterator]();
    await abandoned.next();
    await abandoned.return?.(undefined);
    await flush();
    expect(stream.returns).toBe(1);
    expect(lifecycle.openProviderRequests).toBe(1);
    const drained: unknown[] = [];
    stream.push({ type: "second" });
    stream.end();
    const iterator = wrapped[Symbol.asyncIterator]();
    for (let step = await iterator.next(); !step.done; step = await iterator.next()) drained.push(step.value);
    await flush();
    expect(drained).toEqual([{ type: "second" }]);
    expect(lifecycle.openProviderRequests).toBe(0);
  });

  it("releases a `result()`-less stream whose iteration fails", async () => {
    const recorder = new RecordingCancellation();
    const stream = new FakeStream();
    const wrapped = await installOn(recorder, () => stream)({}, {}, {}) as FakeStream;
    stream.fail(new Error("transport died mid-stream"));
    const iterator = wrapped[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow("transport died mid-stream");
    expect(recorder.releases).toBe(1);
  });

  it("counts each bound request and records one that starts after the fence", async () => {
    const parent = new AbortController();
    const lifecycle = stageLifecycle(parent.signal);
    const streams: FakeProviderStream[] = [];
    const stageStream = installOn(lifecycle, () => { const stream = new FakeProviderStream(); streams.push(stream); return stream; });
    await stageStream({}, {}, {});
    await stageStream({}, {}, {});
    expect(lifecycle.openProviderRequests).toBe(2);
    expect(lifecycle.cleanupFailures).toEqual([]);
    parent.abort(new Error("stopped"));
    await stageStream({}, {}, {});
    expect(lifecycle.openProviderRequests).toBe(3);
    expect(lifecycle.cleanupFailures).toEqual(["a provider request started after this stage was fenced"]);
    for (const stream of streams) stream.end();
    await flush();
    expect(lifecycle.openProviderRequests).toBe(0);
  });
});
