import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_STAGE_CLEANUP_GRACE_MS, DEFAULT_STAGE_TIMEOUT_MS, WorkflowStageLifecycle, type StageSessionHandle,
} from "../workflows/stage-lifecycle.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
/** Resolves when the stage's own cancellation reaches this fixture's "transport". */
function cancelled(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => { signal.addEventListener("abort", () => resolve(), { once: true }); });
}
const tick = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

function session(behavior: { abort?: () => unknown; dispose?: () => void } = {}) {
  const record = { aborts: 0, disposed: 0 };
  const handle: StageSessionHandle = {
    abort: () => { record.aborts++; return behavior.abort?.(); },
    dispose: () => { record.disposed++; behavior.dispose?.(); },
  };
  return { handle, record };
}

function stage(options: { parent?: AbortController; timeoutMs?: number; graceMs?: number } = {}) {
  const parent = options.parent ?? new AbortController();
  const diagnostics: string[] = [];
  const lifecycle = new WorkflowStageLifecycle({
    parentSignal: parent.signal,
    timeoutMs: options.timeoutMs ?? 10_000,
    cleanupGraceMs: options.graceMs ?? 30,
    onDiagnostic: (message) => diagnostics.push(message),
  });
  return { lifecycle, parent, diagnostics };
}

// A stage that gives up must never leave a rejection nobody owns.
const unhandled: unknown[] = [];
const collect = (error: unknown) => { unhandled.push(error); };
beforeEach(() => { unhandled.length = 0; process.on("unhandledRejection", collect); });
afterEach(async () => {
  await tick(10);
  process.off("unhandledRejection", collect);
  expect(unhandled).toEqual([]);
});

describe("workflow stage lifecycle", () => {
  it("keeps the existing stage deadline and a small internal cleanup grace", () => {
    expect(DEFAULT_STAGE_TIMEOUT_MS).toBe(600_000);
    expect(DEFAULT_STAGE_CLEANUP_GRACE_MS).toBe(5_000);
  });

  it("fails a stage whose provider stream never reaches EOF, after confirming the transport stopped", async () => {
    const f = stage({ timeoutMs: 20 });
    const fixture = session();
    f.lifecycle.attach(fixture.handle);
    let completions = 0;
    await expect(f.lifecycle.run({
      // The request only ends because the stage's own signal cancelled it.
      prompt: async () => {
        const settled = f.lifecycle.requestStarted();
        await cancelled(f.lifecycle.signal);
        settled();
      },
      complete: () => { completions++; return "must not be reported"; },
    })).rejects.toThrow("Workflow stage exceeded its time limit");
    expect(completions).toBe(0);
    expect(f.lifecycle.terminationReason).toBe("timeout");
    expect(f.lifecycle.transportBound).toBe(true);
    expect(f.lifecycle.openProviderRequests).toBe(0);
    expect(f.lifecycle.cleanupFailures).toEqual([]);
    expect(fixture.record).toEqual({ aborts: 1, disposed: 1 });
    expect(f.diagnostics).toEqual([]);
  });

  it("records an ignored cancellation honestly instead of claiming the request stopped", async () => {
    const f = stage({ timeoutMs: 10, graceMs: 20 });
    // A session that ignores cancellation entirely: abort resolves, nothing stops.
    const fixture = session({ abort: async () => {} });
    f.lifecycle.attach(fixture.handle);
    const never = deferred();
    const error = await f.lifecycle.run({
      prompt: async () => { f.lifecycle.requestStarted(); await never.promise; },
      complete: () => "must not be reported",
    }).catch((thrown: unknown) => thrown as Error);
    expect(error.message).toContain("Workflow stage exceeded its time limit");
    expect(error.message).toContain("its model request did not stop within the cleanup grace");
    expect(error.message).toContain("1 provider request(s) may still be open");
    expect(f.lifecycle.cleanupFailures).toHaveLength(2);
    expect(f.diagnostics).toHaveLength(1);
    expect(fixture.record).toEqual({ aborts: 1, disposed: 1 });
    never.resolve();
  });

  it.each([
    ["throws synchronously", () => { throw new Error("abort exploded"); }],
    ["rejects", () => Promise.reject(new Error("abort exploded"))],
  ])("reports an abort that %s while still disposing the stage", async (_label, abort) => {
    const f = stage({ timeoutMs: 10 });
    const fixture = session({ abort });
    f.lifecycle.attach(fixture.handle);
    const error = await f.lifecycle.run({
      prompt: () => cancelled(f.lifecycle.signal),
      complete: () => "must not be reported",
    }).catch((thrown: unknown) => thrown as Error);
    expect(error.message).toBe("Workflow stage exceeded its time limit; cleanup incomplete: its abort failed: abort exploded");
    expect(f.lifecycle.cleanupFailures).toEqual(["its abort failed: abort exploded"]);
    expect(fixture.record).toEqual({ aborts: 1, disposed: 1 });
  });

  it("bounds an abort that never returns and still disposes the stage", async () => {
    const f = stage({ timeoutMs: 10, graceMs: 25 });
    const fixture = session({ abort: () => new Promise<void>(() => {}) });
    f.lifecycle.attach(fixture.handle);
    const started = Date.now();
    const error = await f.lifecycle.run({
      prompt: () => cancelled(f.lifecycle.signal),
      complete: () => "must not be reported",
    }).catch((thrown: unknown) => thrown as Error);
    expect(error.message).toContain("its abort did not return within the cleanup grace");
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(fixture.record).toEqual({ aborts: 1, disposed: 1 });
  });

  it("cancels on parent Stop, never consults completion, and refuses a late result", async () => {
    const f = stage();
    const fixture = session();
    f.lifecycle.attach(fixture.handle);
    let completions = 0;
    const started = deferred();
    const run = f.lifecycle.run({
      prompt: async () => { started.resolve(); await cancelled(f.lifecycle.signal); },
      complete: () => { completions++; return "must not be reported"; },
    });
    await started.promise;
    f.parent.abort(new Error("Workflow cancelled by session Stop."));
    await expect(run).rejects.toThrow("Workflow cancelled by session Stop.");
    expect(completions).toBe(0);
    expect(f.lifecycle.terminationReason).toBe("stopped");
    expect(() => f.lifecycle.assertAcceptingResult()).toThrow("Workflow cancelled by session Stop.");
    expect(fixture.record).toEqual({ aborts: 1, disposed: 1 });
  });

  it("fences a stage that is created after its parent was already stopped", async () => {
    const parent = new AbortController();
    parent.abort();
    const f = stage({ parent });
    const fixture = session();
    f.lifecycle.attach(fixture.handle);
    expect(f.lifecycle.terminationReason).toBe("stopped");
    expect(f.lifecycle.signal.aborted).toBe(true);
    let prompts = 0;
    await expect(f.lifecycle.run({
      prompt: async () => { prompts++; },
      complete: () => "must not be reported",
    })).rejects.toThrow(/aborted/i);
    expect(prompts).toBe(0);
    await f.lifecycle.close();
    expect(fixture.record).toEqual({ aborts: 1, disposed: 1 });
  });

  it("keeps the deadline authoritative over a valid result submitted in the same window", async () => {
    const f = stage({ timeoutMs: 20 });
    const fixture = session();
    f.lifecycle.attach(fixture.handle);
    const attempts: string[] = [];
    const submit = () => {
      try { f.lifecycle.assertAcceptingResult(); attempts.push("accepted"); }
      catch (error) { attempts.push(`rejected: ${(error as Error).message}`); }
    };
    await expect(f.lifecycle.run({
      prompt: async () => { submit(); await cancelled(f.lifecycle.signal); submit(); },
      complete: () => "must not be reported",
    })).rejects.toThrow("Workflow stage exceeded its time limit");
    expect(attempts).toEqual(["accepted", "rejected: Workflow stage exceeded its time limit"]);
  });

  it("returns a completed stage's result, releases its transport, then refuses late work", async () => {
    const f = stage();
    const fixture = session();
    f.lifecycle.attach(fixture.handle);
    const result = await f.lifecycle.run({
      prompt: async () => { f.lifecycle.requestStarted()(); },
      complete: () => ({ text: "complete result" }),
    });
    expect(result).toEqual({ text: "complete result" });
    // A cleanly finished stage is disposed, not aborted, but still gives up its
    // signal so no further provider traffic can belong to it.
    expect(fixture.record).toEqual({ aborts: 0, disposed: 1 });
    expect(f.lifecycle.signal.aborted).toBe(true);
    expect(f.lifecycle.acceptsEvents).toBe(false);
    expect(() => f.lifecycle.assertAcceptingResult()).toThrow(/no longer accepts a result/);
    expect(f.lifecycle.cleanupFailures).toEqual([]);
    expect(f.diagnostics).toEqual([]);
  });

  it("cancels a still-open provider request even when the stage completed", async () => {
    const f = stage();
    let settle: (() => void) | undefined;
    const fixture = session({ abort: () => { settle?.(); } });
    f.lifecycle.attach(fixture.handle);
    const result = await f.lifecycle.run({
      // The loop returned while its stream was never observed to finish.
      prompt: async () => { settle = f.lifecycle.requestStarted(); },
      complete: () => "complete result",
    });
    expect(result).toBe("complete result");
    expect(fixture.record).toEqual({ aborts: 1, disposed: 1 });
    expect(f.lifecycle.openProviderRequests).toBe(0);
    expect(f.lifecycle.cleanupFailures).toEqual([]);
  });

  it("surfaces a request failure and a rejected completion check as themselves", async () => {
    const failing = stage();
    const first = session();
    failing.lifecycle.attach(first.handle);
    await expect(failing.lifecycle.run({
      prompt: () => { throw new Error("stream decode failed"); },
      complete: () => "must not be reported",
    })).rejects.toThrow("stream decode failed");
    // A request that already ended needs no abort; teardown is still exact.
    expect(first.record).toEqual({ aborts: 0, disposed: 1 });

    const unsubmitted = stage();
    const second = session();
    unsubmitted.lifecycle.attach(second.handle);
    await expect(unsubmitted.lifecycle.run({
      prompt: async () => {},
      complete: () => { throw new Error("Workflow stage ended without a validated submit_result"); },
    })).rejects.toThrow("Workflow stage ended without a validated submit_result");
    expect(second.record).toEqual({ aborts: 0, disposed: 1 });
  });

  it("tears down a stage session that never ran and drops its deadline", async () => {
    const f = stage({ timeoutMs: 10 });
    const fixture = session();
    f.lifecycle.attach(fixture.handle);
    await f.lifecycle.close();
    expect(fixture.record).toEqual({ aborts: 1, disposed: 1 });
    await tick(30);
    expect(f.lifecycle.terminationReason).toBeUndefined();
    expect(f.diagnostics).toEqual([]);
    await f.lifecycle.close();
    expect(fixture.record).toEqual({ aborts: 1, disposed: 1 });
  });

  it("records a provider request that starts after the stage was torn down", async () => {
    const f = stage({ timeoutMs: 10, graceMs: 20 });
    const fixture = session();
    f.lifecycle.attach(fixture.handle);
    await expect(f.lifecycle.run({
      prompt: () => cancelled(f.lifecycle.signal),
      complete: () => "must not be reported",
    })).rejects.toThrow("Workflow stage exceeded its time limit");
    // e.g. a retry inside the SDK that outlived our teardown.
    const settled = f.lifecycle.requestStarted();
    expect(f.lifecycle.cleanupFailures).toContain("a provider request started after this stage was fenced");
    settled();
    expect(f.lifecycle.openProviderRequests).toBe(0);
  });

  it("does not leave an unhandled rejection when the request fails after the stage gave up", async () => {
    const f = stage({ timeoutMs: 10, graceMs: 15 });
    const fixture = session({ abort: async () => {} });
    f.lifecycle.attach(fixture.handle);
    const late = deferred();
    const run = f.lifecycle.run({
      prompt: () => late.promise.then(() => { throw new Error("late stream failure"); }),
      complete: () => "must not be reported",
    });
    await expect(run).rejects.toThrow("Workflow stage exceeded its time limit");
    late.resolve();
    await tick(10);
    expect(f.lifecycle.cleanupFailures).toContain("its model request did not stop within the cleanup grace");
  });

  it("runs exactly one stage per lifecycle", async () => {
    const f = stage();
    const fixture = session();
    f.lifecycle.attach(fixture.handle);
    const first = { prompt: async () => {}, complete: () => "first" };
    expect(await f.lifecycle.run(first)).toBe("first");
    await expect(f.lifecycle.run(first)).rejects.toThrow("runs exactly one stage");
  });

  it("refuses to publish a valid result whose provider request outlived the cleanup grace", async () => {
    const f = stage({ graceMs: 20 });
    // The session reports a clean abort but its request never actually stops.
    const fixture = session({ abort: async () => {} });
    f.lifecycle.attach(fixture.handle);
    let completions = 0;
    const error = await f.lifecycle.run({
      prompt: async () => { f.lifecycle.requestStarted(); },
      complete: () => { completions++; return { text: "valid but unaccountable" }; },
    }).catch((thrown: unknown) => thrown as Error);
    // The stage completed normally, so this is not a timeout or a Stop: the
    // result exists but must not travel downstream.
    expect(f.lifecycle.terminationReason).toBeUndefined();
    expect(completions).toBe(1);
    expect(error.message).toContain("produced a result but its cleanup did not complete");
    expect(error.message).toContain("1 provider request(s) may still be open");
    expect(f.lifecycle.cleanupFailures).toEqual(["1 provider request(s) may still be open"]);
    expect(f.diagnostics).toHaveLength(1);
    expect(fixture.record).toEqual({ aborts: 1, disposed: 1 });
  });

  it("refuses to publish a valid result whose dispose failed", async () => {
    const f = stage();
    const fixture = session({ dispose: () => { throw new Error("dispose exploded"); } });
    f.lifecycle.attach(fixture.handle);
    await expect(f.lifecycle.run({
      prompt: async () => { f.lifecycle.requestStarted()(); },
      complete: () => ({ text: "valid result" }),
    })).rejects.toThrow("Workflow stage produced a result but its cleanup did not complete: its dispose failed: dispose exploded");
    expect(f.lifecycle.terminationReason).toBeUndefined();
    expect(f.lifecycle.acceptsEvents).toBe(false);
  });

  it("keeps an original request failure as itself even when teardown was incomplete", async () => {
    const f = stage({ graceMs: 20 });
    const fixture = session({ dispose: () => { throw new Error("dispose exploded"); } });
    f.lifecycle.attach(fixture.handle);
    await expect(f.lifecycle.run({
      prompt: async () => { throw new Error("stream decode failed"); },
      complete: () => "must not be reported",
    })).rejects.toThrow("stream decode failed");
    expect(f.lifecycle.cleanupFailures).toEqual(["its dispose failed: dispose exploded"]);
  });
});
