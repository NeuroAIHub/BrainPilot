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
import { runtimeArtifactPaths } from "./runtime-paths.js";

export interface CreateOrchestratorOptions {
  /** Force a mode; otherwise resolved from env (BP_ORCHESTRATOR / BP_RUNTIME_URL / BP_MODE). */
  mode?: OrchestratorMode;
  local?: LocalOrchestratorOptions;
  static?: Partial<StaticOrchestratorOptions>;
  docker?: DockerOrchestratorOptions;
  env?: Record<string, string | undefined>;
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
    return new DockerOrchestrator({ ...options.docker, sharedDir });
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
