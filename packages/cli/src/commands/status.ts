/**
 * commands/status.ts — report process liveness + ports + health/metrics
 * (TS_PI_REFACTOR_DESIGN §11A.4). Reads the backend pid file, probes
 * GET /health and GET /metrics on the backend.
 */
import pc from "picocolors";
import { resolveDataDir, dataPaths } from "../paths.js";
import { readPid, isRunning, type ProcessControlDeps } from "../process-control.js";
import { DEFAULT_PORT } from "../scaffold.js";

export interface StatusOptions {
  dir?: string;
  port?: number;
}

export interface StatusDeps extends ProcessControlDeps {
  env?: Record<string, string | undefined>;
  cwd?: string;
  log?: (msg: string) => void;
  /** Injectable fetch for health/metrics. Defaults to global fetch. */
  fetchFn?: typeof fetch;
}

export interface StatusReport {
  running: boolean;
  pid: number | null;
  backendPort: number;
  runtimePort: number;
  url: string;
  healthy: boolean;
  metrics?: { activeSessions?: number; runningAgents?: number };
}

export async function status(
  options: StatusOptions = {},
  deps: StatusDeps = {},
): Promise<StatusReport> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const env = deps.env ?? process.env;
  const fetchFn = deps.fetchFn ?? fetch;
  const dataDir = resolveDataDir({ dir: options.dir, env, cwd: deps.cwd });
  const p = dataPaths(dataDir);
  const port = options.port ?? (Number(env.BP_PORT) || DEFAULT_PORT);
  const host = "127.0.0.1";
  const url = `http://${host}:${port}`;

  const pid = await readPid(p.backendPid);
  const running = await isRunning(p.backendPid, { isAlive: deps.isAlive });

  let healthy = false;
  let metrics: StatusReport["metrics"];
  if (running) {
    try {
      const h = await fetchFn(`${url}/api/health`);
      healthy = h.ok;
    } catch {
      healthy = false;
    }
    try {
      const m = await fetchFn(`${url}/api/metrics`);
      if (m.ok) {
        const body = (await m.json()) as Record<string, unknown>;
        metrics = {
          activeSessions: numOrUndef(body.activeSessions),
          runningAgents: numOrUndef(body.runningAgents),
        };
      }
    } catch {
      // metrics optional
    }
  }

  const report: StatusReport = {
    running,
    pid,
    backendPort: port,
    runtimePort: port + 1,
    url,
    healthy,
    ...(metrics ? { metrics } : {}),
  };

  if (!running) {
    log(pc.yellow("BrainPilot is not running."));
  } else {
    log(pc.green(`BrainPilot running (pid ${pid}) at ${url}`));
    log(`  backend port: ${report.backendPort}  runtime port: ${report.runtimePort}`);
    log(`  health: ${healthy ? pc.green("ok") : pc.red("unreachable")}`);
    if (metrics) {
      log(
        `  sessions: ${metrics.activeSessions ?? "?"}  ` +
          `running agents: ${metrics.runningAgents ?? "?"}`,
      );
    }
  }
  return report;
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
