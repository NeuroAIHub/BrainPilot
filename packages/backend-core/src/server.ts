/**
 * server.ts — boots the Hono app via @hono/node-server (§11A.3 / §11A.4 step 4).
 * Exported via the package's `./server` entry. The orchestrator's runtime is
 * started lazily on the first request that needs it; graceful shutdown stops it.
 */
import { pathToFileURL } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { createApp, type CreateAppOptions } from "./app.js";
import { createOrchestrator } from "./create-orchestrator.js";
import { bootstrapEnvProvider } from "./config.js";
import type { Orchestrator } from "./orchestrator.js";

export interface StartServerOptions extends Partial<CreateAppOptions> {
  /** Backend port. Default 9001 (§11A.5 决策 D). */
  port?: number;
  hostname?: string;
  /** Provide a pre-built orchestrator; otherwise one is created from env. */
  orchestrator?: Orchestrator;
  /** Eagerly ensure the runtime at boot (default false — lazy on first use). */
  eager?: boolean;
  /** When true, the runtime child inherits stdio (foreground CLI mode). */
  stdioInherit?: boolean;
}

export interface RunningServer {
  server: ServerType;
  orchestrator: Orchestrator;
  port: number;
  stop: () => Promise<void>;
}

export async function startServer(
  options: StartServerOptions = {},
): Promise<RunningServer> {
  const port = options.port ?? Number(process.env.PORT ?? 9001);
  // 127.0.0.1 is the safe default for local/CLI use; containers set BP_HOST=0.0.0.0
  // so the published port (DNAT'd to the container IP) can reach the server.
  const hostname = options.hostname ?? process.env.BP_HOST ?? "127.0.0.1";
  const orchestrator =
    options.orchestrator ??
    createOrchestrator({
      local: options.stdioInherit ? { stdioInherit: true } : undefined,
    });

  const app = createApp({
    orchestrator,
    dataDir: options.dataDir,
    webRoot: options.webRoot,
    fetchFn: options.fetchFn,
    serveWeb: options.serveWeb,
    env: options.env,
  });

  // #51: seed a provider profile from env on first launch so an env-only
  // quick-start (ANTHROPIC_API_KEY etc.) surfaces an active provider in the Web
  // UI. No-op once providers.json has any profile. Best-effort: a failure here
  // must not block the server from starting.
  try {
    await bootstrapEnvProvider(options.dataDir ?? process.env.BP_DATA_DIR ?? "./brainpilot", options.env);
  } catch {
    // ignore — env projection is a convenience, not a startup gate
  }

  if (options.eager) {
    await orchestrator.ensureRuntime();
  }

  const server = serve({ fetch: app.fetch, port, hostname });

  const stop = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await orchestrator.stopRuntime();
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
