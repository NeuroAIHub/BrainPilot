/**
 * paths.ts — resolve the data dir and the well-known files/dirs underneath it
 * (TS_PI_REFACTOR_DESIGN §11A.2). Precedence for the data dir:
 *   explicit `--dir` > `BP_DATA_DIR` env > `./brainpilot` under cwd.
 */
import { resolve, join } from "node:path";

export interface ResolveDataDirOptions {
  /** Explicit `--dir <path>` value (highest priority). */
  dir?: string;
  /** Environment (defaults to `process.env`). */
  env?: Record<string, string | undefined>;
  /** Base for relative resolution (defaults to `process.cwd()`). */
  cwd?: string;
}

/** Default data-root directory name created under the launch cwd. */
export const DEFAULT_DATA_DIR_NAME = "brainpilot";

/**
 * Resolve the absolute data-root directory.
 * Precedence: `--dir` > `BP_DATA_DIR` > `<cwd>/brainpilot`.
 */
export function resolveDataDir(options: ResolveDataDirOptions = {}): string {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const explicit = options.dir?.trim();
  if (explicit) return resolve(cwd, explicit);
  const fromEnv = env.BP_DATA_DIR?.trim();
  if (fromEnv) return resolve(cwd, fromEnv);
  return resolve(cwd, DEFAULT_DATA_DIR_NAME);
}

/** Well-known paths under a resolved data dir (§11A.2). */
export interface DataPaths {
  dataDir: string;
  bpTemplate: string;
  bpTemplateAgents: string;
  bpTemplateSettings: string;
  bpTemplateProviders: string;
  bpTemplateMcpServers: string;
  bpTemplateSkills: string;
  bp: string;
  workspaces: string;
  brainpilotConfig: string;
  dotenv: string;
  runtimeDir: string;
  logsDir: string;
  backendLog: string;
  runtimeLog: string;
  backendPid: string;
  runtimePid: string;
  /** Runtime state for a detached server (resolved ports/pid) — issue #41. */
  serverState: string;
}

/** Build all derived paths from a data dir. Pure — no filesystem access. */
export function dataPaths(dataDir: string): DataPaths {
  const bpTemplate = join(dataDir, "bp_template");
  const runtimeDir = join(dataDir, ".runtime");
  const logsDir = join(runtimeDir, "logs");
  return {
    dataDir,
    bpTemplate,
    bpTemplateAgents: join(bpTemplate, "agents"),
    bpTemplateSettings: join(bpTemplate, "settings.json"),
    bpTemplateProviders: join(bpTemplate, "providers.json"),
    bpTemplateMcpServers: join(bpTemplate, "mcp_servers.json"),
    bpTemplateSkills: join(bpTemplate, "skills"),
    bp: join(dataDir, ".bp"),
    workspaces: join(dataDir, "workspaces"),
    brainpilotConfig: join(dataDir, "brainpilot.config.json"),
    dotenv: join(dataDir, ".env"),
    runtimeDir,
    logsDir,
    backendLog: join(logsDir, "backend.log"),
    runtimeLog: join(logsDir, "runtime.log"),
    backendPid: join(runtimeDir, "backend.pid"),
    runtimePid: join(runtimeDir, "runtime.pid"),
    serverState: join(runtimeDir, "server.json"),
  };
}

/** Convenience: resolve data dir + derived paths in one call. */
export function resolvePaths(options: ResolveDataDirOptions = {}): DataPaths {
  return dataPaths(resolveDataDir(options));
}
