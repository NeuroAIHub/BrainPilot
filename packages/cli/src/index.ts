/**
 * @brainpilot/cli — Docker-free local one-click launch (§11A).
 *
 * Public surface: the command functions (for programmatic/test use) plus a
 * `run(argv)` that drives the commander program.
 */
export { up, buildStartServerOptions, PortInUseError } from "./commands/up.js";
export type { UpOptions, UpDeps, UpResult, ResolvedUpConfig } from "./commands/up.js";
export { down } from "./commands/down.js";
export type { DownOptions, DownDeps, DownResult } from "./commands/down.js";
export { status } from "./commands/status.js";
export type { StatusOptions, StatusDeps, StatusReport } from "./commands/status.js";
export { init } from "./commands/init.js";
export type { InitOptions, InitDeps, InitResult } from "./commands/init.js";
export { logs, tailFile } from "./commands/logs.js";
export type { LogsOptions, LogsDeps } from "./commands/logs.js";

export {
  resolveDataDir,
  dataPaths,
  resolvePaths,
  DEFAULT_DATA_DIR_NAME,
} from "./paths.js";
export type { DataPaths, ResolveDataDirOptions } from "./paths.js";
export { scaffold, isScaffolded, DEFAULT_PORT } from "./scaffold.js";
export type { ScaffoldOptions, ScaffoldResult } from "./scaffold.js";
export {
  writePid,
  readPid,
  removePid,
  isRunning,
  stop,
} from "./process-control.js";
export type { ProcessControlDeps, StopResult } from "./process-control.js";
export { resolveWebDist } from "./web-dist.js";
export { spawnDetachedBackend, resolveBackendServerPath } from "./spawn-backend.js";

export { buildProgram, run } from "./program.js";

export const CLI_NAME = "@brainpilot/cli";
