/**
 * commands/down.ts — stop the detached backend (TS_PI_REFACTOR_DESIGN §11A.4).
 * Reads `.runtime/backend.pid`, gracefully stops it (SIGTERM→SIGKILL). The
 * backend's own LocalProcessOrchestrator normally stops the runtime child on
 * shutdown, but if the orchestrator lost track of it (issue #58 — the spawn
 * storm could orphan the surviving runtime on port+1), we also stop whatever
 * `.runtime/runtime.pid` points at as a backstop.
 */
import pc from "picocolors";
import { resolveDataDir, dataPaths } from "../paths.js";
import { stop, removeServerState, type ProcessControlDeps } from "../process-control.js";

export interface DownOptions {
  dir?: string;
  timeoutMs?: number;
}

export interface DownDeps extends ProcessControlDeps {
  env?: Record<string, string | undefined>;
  cwd?: string;
  log?: (msg: string) => void;
}

export interface DownResult {
  stopped: boolean;
  pid: number | null;
  forced: boolean;
}

export async function down(
  options: DownOptions = {},
  deps: DownDeps = {},
): Promise<DownResult> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const dataDir = resolveDataDir({ dir: options.dir, env: deps.env, cwd: deps.cwd });
  const p = dataPaths(dataDir);

  const result = await stop(p.backendPid, {
    timeoutMs: options.timeoutMs,
    isAlive: deps.isAlive,
    signal: deps.signal,
    sleep: deps.sleep,
  });

  // Backstop the runtime (issue #58): the backend normally kills its runtime
  // child and removes runtime.pid on shutdown, in which case this stop() reads
  // no pid and is a no-op. But if the orchestrator lost track during a failed
  // spawn storm, the real runtime can survive as an orphan on port+1 — stop()
  // reads runtime.pid and actually SIGTERM/SIGKILLs it. Idempotent either way.
  await stop(p.runtimePid, {
    timeoutMs: options.timeoutMs,
    isAlive: deps.isAlive,
    signal: deps.signal,
    sleep: deps.sleep,
  });
  // Drop the persisted server state so a later `status` doesn't report a dead
  // server's ports (issue #41).
  await removeServerState(p.serverState);

  if (result.pid === null) {
    log(pc.yellow("No running backend found (no pid file)."));
  } else if (result.forced) {
    log(pc.yellow(`Backend (pid ${result.pid}) force-killed after timeout.`));
  } else {
    log(pc.green(`Backend (pid ${result.pid}) stopped.`));
  }
  return result;
}
