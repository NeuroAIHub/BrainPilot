/**
 * Stage-owned cancellation and deadline lifecycle for native workflow stages.
 *
 * A stage is a one-shot, host-owned model request rather than an interactive
 * turn, so its deadline has to be its own fence: a real run kept the outline
 * stage streaming ~90 s past its 600 s limit because the host only signalled a
 * cooperative abort and then awaited that abort (and the prompt) unbounded,
 * while `submit_result` still validated nothing but the parent signal. This
 * lifecycle instead
 *
 *   1. fences the stage's own callbacks the moment it times out or the parent
 *      run is stopped, so no late result or usage can publish work,
 *   2. exposes an abort signal that the real factory binds into the provider
 *      request itself, so cancellation reaches the actual HTTP stream, and
 *   3. bounds every best-effort third-party teardown with a small grace, and
 *      records honestly when an abort/prompt/provider request did not stop —
 *      and fails the stage rather than publishing a "clean" result whose own
 *      cleanup did not complete.
 *
 * Ordinary agent sessions are untouched: nothing here is installed for them.
 */
import type { WorkflowStageCancellation } from "../types.js";

/** Whole-manuscript stages can exceed a short interactive turn; the limit stays finite. */
export const DEFAULT_STAGE_TIMEOUT_MS = 600_000;
/** How long a fenced stage waits for third-party teardown before reporting it did not settle. */
export const DEFAULT_STAGE_CLEANUP_GRACE_MS = 5_000;

export type StageTerminationReason = "timeout" | "stopped";

/** The public teardown surface the lifecycle is allowed to use, in this order. */
export interface StageSessionHandle {
  /** Cooperative abort. May throw synchronously, reject, or never settle. */
  abort(): unknown;
  /** Teardown/listener release. Best-effort; may throw. */
  dispose(): void;
}

export interface WorkflowStageLifecycleOptions {
  /** Parent run signal: session Stop and sibling failure arrive through it. */
  parentSignal: AbortSignal;
  timeoutMs?: number;
  cleanupGraceMs?: number;
  onDiagnostic?: (message: string) => void;
}

export interface WorkflowStageRun<T> {
  /** Starts the model request. Resolves when the agent loop returned. */
  prompt: () => Promise<void>;
  /** Consulted only after the lifecycle confirmed an unfenced, completed request. */
  complete: () => T;
}

type Settled = { ok: true } | { ok: false; error: unknown };

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Resolve true when `work` settled inside the grace, false when the grace expired first. */
async function withinGrace(work: Promise<unknown>, graceMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), graceMs);
    timer.unref();
  });
  // A rejection is still a settlement; it is reported by whoever owns `work`.
  try { return await Promise.race([work.then(() => true, () => true), expired]); }
  finally { clearTimeout(timer); }
}

/**
 * One workflow stage's cancellation, deadline, fence and bounded teardown.
 * Single-use: one `run()` per stage session.
 */
export class WorkflowStageLifecycle implements WorkflowStageCancellation {
  private readonly controller = new AbortController();
  private readonly graceMs: number;
  private readonly failures: string[] = [];
  private readonly requestWaiters = new Set<() => void>();
  private readonly fenced: Promise<StageTerminationReason>;
  private readonly onParentStop = () => { this.fence("stopped"); };
  private announceFence!: (reason: StageTerminationReason) => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private termination: StageTerminationReason | undefined;
  private handle: StageSessionHandle | undefined;
  private promptOutcome: Promise<Settled> | undefined;
  private promptSettled = false;
  private abortSettled = false;
  private requests = 0;
  private bound = false;
  private disposed = false;
  private teardown: Promise<void> | undefined;

  constructor(private readonly options: WorkflowStageLifecycleOptions) {
    this.graceMs = options.cleanupGraceMs ?? DEFAULT_STAGE_CLEANUP_GRACE_MS;
    this.fenced = new Promise<StageTerminationReason>((resolve) => { this.announceFence = resolve; });
    this.timer = setTimeout(() => { this.fence("timeout"); }, options.timeoutMs ?? DEFAULT_STAGE_TIMEOUT_MS);
    // A stage deadline must not be the reason the process cannot exit.
    this.timer.unref();
    options.parentSignal.addEventListener("abort", this.onParentStop, { once: true });
    if (options.parentSignal.aborted) this.fence("stopped");
  }

  /** Aborted as soon as this stage is fenced or released. Bound into the provider request. */
  get signal(): AbortSignal { return this.controller.signal; }
  /** Set once this stage lost its deadline or its parent run was stopped. */
  get terminationReason(): StageTerminationReason | undefined { return this.termination; }
  /** False once the stage session was disposed: no late result, no late usage. */
  get acceptsEvents(): boolean { return !this.disposed; }
  /** Teardown steps that did not complete; never claims a transport stopped. */
  get cleanupFailures(): readonly string[] { return this.failures; }
  /** True once a provider request actually received this stage's cancellation signal. */
  get transportBound(): boolean { return this.bound; }
  /** Provider requests this stage still holds open. */
  get openProviderRequests(): number { return this.requests; }

  /** Called by the real factory around each provider request it binds this signal into. */
  requestStarted(): () => void {
    this.bound = true;
    this.requests++;
    if (this.termination || this.disposed) {
      this.failures.push("a provider request started after this stage was fenced");
    }
    let reported = false;
    return () => {
      if (reported) return;
      reported = true;
      this.requests--;
      if (this.requests === 0) {
        for (const waiter of [...this.requestWaiters]) waiter();
        this.requestWaiters.clear();
      }
    };
  }

  /** Hand over the created stage session; the lifecycle owns its abort/dispose from here. */
  attach(session: StageSessionHandle): void { this.handle = session; }

  /**
   * Gate for `submit_result` and every other stage callback. A fenced or
   * disposed stage rejects late results even when the underlying agent is
   * still alive and would happily produce one.
   */
  assertAcceptingResult(): void {
    if (this.termination) throw this.terminalError();
    if (this.disposed) throw new Error("Workflow stage was already torn down and no longer accepts a result");
  }

  /** Run one stage to a lifecycle-approved outcome, then tear it down within the grace. */
  async run<T>(run: WorkflowStageRun<T>): Promise<T> {
    if (this.promptOutcome) throw new Error("A workflow stage lifecycle runs exactly one stage");
    this.assertAcceptingResult();
    // A synchronous throw from prompt() is an outcome, not an escape from
    // teardown, and the outcome promise is always observed (never unhandled).
    this.promptOutcome = (async () => run.prompt())().then(
      () => { this.promptSettled = true; return { ok: true } as Settled; },
      (error: unknown) => { this.promptSettled = true; return { ok: false, error } as Settled; },
    );
    await Promise.race([this.promptOutcome, this.fenced]);
    // The fence is authoritative: a result that arrived in the same tick as the
    // deadline or the parent Stop does not complete the stage.
    type Outcome = { ok: true; value: T } | { ok: false; error: unknown };
    let outcome: Outcome | undefined;
    if (!this.termination) {
      const request = await this.promptOutcome;
      if (!request.ok) outcome = { ok: false, error: request.error };
      else if (!this.termination) {
        // Only a request that really ended may be checked for a valid result.
        try { outcome = { ok: true, value: run.complete() }; }
        catch (error) { outcome = { ok: false, error }; }
      }
    }
    await this.settle(this.termination !== undefined);
    if (this.termination) throw this.terminalError();
    if (!outcome) throw new Error("Workflow stage ended without a lifecycle outcome");
    if (!outcome.ok) throw outcome.error;
    // A stage whose own teardown did not complete is not a clean success: its
    // request may still be open, so publishing this result (and continuing the
    // run on it) would build on work the host cannot account for.
    if (this.failures.length) throw this.cleanupIncompleteError();
    return outcome.value;
  }

  /**
   * Release the deadline and the parent listener. Tears down an attached
   * session that never reached `run()` (e.g. a later preparation failure).
   */
  async close(): Promise<void> {
    this.clearDeadline();
    if (this.handle && !this.teardown) await this.settle(this.termination !== undefined);
  }

  private fence(reason: StageTerminationReason): void {
    if (this.termination) return;
    this.termination = reason;
    // Cancel the real provider request first: the cooperative third-party abort
    // may throw, hang, or ignore cancellation entirely.
    if (!this.controller.signal.aborted) this.controller.abort(this.cancellationReason(reason));
    this.announceFence(reason);
  }

  private cancellationReason(reason: StageTerminationReason): Error {
    if (reason === "timeout") return new Error("Workflow stage exceeded its time limit");
    const parent: unknown = this.options.parentSignal.reason;
    return parent instanceof Error ? parent : new Error(messageOf(parent ?? "Workflow stage was cancelled"));
  }

  /** The error this stage fails with, including any teardown that did not complete. */
  private terminalError(): unknown {
    const suffix = this.failures.length ? `; cleanup incomplete: ${this.failures.join("; ")}` : "";
    if (this.termination === "timeout") return new Error(`Workflow stage exceeded its time limit${suffix}`);
    const cancelled = this.cancellationReason("stopped");
    return suffix ? new Error(`${cancelled.message}${suffix}`) : cancelled;
  }

  /** The error an otherwise valid stage fails with when its teardown did not complete. */
  private cleanupIncompleteError(): Error {
    return new Error(`Workflow stage produced a result but its cleanup did not complete: ${this.failures.join("; ")}`);
  }

  private clearDeadline(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    this.options.parentSignal.removeEventListener("abort", this.onParentStop);
  }

  private settle(fenced: boolean): Promise<void> {
    this.teardown ??= this.shutdown(fenced);
    return this.teardown;
  }

  /** Bounded, best-effort teardown. Runs exactly once per stage. */
  private async shutdown(fenced: boolean): Promise<void> {
    this.clearDeadline();
    // Even a cleanly completed stage releases its own transport before the
    // capacity slot goes back, so no HTTP request is silently abandoned.
    if (!this.controller.signal.aborted) this.controller.abort(new Error("Workflow stage was released"));
    const stopping = fenced || !this.promptSettled || this.requests > 0;
    let abortCall: Promise<void> | undefined;
    if (stopping && this.handle) {
      const handle = this.handle;
      abortCall = (async () => { await handle.abort(); })().then(
        () => { this.abortSettled = true; },
        (error: unknown) => { this.abortSettled = true; this.failures.push(`its abort failed: ${messageOf(error)}`); },
      );
    }
    const pending: Array<Promise<unknown>> = [];
    if (abortCall) pending.push(abortCall);
    if (!this.promptSettled && this.promptOutcome) pending.push(this.promptOutcome);
    if (this.requests > 0) pending.push(this.awaitProviderRequests());
    if (pending.length) await withinGrace(Promise.all(pending), this.graceMs);
    if (abortCall && !this.abortSettled) this.failures.push("its abort did not return within the cleanup grace");
    // Only a request that was actually started can be reported as not stopping:
    // a stage torn down before `run()` has no model request to hang.
    if (this.promptOutcome && !this.promptSettled) this.failures.push("its model request did not stop within the cleanup grace");
    // A race that resolved is not evidence that the transport stopped; only an
    // observed stream settlement is.
    if (this.requests > 0) this.failures.push(`${this.requests} provider request(s) may still be open`);
    // Disposal is the boundary after which nothing this stage produces is used.
    this.disposed = true;
    try { this.handle?.dispose(); }
    catch (error) { this.failures.push(`its dispose failed: ${messageOf(error)}`); }
    if (this.failures.length) this.options.onDiagnostic?.(`Workflow stage cleanup incomplete: ${this.failures.join("; ")}`);
  }

  private awaitProviderRequests(): Promise<void> {
    if (this.requests === 0) return Promise.resolve();
    return new Promise<void>((resolve) => { this.requestWaiters.add(resolve); });
  }
}
