/**
 * @brainpilot/backend-core — host-side lightweight backend (Hono) that serves
 * the web SPA and byte-proxies to the Runtime (修正4), plus the Orchestrator
 * abstraction (Docker / Local). See TS_PI_REFACTOR_DESIGN §10, §11, §11A.
 */
export const BACKEND_NAME = "@brainpilot/backend-core";

export { createApp } from "./app.js";
export type { CreateAppOptions } from "./app.js";

export { startServer } from "./server.js";
export type { StartServerOptions, RunningServer } from "./server.js";

export { createOrchestrator } from "./create-orchestrator.js";
export type { CreateOrchestratorOptions } from "./create-orchestrator.js";

export { runtimeArtifactPaths } from "./runtime-paths.js";
export type { RuntimeArtifactPaths } from "./runtime-paths.js";

export {
  resolveOrchestratorMode,
} from "./orchestrator.js";
export type {
  Orchestrator,
  OrchestratorMode,
  RuntimeHandle,
  EnsureRuntimeOptions,
} from "./orchestrator.js";

export {
  LocalProcessOrchestrator,
  resolveRuntimeServerPath,
} from "./local-orchestrator.js";
export type {
  LocalOrchestratorOptions,
  SpawnFn,
  SpawnedProcess,
} from "./local-orchestrator.js";

export { DockerOrchestrator } from "./docker-orchestrator.js";
export type { DockerOrchestratorOptions } from "./docker-orchestrator.js";

export { StaticRuntimeOrchestrator } from "./static-orchestrator.js";
export type { StaticOrchestratorOptions } from "./static-orchestrator.js";

export { RuntimeClient, buildPath } from "./runtime-client.js";
export type { RuntimeClientOptions, ForwardOptions } from "./runtime-client.js";

export {
  resolveProvider,
  readLocalSettings,
  writeLocalSettings,
  parseDotenv,
  configPaths,
} from "./config.js";
export type {
  ResolvedProvider,
  LocalSettings,
  ConfigPaths,
  ResolveProviderOptions,
} from "./config.js";
