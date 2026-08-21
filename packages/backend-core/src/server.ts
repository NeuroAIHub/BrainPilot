/**
 * server.ts — boots the Hono app via @hono/node-server (§11A.3 / §11A.4 step 4).
 * Exported via the package's `./server` entry. The orchestrator's runtime is
 * started lazily on the first request that needs it; graceful shutdown stops it.
 */
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { createApp, type CreateAppOptions } from "./app.js";
import { createOrchestrator } from "./create-orchestrator.js";
import { bootstrapEnvProvider, migrateLegacySettings } from "./config.js";
import { resolveOrchestratorMode, type Orchestrator, type OrchestratorMode } from "./orchestrator.js";

export interface StartServerOptions extends Partial<CreateAppOptions> {
  /** Backend port. Default 9001 (§11A.5 决策 D). */
  port?: number;
  hostname?: string;
  /** Provide a pre-built orchestrator; otherwise one is created from env. */
  orchestrator?: Orchestrator;
  /**
   * Force the orchestrator mode. When omitted the mode is resolved from env
   * (BP_ORCHESTRATOR / BP_RUNTIME_URL / BP_MODE). The `brainpilot up` CLI passes
   * this explicitly so a stray BP_RUNTIME_URL can't silently flip a local
   * source-launch into static (sandbox) mode.
   */
  mode?: OrchestratorMode;
  /** Eagerly ensure the runtime at boot (default false — lazy on first use). */
  eager?: boolean;
  /** When true, the runtime child inherits stdio (foreground CLI mode). */
  stdioInherit?: boolean;
  /**
   * Port the local runtime should bind. Forwarded to the local orchestrator so
   * the foreground (in-process) path honours `--port` (runtime = backend + 1)
   * instead of falling back to AGENT_RUNTIME_PORT/8081 (#171). The detached path
   * injects the same value via the AGENT_RUNTIME_PORT env var (spawn-backend).
   */
  runtimePort?: number;
}

export interface RunningServer {
  server: ServerType;
  orchestrator: Orchestrator;
  port: number;
  stop: () => Promise<void>;
}

/**
 * Build the orchestrator for a server from its options. Exposed (and pure) so
 * the dataDir wiring is unit-testable without binding a socket.
 *
 * Issue #169: the local orchestrator MUST receive `options.dataDir` — it spawns
 * the runtime child with `BP_DATA_DIR=<dataDir>`, and the runtime materializes
 * skills / persists sessions under that root. Dropping it here made the runtime
 * fall back to `./brainpilot` (relative to cwd) while the backend scaffold wrote
 * to the requested `--dir`, splitting one launch across two data dirs.
 */
export function buildServerOrchestrator(
  options: StartServerOptions = {},
): Orchestrator {
  const dataDir = resolve(
    options.dataDir ?? options.env?.BP_DATA_DIR ?? process.env.BP_DATA_DIR ?? "./brainpilot",
  );
  return (
    options.orchestrator ??
    createOrchestrator({
      // Pass the mode explicitly when set (the `brainpilot up` CLI does) so a
      // stray BP_RUNTIME_URL/BP_MODE in the environment can't silently flip a
      // local source-launch into static/docker. When omitted, createOrchestrator
      // falls back to env resolution (Docker compose relies on that path).
      ...(options.mode ? { mode: options.mode } : {}),
      local: {
        dataDir: options.dataDir,
        ...(options.runtimePort !== undefined ? { port: options.runtimePort } : {}),
        ...(options.stdioInherit ? { stdioInherit: true } : {}),
      },
      // Single-user Docker needs the same host data root that the backend
      // uses, otherwise the runtime receives BP_KB_ROOT without a bind mount.
      // In dynamic mode this value becomes the per-user data-root base.
      docker: { dataDir },
    })
  );
}

/** Resolve the host-side KB root that is bind-mounted into one Docker runtime. */
export function resolveServerKbRoot(
  options: StartServerOptions = {},
): string | undefined {
  if (options.kbRoot) return options.kbRoot;
  const runtimeEnv = options.env ?? process.env;
  const mode = options.mode ?? resolveOrchestratorMode(runtimeEnv);
  const dynamic = ["1", "true", "yes"].includes((runtimeEnv.BP_DYNAMIC ?? "").toLowerCase());
  if (mode !== "docker" || dynamic) return undefined;
  const dataDir = resolve(
    options.dataDir ?? runtimeEnv.BP_DATA_DIR ?? "./brainpilot",
  );
  return join(dataDir, "KnowledgeBase");
}

export async function startServer(
  options: StartServerOptions = {},
): Promise<RunningServer> {
  const port = options.port ?? Number(process.env.PORT ?? 9001);
  // 127.0.0.1 is the safe default for local/CLI use; containers set BP_HOST=0.0.0.0
  // so the published port (DNAT'd to the container IP) can reach the server.
  const hostname = options.hostname ?? process.env.BP_HOST ?? "127.0.0.1";
  const orchestrator = buildServerOrchestrator(options);
  const shutdown = new AbortController();
  // A single Docker sandbox sees this host directory at
  // /root/.bp-root/KnowledgeBase. Dynamic mode intentionally keeps KB
  // management disabled until the backend has a per-user control plane.
  const kbRoot = resolveServerKbRoot(options);

  const app = createApp({
    orchestrator,
    dataDir: options.dataDir,
    ...(kbRoot ? { kbRoot } : {}),
    webRoot: options.webRoot,
    fetchFn: options.fetchFn,
    serveWeb: options.serveWeb,
    env: options.env,
    shutdownSignal: shutdown.signal,
  });

  const providerDataDir = options.dataDir ?? process.env.BP_DATA_DIR ?? "./brainpilot";

  // #202: migrate a legacy plaintext-key settings.json (pre-rewrite layout) into
  // providers.json before the env fallback runs — settings.json was a user's
  // explicit config, so it outranks env projection. No-op once providers.json
  // has any profile. Best-effort: a failure must not block startup.
  try {
    await migrateLegacySettings(providerDataDir);
  } catch {
    // ignore — legacy migration is a convenience, not a startup gate
  }

  // #51: seed a provider profile from env on first launch so an env-only
  // quick-start (ANTHROPIC_API_KEY etc.) surfaces an active provider in the Web
  // UI. No-op once providers.json has any profile. Best-effort: a failure here
  // must not block the server from starting.
  try {
    await bootstrapEnvProvider(providerDataDir, options.env);
  } catch {
    // ignore — env projection is a convenience, not a startup gate
  }

  if (options.eager) {
    await orchestrator.ensureRuntime();
  }

  const server = serve({ fetch: app.fetch, port, hostname });

  let stopPromise: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      // Stop long-lived SSE proxy responses first. Otherwise server.close()
      // waits forever for browser tabs and the CLI reaches its SIGKILL timeout.
      shutdown.abort();
      const nodeServer = server as ServerType & {
        closeIdleConnections?: () => void;
        closeAllConnections?: () => void;
      };
      const closed = new Promise<void>((resolve) => nodeServer.close(() => resolve()));
      nodeServer.closeIdleConnections?.();
      // Belt-and-braces fallback for a connection that ignores stream abort.
      // Ordinary requests get a short grace window before forced socket close.
      const forceTimer = setTimeout(() => nodeServer.closeAllConnections?.(), 1_000);
      forceTimer.unref?.();
      try {
        await closed;
      } finally {
        clearTimeout(forceTimer);
      }
      await orchestrator.stopRuntime();
    })();
    return stopPromise;
  };

  // Graceful shutdown on signals. Containers run no PM2 inside; a fatal/OOM
  // cleanly exits and Docker's `restart` policy is the backstop (§R-4 / #20).
  const onSignal = (): void => {
    void stop().finally(() => process.exit(0));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  return { server, orchestrator, port, stop };
}

// Allow `node dist/server.js` to boot directly.
// pathToFileURL keeps the main-module check correct on Windows (a naive
// `file://${argv[1]}` never matches import.meta.url there).
const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startServer().then(
    (s) => {
      // eslint-disable-next-line no-console
      console.log(`[backend-core] listening on port ${s.port}`);
    },
    (err) => {
      // eslint-disable-next-line no-console
      console.error("[backend-core] failed to start:", err);
      process.exit(1);
    },
  );
}
