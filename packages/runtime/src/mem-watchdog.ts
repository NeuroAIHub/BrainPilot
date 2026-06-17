/**
 * Memory watchdog (§R-4 / issue #20) — opt-in, in-process soft defense against
 * the container memory budget.
 *
 * The hosted instance-per-user layer injects `BP_MEM_LIMIT_MB` and enforces a
 * hard cgroup ceiling. This watchdog lets the runtime *self-throttle* before
 * the kernel OOM-kills it: past a soft threshold (default 85% of the budget)
 * the SessionManager refuses new sessions/messages and emits a system message.
 *
 * STRICT OPT-IN: `BP_MEM_LIMIT_MB` unset (or non-positive / unparseable) means
 * the feature is entirely disabled — identical behavior to today. We never
 * invent a ceiling for single-user self-hosting; the cgroup `--memory` (when
 * present) remains the only backstop in that case.
 *
 * The RSS reader and interval are injectable so the policy is unit-testable
 * without real memory pressure or wall-clock timers.
 */

/**
 * Parse `BP_MEM_LIMIT_MB` into a byte budget. Returns `null` (feature off)
 * unless the value is a positive, finite number of megabytes.
 */
export function parseMemLimitMb(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.BP_MEM_LIMIT_MB;
  if (raw === undefined || raw.trim() === "") return null;
  const mb = Number(raw);
  if (!Number.isFinite(mb) || mb <= 0) return null;
  return Math.floor(mb) * 1024 * 1024;
}

export interface MemWatchdogOptions {
  /** Budget in bytes (typically from {@link parseMemLimitMb}). */
  limitBytes: number;
  /** Fraction of the budget at which to start throttling (default 0.85). */
  softRatio?: number;
  /** Poll interval in ms (default 2000). */
  pollMs?: number;
  /** RSS reader; default reads the real process RSS. Injected in tests. */
  readRss?: () => number;
  /**
   * Called once on the rising edge into the throttled state (not every tick),
   * so the caller can emit a single warning rather than spamming.
   */
  onThrottle?: (snapshot: MemSnapshot) => void;
}

export interface MemSnapshot {
  limitBytes: number;
  rss: number;
  /** rss / limitBytes. */
  ratio: number;
}

export class MemWatchdog {
  private readonly limitBytes: number;
  private readonly softRatio: number;
  private readonly pollMs: number;
  private readonly readRss: () => number;
  private readonly onThrottle?: (snapshot: MemSnapshot) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private throttling = false;

  constructor(opts: MemWatchdogOptions) {
    this.limitBytes = opts.limitBytes;
    this.softRatio = opts.softRatio ?? 0.85;
    this.pollMs = opts.pollMs ?? 2000;
    this.readRss = opts.readRss ?? (() => process.memoryUsage().rss);
    this.onThrottle = opts.onThrottle;
  }

  /** Current footprint relative to the budget. */
  snapshot(): MemSnapshot {
    const rss = this.readRss();
    return { limitBytes: this.limitBytes, rss, ratio: rss / this.limitBytes };
  }

  /** True once RSS has reached the soft threshold — the signal to refuse work. */
  isOverSoftLimit(): boolean {
    return this.readRss() >= this.limitBytes * this.softRatio;
  }

  /** Begin polling. The interval is `unref()`d so it never holds the process open. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.pollMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Evaluate the threshold; fire {@link MemWatchdogOptions.onThrottle} on the rising edge. */
  tick(): void {
    const over = this.isOverSoftLimit();
    if (over && !this.throttling) {
      this.throttling = true;
      this.onThrottle?.(this.snapshot());
    } else if (!over && this.throttling) {
      // Fell back below the threshold — re-arm so a later spike warns again.
      this.throttling = false;
    }
  }
}
