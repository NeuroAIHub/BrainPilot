/**
 * createOrchestrator — factory picking Local / Static / Docker based on env/options.
 */
import {
  resolveOrchestratorMode,
  type Orchestrator,
  type OrchestratorMode,
} from "./orchestrator.js";
import {
  LocalProcessOrchestrator,
  type LocalOrchestratorOptions,
} from "./local-orchestrator.js";
import {
  StaticRuntimeOrchestrator,
  type StaticOrchestratorOptions,
} from "./static-orchestrator.js";
import {
  DockerOrchestrator,
  type DockerOrchestratorOptions,
} from "./docker-orchestrator.js";
import {
  PerUserDockerOrchestrator,
  type PerUserDockerOrchestratorOptions,
} from "./per-user-docker-orchestrator.js";
import { runtimeArtifactPaths } from "./runtime-paths.js";

export interface CreateOrchestratorOptions {
  /** Force a mode; otherwise resolved from env (BP_ORCHESTRATOR / BP_RUNTIME_URL / BP_MODE). */
  mode?: OrchestratorMode;
  local?: LocalOrchestratorOptions;
  static?: Partial<StaticOrchestratorOptions>;
  docker?: DockerOrchestratorOptions;
  /** #301: per-user (dynamic) docker options; used when perUser mode is on. */
  perUserDocker?: PerUserDockerOrchestratorOptions;
  /**
   * #301: force dynamic per-user docker mode. When undefined, resolved from
   * `BP_DYNAMIC` env ("1"/"true"). Only consulted in docker mode.
   */
  perUser?: boolean;
  env?: Record<string, string | undefined>;
}

/** Truthy BP_DYNAMIC values that switch docker mode to per-user (#301). */
function resolvePerUser(
  explicit: boolean | undefined,
  env: Record<string, string | undefined>,
): boolean {
  if (explicit !== undefined) return explicit;
  const raw = (env.BP_DYNAMIC ?? "").toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function intFromEnv(
  value: string | undefined,
  fallback: number | undefined,
): number | undefined {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function createOrchestrator(
  options: CreateOrchestratorOptions = {},
): Orchestrator {
  const env = options.env ?? process.env;
  const mode = options.mode ?? resolveOrchestratorMode(env);

  if (mode === "docker") {
    // #261: the container gets a fresh env, so the cross-user shared root must
    // be passed in explicitly (from BP_SHARED_DIR) — it's then bind-mounted
    // read-only and re-exported to the container as BP_SHARED_DIR. (Local/static
    // modes inherit the parent env, so the runtime reads BP_SHARED_DIR directly.)
    const sharedRaw = options.docker?.sharedDir ?? env.BP_SHARED_DIR ?? "";
    const sharedDir = sharedRaw.trim() === "" ? undefined : sharedRaw;

    // The sandbox image the daemon runs. Env-overridable (BP_SANDBOX_IMAGE) so
    // compose can pin a tag without a code change; falls back to the
    // DockerOrchestrator default when unset.
    const imageRaw = options.docker?.image ?? env.BP_SANDBOX_IMAGE ?? "";
    const image = imageRaw.trim() === "" ? undefined : imageRaw;

    // #301: dynamic multi-user mode gives each user an isolated sandbox. Opt-in
    // via BP_DYNAMIC (or options.perUser) so the default docker path stays the
    // single shared container it is today.
    if (resolvePerUser(options.perUser, env)) {
      const dataRoot =
        options.perUserDocker?.dataRoot ??
        options.docker?.dataDir ??
        env.BP_DATA_DIR ??
        undefined;
      // Per-user options own hostPort/dataDir (allocated per user), so drop any
      // single-instance values carried on options.docker before spreading.
      const {
        hostPort: _hostPort,
        dataDir: _dataDir,
        ...dockerBase
      } = options.docker ?? {};
      return new PerUserDockerOrchestrator({
        ...dockerBase,
        ...options.perUserDocker,
        ...(image ? { image } : {}),
        sharedDir,
        dataRoot,
        portMin: intFromEnv(env.BP_DYNAMIC_PORT_MIN, options.perUserDocker?.portMin),
        portMax: intFromEnv(env.BP_DYNAMIC_PORT_MAX, options.perUserDocker?.portMax),
        idleMs: intFromEnv(env.BP_DYNAMIC_IDLE_MS, options.perUserDocker?.idleMs),
      });
    }

    return new DockerOrchestrator({ ...options.docker, ...(image ? { image } : {}), sharedDir });
  }

  if (mode === "static") {
    const baseUrl = options.static?.baseUrl ?? env.BP_RUNTIME_URL ?? "";
    return new StaticRuntimeOrchestrator({ ...options.static, baseUrl });
  }

  // Default a fatal handler so an exhausted crash-loop is at least surfaced
  // (§11A.5 / §7 L4) instead of the runtime silently disappearing.
  // Derive log/pid paths from BP_DATA_DIR so logs/status/down can observe the runtime child.
  // In foreground (stdioInherit) mode, skip log/pid files — the runtime output is
  // visible on the terminal and the backend owns the lifecycle directly.
  const dataDir = options.local?.dataDir ?? env.BP_DATA_DIR ?? "./brainpilot";
  const artifacts = runtimeArtifactPaths(dataDir);
  const local: LocalOrchestratorOptions = {
    onFatal: (err) => {
      // eslint-disable-next-line no-console
      console.error("[orchestrator] runtime fatal:", err.message);
    },
    ...(options.local?.stdioInherit
      ? {}
      : {
          runtimeLogFile: artifacts.runtimeLog,
          runtimePidFile: artifacts.runtimePid,
        }),
    ...options.local,
  };
  return new LocalProcessOrchestrator(local);
}
