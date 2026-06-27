/**
 * commands/up.ts — the main command (TS_PI_REFACTOR_DESIGN §11A.4).
 *
 * Sequence:
 *   1. resolve config (dir/port/env)
 *   2. scaffold bp_template if absent (idempotent)
 *   3. resolve provider key (env > bp_template/settings.json > config > .env);
 *      error with guidance if none
 *   4. pre-check the backend + runtime ports are free
 *   5. start the backend (foreground in-process, or detached child)
 *      — backend itself spawns the runtime via LocalProcessOrchestrator
 *   6. print URL (+ optionally open browser)
 *
 * Everything external (startServer, port probing, browser open, child spawn)
 * is injectable so tests drive it without a real server.
 */
import { resolveProvider, describeProviderConfig, formatProviderGuidance } from "@brainpilot/backend-core";
import type { StartServerOptions, RunningServer, OrchestratorMode } from "@brainpilot/backend-core";
import { isMockMode, isMacOS, isWindows } from "@brainpilot/runtime";
import pc from "picocolors";
import { resolveDataDir, dataPaths } from "../paths.js";
import { scaffold, isScaffolded, DEFAULT_PORT } from "../scaffold.js";
import { detectPromptDrift } from "./template.js";
import { writePid, writeServerState } from "../process-control.js";
import { resolveWebDist } from "../web-dist.js";

export interface UpOptions {
  /** `--dir <path>` data root. */
  dir?: string;
  /** `--port <n>` backend port (runtime = port+1). */
  port?: number;
  /** Run the backend in-process (default true). Pass `--detach` for background. */
  foreground?: boolean;
  /** `--no-open` to suppress the browser. */
  open?: boolean;
  /** `--mode <local|static|docker>` force the orchestrator mode (default local). */
  mode?: OrchestratorMode;
}

/** Injectable collaborators (defaults wire to real implementations). */
export interface UpDeps {
  env?: Record<string, string | undefined>;
  cwd?: string;
  /** Start the backend in-process. Defaults to backend-core `startServer`. */
  startServer?: (opts: StartServerOptions) => Promise<RunningServer>;
  /** Spawn a detached backend child. Required when `foreground` is false. */
  spawnDetached?: (opts: ResolvedUpConfig) => Promise<number>;
  /** Probe whether a TCP port is free. Defaults to a real net check. */
  isPortFree?: (port: number, host: string) => Promise<boolean>;
  /** Open a URL in the browser. Defaults to the OS launcher (open/start/xdg-open). */
  openBrowser?: (url: string) => Promise<void>;
  /** Resolve the web dist dir. Defaults to `resolveWebDist()`. */
  webDist?: () => string | null;
  log?: (msg: string) => void;
}

/** The fully-resolved config `up` computes before starting anything. */
export interface ResolvedUpConfig {
  dataDir: string;
  port: number;
  runtimePort: number;
  host: string;
  webDist: string | null;
  foreground: boolean;
  open: boolean;
  /** Orchestrator mode passed explicitly to the backend (default local). */
  mode: OrchestratorMode;
}

/**
 * Resolve the orchestrator mode for `brainpilot up`. Unlike the backend's
 * env-based `resolveOrchestratorMode` (which reads BP_RUNTIME_URL / BP_MODE),
 * the CLI defaults to `local` and only departs from it when the user is
 * explicit — via `--mode` or an explicit `BP_ORCHESTRATOR`. This is the fix for
 * "users accidentally enter sandbox mode": a stray BP_RUNTIME_URL left over
 * from a `docker compose` session no longer hijacks a source launch into
 * static (sandbox) mode. To run `up` against a pre-started container, the user
 * must say so (`--mode static` or BP_ORCHESTRATOR=static).
 */
export function resolveUpMode(
  optionMode: OrchestratorMode | undefined,
  env: Record<string, string | undefined>,
): OrchestratorMode {
  if (optionMode) return optionMode;
  const explicit = (env.BP_ORCHESTRATOR ?? "").toLowerCase();
  if (explicit === "docker" || explicit === "local" || explicit === "static") {
    return explicit as OrchestratorMode;
  }
  return "local";
}

/** Build the StartServerOptions from resolved config — exposed for tests. */
export function buildStartServerOptions(
  cfg: ResolvedUpConfig,
): StartServerOptions {
  return {
    port: cfg.port,
    hostname: cfg.host,
    dataDir: cfg.dataDir,
    serveWeb: cfg.webDist !== null,
    stdioInherit: cfg.foreground,
    // Pass the mode explicitly so a stray BP_RUNTIME_URL/BP_MODE in the
    // environment can't silently flip a local source-launch into static/docker.
    mode: cfg.mode,
    ...(cfg.webDist ? { webRoot: cfg.webDist } : {}),
  } satisfies StartServerOptions;
}

/** Pick the right CLI invocation hint based on how the process was launched.
 *
 *  Direct binary call → `brainpilot up --port <n>`.
 *
 *  npm script call → `npm run <script> -- up --port <n>`. The `--` is required
 *  to stop npm from swallowing flags (otherwise it warns "Unknown cli config
 *  '--port'" and never passes them through), and the `up` subcommand has to
 *  follow it because the script itself only invokes `node bin.js`. */
export function portFlagHint(env: NodeJS.ProcessEnv = process.env): string {
  const script = env.npm_lifecycle_event;
  if (script && script !== "npx") {
    return `npm run ${script} -- up --port <n>`;
  }
  return "brainpilot up --port <n>";
}

export class PortInUseError extends Error {
  constructor(
    public readonly port: number,
    hint: string = portFlagHint(),
  ) {
    super(
      `Port ${port} is already in use.\n` +
        `  Choose another with \`${hint}\` ` +
        "(the runtime uses port+1).",
    );
    this.name = "PortInUseError";
  }
}

const realIsPortFree = async (port: number, host: string): Promise<boolean> => {
  const net = await import("node:net");
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
};

export interface UpResult {
  config: ResolvedUpConfig;
  url: string;
  /** Present only in foreground mode — the in-process server handle. */
  server?: RunningServer;
  /** Present only in detached mode — the backend child pid. */
  pid?: number;
}

/**
 * Run the `up` command. Returns once the backend is started (foreground: the
 * server handle; detached: the child pid + pid file written).
 */
export async function up(
  options: UpOptions = {},
  deps: UpDeps = {},
): Promise<UpResult> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((m: string) => console.log(m));
  const isPortFree = deps.isPortFree ?? realIsPortFree;
  const webDistFn = deps.webDist ?? (() => resolveWebDist());

  // 1. Resolve config.
  const dataDir = resolveDataDir({ dir: options.dir, env, cwd: deps.cwd });
  const port = options.port ?? (Number(env.BP_PORT) || DEFAULT_PORT);
  const host = "127.0.0.1";
  const foreground = options.foreground ?? true;
  const open = options.open ?? true;
  const mode = resolveUpMode(options.mode, env);

  const cfg: ResolvedUpConfig = {
    dataDir,
    port,
    runtimePort: port + 1,
    host,
    webDist: webDistFn(),
    foreground,
    open,
    mode,
  };

  // Make the resolved mode visible (the #1 cause of "I accidentally entered
  // sandbox mode" was that the mode switch was completely silent). For the
  // non-default static/docker modes, name the trigger so the user understands
  // why they left local.
  if (mode === "local") {
    log(pc.dim(`mode=local · dataDir=${dataDir} · runtime port ${cfg.runtimePort}`));
  } else {
    const via = options.mode
      ? "--mode"
      : "BP_ORCHESTRATOR";
    log(
      pc.yellow(
        `mode=${mode} (via ${via}) — connecting to an external runtime, not a local one.`,
      ),
    );
    if (mode === "static") {
      log(pc.dim(`    BP_RUNTIME_URL=${env.BP_RUNTIME_URL ?? "(unset — required for static)"}`));
    }
    log(pc.dim("    To run from source instead, drop --mode / BP_ORCHESTRATOR (defaults to local)."));
  }

  // 2. Scaffold if absent (idempotent).
  if (!(await isScaffolded(dataDir))) {
    log(pc.dim(`Scaffolding ${dataDir} ...`));
    await scaffold(dataDir, { port });
  }

  // 2b. Non-blocking banner if any on-disk prompt overrides have drifted from
  //     the in-code built-in (#102). The runtime still loads the on-disk file
  //     verbatim — we just surface the divergence so users notice when
  //     `git pull` updated a prompt they previously customised.
  try {
    const drift = await detectPromptDrift(dataDir);
    if (drift.length > 0) {
      const names = drift.map((d) => d.name).join(", ");
      log(
        pc.yellow(
          `ℹ Detected ${drift.length} on-disk agent prompt override(s) diverging from built-ins: ${names}`,
        ),
      );
      log(pc.dim("    inspect:  npm run bp -- template diff"));
      log(pc.dim("    refresh:  npm run bp -- template reset"));
      log(pc.dim("    keep:     ignore this notice (overrides take precedence)"));
    }
  } catch {
    // banner is best-effort — never fail `up` over template introspection
  }

  // 3. Resolve provider key. Skipped under BP_MOCK=1 — the mock agent replaces
  //    the whole Pi layer and never makes a real LLM call, so no key is needed.
  //    A missing key no longer blocks launch: the backend/runtime boot lazily
  //    and the user can configure url/key/model in the web Settings UI (or
  //    settings.json). We just warn so they know what to do.
  const provider = await resolveProvider({ dataDir, env });
  if (!isMockMode(env) && !provider.apiKey) {
    const report = await describeProviderConfig({ dataDir, env });
    for (const line of formatProviderGuidance(report)) log(pc.yellow(line));
  }

  // 4. Pre-check ports (backend + runtime, §11A.5).
  for (const p of [cfg.port, cfg.runtimePort]) {
    if (!(await isPortFree(p, host))) throw new PortInUseError(p);
  }

  const url = `http://${host}:${cfg.port}`;

  // 5. Start the backend.
  if (foreground) {
    const start = deps.startServer ?? (await defaultStartServer());
    const server = await start(buildStartServerOptions(cfg));
    log(pc.green(`BrainPilot backend running at ${pc.bold(url)}`));
    if (open) await maybeOpen(deps, url);
    return { config: cfg, url, server };
  }

  // Detached.
  if (!deps.spawnDetached) {
    throw new Error(
      "Detached `up` requires a spawnDetached hook (none provided).",
    );
  }
  const pid = await deps.spawnDetached(cfg);
  const paths = dataPaths(dataDir);
  await writePid(paths.backendPid, pid);
  // issue #41: persist the resolved ports so `status` (which has no --port)
  // probes the real backend rather than the default. `down` removes this.
  await writeServerState(paths.serverState, {
    pid,
    port: cfg.port,
    runtimePort: cfg.runtimePort,
    host: cfg.host,
  });
  log(pc.green(`BrainPilot backend started (pid ${pid}) at ${pc.bold(url)}`));
  if (open) await maybeOpen(deps, url);
  return { config: cfg, url, pid };
}

async function maybeOpen(deps: UpDeps, url: string): Promise<void> {
  const open = deps.openBrowser ?? defaultOpenBrowser;
  try {
    await open(url);
  } catch {
    /* opening the browser is best-effort; never fail `up` over it */
  }
}

/** Open a URL in the OS default browser using the platform launcher (no deps). */
const defaultOpenBrowser = async (url: string): Promise<void> => {
  const { spawn } = await import("node:child_process");
  const [cmd, args] = isMacOS
    ? ["open", [url]]
    : isWindows
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  const child = spawn(cmd as string, args as string[], { stdio: "ignore", detached: true });
  child.on("error", () => {}); // launcher missing (e.g. headless Linux) — ignore
  child.unref();
};

/** Lazy import of backend-core startServer (keeps it out of the hot path/tests). */
async function defaultStartServer(): Promise<
  (opts: StartServerOptions) => Promise<RunningServer>
> {
  const mod = await import("@brainpilot/backend-core");
  return mod.startServer;
}
