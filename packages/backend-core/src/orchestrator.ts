/**
 * Orchestrator abstraction — "how to start the Runtime" (TS_PI_REFACTOR_DESIGN
 * §11A.3). The backend never speaks runtime symbols; it only needs a handle to
 * a running runtime reachable over localhost HTTP/SSE (§10, 修正4).
 *
 * Three implementations:
 *   - DockerOrchestrator        — `docker run` the brainpilot-sandbox image
 *   - StaticRuntimeOrchestrator — health-probe a pre-started sandbox (basic Docker compose)
 *   - LocalProcessOrchestrator  — child_process.spawn the runtime entrypoint
 *
 * All expose the same surface so the Hono app and the runtime client are
 * agnostic to deployment mode.
 */

/** A live runtime endpoint the backend can proxy to. */
export interface RuntimeHandle {
  /** Base URL of the runtime, e.g. `http://127.0.0.1:8081`. No trailing slash. */
  readonly baseUrl: string;
  /**
   * Stable identity for one live Runtime instance. Official orchestrators set
   * this so callers can detect a restart even when `baseUrl` is unchanged.
   * Optional for backward compatibility with third-party orchestrators.
   */
  readonly instanceId?: string;
}

export interface EnsureRuntimeOptions {
  /** Host data dir injected as BP_DATA_DIR (§11A.2). */
  readonly dataDir?: string;
  /**
   * #301: routing key for per-user (dynamic) sandbox allocation. Only the
   * PerUserDockerOrchestrator interprets it: each distinct `userId` gets its
   * own container. All other orchestrators ignore it (single-instance), so the
   * local/static/single-user-docker behaviour is unchanged when it is omitted.
   */
  readonly userId?: string;
  /**
   * #261: host dir for the cross-user READ-ONLY shared root. Docker mode
   * bind-mounts it read-only and injects `BP_SHARED_DIR`; other orchestrators
   * forward it as env so the runtime exposes it at the `/shared` prefix.
   */
  readonly sharedDir?: string;
  /** Force a specific runtime port; otherwise the orchestrator picks one. */
  readonly port?: number;
  /** Extra env vars forwarded to the runtime process/container. */
  readonly env?: Record<string, string>;
}

export interface Orchestrator {
  /**
   * Start a runtime (idempotent — repeated calls return the same handle while
   * the runtime is healthy) and resolve once it is reachable.
   */
  ensureRuntime(opts?: EnsureRuntimeOptions): Promise<RuntimeHandle>;
  /** Probe the runtime `GET /health` (§15.4). Returns false if not started. */
  health(): Promise<boolean>;
  /**
   * Gracefully stop the runtime. Safe to call when not started.
   *
   * #301: multi-tenant orchestrators accept an optional `userId` to stop a
   * single user's runtime; omitting it stops everything. Single-instance
   * orchestrators ignore the argument.
   */
  stopRuntime(userId?: string): Promise<void>;
}

export type OrchestratorMode = "local" | "static" | "docker";

/**
 * Decide which orchestrator to use. Explicit `BP_ORCHESTRATOR` / `BP_MODE`
 * wins; otherwise default to `local` (the Docker-free path, §11A) — Docker is
 * opt-in because it requires a daemon.
 *
 * Precedence (highest → lowest):
 *   1. `BP_ORCHESTRATOR` explicit override
 *   2. `BP_RUNTIME_URL` set → `static` (connect a fixed pre-started runtime, static sandbox)
 *   3. `BP_MODE=docker` legacy switch
 *   4. `local` (default)
 */
export function resolveOrchestratorMode(
  env: Record<string, string | undefined> = process.env,
): OrchestratorMode {
  // Explicit override always wins.
  const explicit = (env.BP_ORCHESTRATOR ?? "").toLowerCase();
  if (explicit === "docker" || explicit === "local" || explicit === "static") {
    return explicit as OrchestratorMode;
  }
  // A pre-provisioned runtime URL (static sandbox compose) selects `static`.
  if ((env.BP_RUNTIME_URL ?? "").trim() !== "") return "static";
  // Dynamic per-user docker switch (downstream multi-user repo).
  if ((env.BP_MODE ?? "").toLowerCase() === "docker") return "docker";
  return "local";
}
