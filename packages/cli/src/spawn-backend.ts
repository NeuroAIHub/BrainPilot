/**
 * spawn-backend.ts — default detached spawn used by `up --detach`. Launches the
 * backend-core server entry as a background process, redirecting stdout/stderr
 * to `.runtime/logs/backend.log`, and returns its pid (§11A.4 step 7 / §11A.5).
 *
 * The backend's own LocalProcessOrchestrator spawns the runtime; we only manage
 * the backend process here.
 */
import { spawn } from "node:child_process";
import { openSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { dataPaths } from "./paths.js";
import type { ResolvedUpConfig } from "./commands/up.js";

/** Resolve `@brainpilot/backend-core/server` to an absolute path. */
export function resolveBackendServerPath(from: string = import.meta.url): string {
  const require = createRequire(from);
  return require.resolve("@brainpilot/backend-core/server");
}

/**
 * Spawn the backend as a detached child. Returns the child pid. Env injects
 * BP_DATA_DIR + BP_MODE=single + the resolved ports (§11A.4 step 4).
 */
export async function spawnDetachedBackend(
  cfg: ResolvedUpConfig,
): Promise<number> {
  const p = dataPaths(cfg.dataDir);
  mkdirSync(p.logsDir, { recursive: true });
  const out = openSync(p.backendLog, "a");

  const serverPath = resolveBackendServerPath();
  const child = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: ["ignore", out, out],
    cwd: dirname(cfg.dataDir),
    env: {
      ...process.env,
      BP_DATA_DIR: cfg.dataDir,
      BP_MODE: "single",
      // Pin the orchestrator mode resolved by `up`. The detached server boots
      // via `node server.js` and resolves its mode from env, so without this a
      // stray BP_RUNTIME_URL would flip the background backend into static
      // (sandbox) mode. BP_ORCHESTRATOR has the highest precedence and thus
      // also neutralizes any leftover BP_RUNTIME_URL/BP_MODE in the parent env.
      BP_ORCHESTRATOR: cfg.mode,
      BP_PORT: String(cfg.port),
      PORT: String(cfg.port),
      AGENT_RUNTIME_PORT: String(cfg.runtimePort),
      ...(cfg.webDist ? { BP_WEB_ROOT: cfg.webDist } : {}),
    },
  });
  child.unref();
  if (child.pid === undefined) {
    throw new Error("Failed to spawn backend process (no pid).");
  }
  return child.pid;
}
