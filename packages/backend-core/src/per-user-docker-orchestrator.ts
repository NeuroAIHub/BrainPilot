/**
 * PerUserDockerOrchestrator — dynamic (multi-user) Docker mode (#301).
 *
 * In `dynamic` deployment mode each logged-in user gets an ISOLATED sandbox
 * container. This orchestrator is a thin multi-tenant layer OVER the tested
 * single-user `DockerOrchestrator`: it keeps one `DockerOrchestrator` per
 * `userId`, hands each a distinct host port (from a pool) and a per-user data
 * dir, and reaps idle users' containers.
 *
 * Routing key is `EnsureRuntimeOptions.userId`. When no `userId` is supplied
 * (self-hosted / no gateway) it degrades to a single shared instance keyed by a
 * sentinel id, so the behaviour matches the single-user DockerOrchestrator.
 *
 * The per-user runtime logic that #301 asked for lives here (in the public
 * `@brainpilot/backend-core` package) so downstream multi-user repos only need
 * to wire the gateway/auth + storage, not fork the orchestrator.
 */
import type {
  EnsureRuntimeOptions,
  Orchestrator,
  RuntimeHandle,
} from "./orchestrator.js";
import {
  DockerOrchestrator,
  type DockerOrchestratorOptions,
} from "./docker-orchestrator.js";

/** Sentinel user id used when a caller supplies none (single shared sandbox). */
const DEFAULT_USER = "__default__";

/** Metrics shape we read off a per-user runtime for idle-reclaim (R-3). */
interface RuntimeMetrics {
  runningAgents?: number;
  reclaimable?: boolean;
  lastActivityAt?: string | null;
}

export interface PerUserDockerOrchestratorOptions
  extends Omit<DockerOrchestratorOptions, "hostPort" | "dataDir"> {
  /**
   * Host data root. Each user's data dir is `<dataRoot>/<userId>`, bind-mounted
   * into that user's container as `containerDataDir`. Omitted → no per-user
   * bind mount (containers run with ephemeral storage).
   */
  dataRoot?: string;
  /** Lowest host port to hand out. Default 8100. */
  portMin?: number;
  /** Highest host port to hand out (inclusive). Default 8199. */
  portMax?: number;
  /**
   * Idle threshold (ms). A container is considered only when Runtime reports
   * `reclaimable=true`; the atomic reclaim probe must then also accept it.
   * Default 0 (off) — callers/compose opt in via BP_DYNAMIC_IDLE_MS.
   */
  idleMs?: number;
  /** Reaper poll interval (ms). Default 60_000. */
  reapIntervalMs?: number;
  /**
   * Factory for the per-user orchestrator (injectable for tests). Receives the
   * fully-resolved options (with hostPort + dataDir bound) and must return an
   * Orchestrator. Defaults to `new DockerOrchestrator(opts)`.
   */
  createOrchestrator?: (opts: DockerOrchestratorOptions) => Orchestrator;
  /**
   * Read a runtime's `GET /metrics` (injectable for tests). Defaults to a fetch
   * of `${baseUrl}/metrics`. Used only by the idle reaper.
   */
  metricsProbe?: (baseUrl: string) => Promise<RuntimeMetrics | null>;
  /** Atomically fence and re-check a Runtime before its container is stopped. */
  reclaimProbe?: (baseUrl: string) => Promise<boolean>;
  /** Injectable clock (ms). Defaults to Date.now. */
  now?: () => number;
  /** Injectable timer setter. Defaults to setInterval. */
  setIntervalFn?: (cb: () => void, ms: number) => ReturnType<typeof setInterval>;
  /** Injectable timer clearer. Defaults to clearInterval. */
  clearIntervalFn?: (t: ReturnType<typeof setInterval>) => void;
}

interface UserEntry {
  orch: Orchestrator;
  baseUrl: string;
  hostPort: number;
  lastEnsuredAt: number;
}

async function defaultMetricsProbe(
  baseUrl: string,
): Promise<RuntimeMetrics | null> {
  try {
    const res = await fetch(`${baseUrl}/metrics`);
    if (!res.ok) return null;
    return (await res.json()) as RuntimeMetrics;
  } catch {
    return null;
  }
}

async function defaultReclaimProbe(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/runtime/shutdown-if-reclaimable`, { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}

export class PerUserDockerOrchestrator implements Orchestrator {
  private readonly base: Omit<DockerOrchestratorOptions, "hostPort" | "dataDir">;
  private readonly dataRoot?: string;
  private readonly containerDataDir: string;
  private readonly portMin: number;
  private readonly portMax: number;
  private readonly idleMs: number;
  private readonly reapIntervalMs: number;
  private readonly makeOrchestrator: (
    opts: DockerOrchestratorOptions,
  ) => Orchestrator;
  private readonly metricsProbe: (baseUrl: string) => Promise<RuntimeMetrics | null>;
  private readonly reclaimProbe: (baseUrl: string) => Promise<boolean>;
  private readonly now: () => number;
  private readonly setIntervalFn: (
    cb: () => void,
    ms: number,
  ) => ReturnType<typeof setInterval>;
  private readonly clearIntervalFn: (t: ReturnType<typeof setInterval>) => void;

  private readonly users = new Map<string, UserEntry>();
  /** Single-flight per user (issue #58 pattern): concurrent first requests share one launch. */
  private readonly starting = new Map<string, Promise<RuntimeHandle>>();
  private readonly reclaiming = new Map<string, Promise<void>>();
  private readonly usedPorts = new Set<number>();
  private reaper: ReturnType<typeof setInterval> | null = null;

  constructor(options: PerUserDockerOrchestratorOptions = {}) {
    const {
      dataRoot,
      portMin,
      portMax,
      idleMs,
      reapIntervalMs,
      createOrchestrator,
      metricsProbe,
      reclaimProbe,
      now,
      setIntervalFn,
      clearIntervalFn,
      ...dockerOpts
    } = options;
    this.base = dockerOpts;
    this.dataRoot = dataRoot;
    this.containerDataDir = dockerOpts.containerDataDir ?? "/root/.bp-root";
    this.portMin = portMin ?? 8100;
    this.portMax = portMax ?? 8199;
    this.idleMs = idleMs ?? 0;
    this.reapIntervalMs = reapIntervalMs ?? 60_000;
    this.makeOrchestrator =
      createOrchestrator ?? ((opts) => new DockerOrchestrator(opts));
    this.metricsProbe = metricsProbe ?? defaultMetricsProbe;
    this.reclaimProbe = reclaimProbe ?? defaultReclaimProbe;
    this.now = now ?? (() => Date.now());
    this.setIntervalFn =
      setIntervalFn ?? ((cb, ms) => setInterval(cb, ms));
    this.clearIntervalFn = clearIntervalFn ?? ((t) => clearInterval(t));
  }

  /** Users currently holding a live container (excluding the sentinel). */
  get activeUsers(): string[] {
    return [...this.users.keys()].filter((u) => u !== DEFAULT_USER);
  }

  async ensureRuntime(opts?: EnsureRuntimeOptions): Promise<RuntimeHandle> {
    const userId = opts?.userId ?? DEFAULT_USER;
    const reclaiming = this.reclaiming.get(userId);
    if (reclaiming) {
      await reclaiming;
      return this.ensureRuntime(opts);
    }

    const existing = this.users.get(userId);
    if (existing) {
      const orch = existing.orch as Orchestrator & { health?: () => Promise<boolean> };
      const healthy = orch.health ? await orch.health() : true;
      if (healthy) {
        existing.lastEnsuredAt = this.now();
        return { baseUrl: existing.baseUrl };
      }
      // Container died — drop it so we recreate below (also frees the port).
      await this.disposeUser(userId);
    }

    const inFlight = this.starting.get(userId);
    if (inFlight) return inFlight;

    const launch = this.launchUser(userId, opts).finally(() => {
      this.starting.delete(userId);
    });
    this.starting.set(userId, launch);
    return launch;
  }

  private async launchUser(
    userId: string,
    opts?: EnsureRuntimeOptions,
  ): Promise<RuntimeHandle> {
    const hostPort = this.allocatePort();
    const dataDir =
      opts?.dataDir ??
      (this.dataRoot ? joinPath(this.dataRoot, userId) : undefined);

    const orch = this.makeOrchestrator({
      ...this.base,
      hostPort,
      ...(dataDir ? { dataDir } : {}),
    });

    let handle: RuntimeHandle;
    try {
      handle = await orch.ensureRuntime({
        ...(dataDir ? { dataDir } : {}),
        ...(opts?.sharedDir ? { sharedDir: opts.sharedDir } : {}),
        ...(opts?.env ? { env: opts.env } : {}),
      });
    } catch (err) {
      this.usedPorts.delete(hostPort);
      await orch.stopRuntime().catch(() => {});
      throw err;
    }

    this.users.set(userId, {
      orch,
      baseUrl: handle.baseUrl,
      hostPort,
      lastEnsuredAt: this.now(),
    });
    this.startReaperIfNeeded();
    return handle;
  }

  /** Health of the sentinel/default instance (Orchestrator contract). */
  async health(): Promise<boolean> {
    const entry = this.users.get(DEFAULT_USER) ?? this.users.values().next().value;
    if (!entry) return false;
    const orch = entry.orch as Orchestrator & { health?: () => Promise<boolean> };
    return orch.health ? orch.health() : true;
  }

  /** Health of a specific user's runtime. */
  async healthOf(userId: string): Promise<boolean> {
    const entry = this.users.get(userId);
    if (!entry) return false;
    const orch = entry.orch as Orchestrator & { health?: () => Promise<boolean> };
    return orch.health ? orch.health() : true;
  }

  /** Stop one user's runtime, or all of them when `userId` is omitted. */
  async stopRuntime(userId?: string): Promise<void> {
    if (userId !== undefined) {
      await this.disposeUser(userId);
      if (this.users.size === 0) this.stopReaper();
      return;
    }
    const ids = [...this.users.keys()];
    await Promise.all(ids.map((id) => this.disposeUser(id)));
    this.stopReaper();
  }

  private async disposeUser(userId: string): Promise<void> {
    const entry = this.users.get(userId);
    if (!entry) return;
    this.users.delete(userId);
    this.usedPorts.delete(entry.hostPort);
    await entry.orch.stopRuntime().catch(() => {});
  }

  private allocatePort(): number {
    for (let p = this.portMin; p <= this.portMax; p++) {
      if (!this.usedPorts.has(p)) {
        this.usedPorts.add(p);
        return p;
      }
    }
    throw new Error(
      `PerUserDockerOrchestrator: no free host port in range ` +
        `${this.portMin}-${this.portMax} (${this.usedPorts.size} in use). ` +
        `Widen BP_DYNAMIC_PORT_MIN/MAX or lower BP_DYNAMIC_IDLE_MS.`,
    );
  }

  private startReaperIfNeeded(): void {
    if (this.reaper || this.idleMs <= 0) return;
    this.reaper = this.setIntervalFn(() => {
      void this.reapIdle();
    }, this.reapIntervalMs);
    // Don't keep the event loop alive just for the reaper.
    (this.reaper as { unref?: () => void }).unref?.();
  }

  private stopReaper(): void {
    if (!this.reaper) return;
    this.clearIntervalFn(this.reaper);
    this.reaper = null;
  }

  /**
   * Idle reclaim (#301 req 4 / R-3): stop+remove a user's container only after
   * Runtime reports it reclaimable and atomically accepts the final reclaim.
   * `lastActivityAt` (from the runtime) wins; we fall back to `lastEnsuredAt`.
   */
  async reapIdle(): Promise<void> {
    if (this.idleMs <= 0) return;
    const now = this.now();
    const candidates = [...this.users.entries()];
    for (const [userId, entry] of candidates) {
      const metrics = await this.metricsProbe(entry.baseUrl);
      // If metrics are unreadable, don't reap — a transient probe failure must
      // not evict an in-use sandbox.
      if (!metrics) continue;
      if (metrics.reclaimable !== true) continue;
      const runtimeActivity = metrics.lastActivityAt
        ? Date.parse(metrics.lastActivityAt)
        : entry.lastEnsuredAt;
      const lastActivity = Math.max(
        entry.lastEnsuredAt,
        Number.isNaN(runtimeActivity) ? entry.lastEnsuredAt : runtimeActivity,
      );
      const idleFor = now - lastActivity;
      if (idleFor >= this.idleMs) {
        const operation = (async () => {
          if (this.users.get(userId) !== entry) return;
          if (await this.reclaimProbe(entry.baseUrl)) await this.disposeUser(userId);
        })().finally(() => this.reclaiming.delete(userId));
        this.reclaiming.set(userId, operation);
        await operation;
      }
    }
    if (this.users.size === 0) this.stopReaper();
  }
}

/** Join a data root and user id with a single separator, POSIX-style. */
function joinPath(root: string, userId: string): string {
  const trimmed = root.replace(/\/+$/, "");
  return `${trimmed}/${userId}`;
}
